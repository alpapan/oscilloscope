package com.alpapan.scope

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Base64
import androidx.core.app.NotificationCompat
import java.nio.ByteBuffer
import java.nio.ByteOrder

class AudioCaptureService : Service() {

    companion object {
        const val EXTRA_PROJECTION_RESULT_CODE = "projection_result_code"
        const val EXTRA_PROJECTION_DATA = "projection_data"
        const val EXTRA_MIC_MODE = "mic_mode"
        const val ACTION_STOP_CAPTURE = "com.alpapan.scope.ACTION_STOP_CAPTURE"
        private const val NOTIFICATION_ID = 0x5C09E    // "scope"-ish
        private const val CHANNEL_ID = "scope_audio_capture"
        private const val SAMPLE_RATE = 48000
        private const val FRAMES_PER_CHUNK = 1024
        @Volatile var pluginRef: ScopeAudioPlugin? = null
        // Monotonic per-service generation token. Each onStartCommand bumps it;
        // each reader thread captures its own value at start. Notification
        // callbacks compare-on-fire and silently drop if the latest token has
        // moved on (i.e. a newer service has taken over). Prevents stale
        // threads from the previous capture mode from firing events into the
        // current one when stopService()/startForegroundService() interleave.
        private val tokenSeq = java.util.concurrent.atomic.AtomicLong(0)
        @Volatile var latestToken: Long = 0L
        // Headless TV-streaming tap. When set, each captured chunk is also
        // delivered deinterleaved (L, R-nullable) so the plugin can compute the
        // requested analysis frame natively and stream it - no WebView needed,
        // so the phone screen can be off. Cleared on disconnect / capture stop.
        @Volatile var pcmTap: ((FloatArray, FloatArray?) -> Unit)? = null
    }

    @Volatile private var running = false
    private var projection: MediaProjection? = null
    // Volatile because startReader's reader thread reassigns this field on
    // its own thread when retrying the policy-manager patch (Bug C fix),
    // and the field is also read from other entry points (onDestroy). Without
    // volatile the JMM does not guarantee visibility of the reassignment.
    @Volatile private var record: AudioRecord? = null
    private var thread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Notification "Stop" action and any other deliberate stop entrypoint
        // dispatches via this action. Stops the service cleanly without going
        // through Android's own "Stop sharing" (which kills the projection
        // without giving us a chance to notify JS or clean up the FG state).
        if (intent?.action == ACTION_STOP_CAPTURE) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (running) return START_STICKY
        val micMode = intent?.getBooleanExtra(EXTRA_MIC_MODE, false) ?: false
        if (micMode) {
            startForeground(
                NOTIFICATION_ID,
                buildNotification("Capturing audio (microphone)"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
            startMicReader()
            return START_STICKY
        }
        val resultCode = intent?.getIntExtra(EXTRA_PROJECTION_RESULT_CODE, -1) ?: -1
        val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_PROJECTION_DATA)
        }
        if (resultCode != android.app.Activity.RESULT_OK || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(
            NOTIFICATION_ID,
            buildNotification("Capturing system audio"),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        )

        val pm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val proj = pm.getMediaProjection(resultCode, data)
        if (proj == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        projection = proj
        // Per Android 14: register a callback before using projection.
        // onStop fires when the system revokes the projection (user taps the
        // OS-level "Stop sharing" notification, audio routing changes that
        // invalidate the mix, system-imposed token expiry). Notify JS so the
        // UI can surface a banner and offer a re-prompt, then stop ourselves.
        proj.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                pluginRef?.notifyCaptureLost("projection-stopped")
                stopSelf()
            }
        }, null)
        startReader(proj)

        return START_STICKY
    }

    // RECORD_AUDIO is declared in the manifest and playback capture is gated by
    // the MediaProjection consent, so the AudioRecord builds here are safe; lint
    // can't trace that across the service boundary.
    @SuppressLint("MissingPermission")
    private fun startReader(proj: MediaProjection) {
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
            .build()
        val minBytes = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_STEREO,
            AudioFormat.ENCODING_PCM_FLOAT
        )
        // 2 channels x 4 bytes/float = 8 bytes/frame
        val bytesPerFrame = 8
        val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * bytesPerFrame)
        running = true

        val audioMgr = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val myToken = tokenSeq.incrementAndGet()
        latestToken = myToken

        thread = Thread({
            // Bug C pre-warm: when capture starts AFTER an unflagged source is
            // already playing (user opens VLC then opens Scope and taps Start),
            // the very first AudioRecord on the freshly-granted MediaProjection
            // reads zeros - the AudioPolicyManager does not always patch the
            // existing track into the just-registered mix. Building a throwaway
            // AudioRecord first, briefly starting it, then releasing it, makes
            // the policy manager register-and-tear-down a mix; the next real
            // AudioRecord build re-evaluates patches and the existing track is
            // correctly routed. This is the auto version of the user's manual
            // "stop & start" workaround, but it stays within a single consent
            // session so the user sees only one projection dialog.
            // try-finally so the warmRecord is always released even if the
            // sleep is interrupted or the user taps Stop during the window
            // where this AudioRecord exists only in this local scope.
            var warmRecord: AudioRecord? = null
            try {
                val warmConfig = AudioPlaybackCaptureConfiguration.Builder(proj)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .build()
                warmRecord = AudioRecord.Builder()
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(bufferBytes)
                    .setAudioPlaybackCaptureConfig(warmConfig)
                    .build()
                warmRecord.startRecording()
                Thread.sleep(150)
            } catch (e: Throwable) {
                android.util.Log.w("ScopeAudio", "Bug-C pre-warm failed: ${e.message}")
            } finally {
                try { warmRecord?.stop() } catch (e: Throwable) {
                    android.util.Log.w("ScopeAudio", "warmRecord.stop() failed: ${e.message}")
                }
                try { warmRecord?.release() } catch (e: Throwable) {
                    android.util.Log.w("ScopeAudio", "warmRecord.release() failed: ${e.message}")
                }
                try { Thread.sleep(50) } catch (_: Throwable) {}
            }

            // Build the REAL AudioRecord with a fresh config. The fresh config
            // is intentional - reusing the warm-config's exact instance has
            // empirically not always triggered a re-patch.
            val config = AudioPlaybackCaptureConfiguration.Builder(proj)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
            record = buildProjectionRecord(config, format, bufferBytes)
            try { record?.startRecording() } catch (e: Throwable) {
                android.util.Log.e("ScopeAudio", "Real AudioRecord startRecording failed: ${e.message}")
                return@Thread
            }

            val chunk = FloatArray(FRAMES_PER_CHUNK * 2) // interleaved L,R,L,R...
            val byteBuf = ByteBuffer.allocate(chunk.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            // Re-arming silent-capture detector: instead of a one-shot flag,
            // track the last-non-zero chunk and the last-fired chunk. We fire
            // whenever zero-only persists for ~1s after recent non-zero audio
            // AND a restricted source is active, with a ~10s rate limit between
            // firings so a single Spotify session doesn't spam the banner.
            var chunkIdx = 0
            var lastNonZeroIdx = 0
            var lastFiredIdx = Int.MIN_VALUE / 2
            // Internal AudioRecord-recreate mimicking the user's manual
            // "stop & restart" workaround: when capture starts AFTER an
            // unflagged source is already playing, AudioPolicyManager does not
            // always patch the existing track into our mix. Rebuilding the
            // AudioRecord with the same projection token forces a re-evaluation
            // and the existing track gets routed. One attempt only per session.
            var refreshAttempted = false
            val SILENCE_THRESHOLD_CHUNKS = 50           // ~1.0 s at 1024/48k
            val RATE_LIMIT_CHUNKS = 500                 // ~10 s
            while (running && myToken == latestToken) {
                val n = record?.read(chunk, 0, chunk.size, AudioRecord.READ_BLOCKING) ?: -1
                if (n <= 0) continue
                chunkIdx++
                var anyNonZero = false
                var i = 0
                while (i < n) {
                    if (chunk[i] != 0f) { anyNonZero = true; break }
                    i++
                }
                if (anyNonZero) {
                    lastNonZeroIdx = chunkIdx
                } else {
                    val silentRun = chunkIdx - lastNonZeroIdx
                    if (silentRun >= SILENCE_THRESHOLD_CHUNKS &&
                        silentRun % SILENCE_THRESHOLD_CHUNKS == 0) {
                        when {
                            hasSilentRestrictedPlayback(audioMgr) -> {
                                if ((chunkIdx - lastFiredIdx) > RATE_LIMIT_CHUNKS &&
                                    myToken == latestToken) {
                                    lastFiredIdx = chunkIdx
                                    pluginRef?.notifySilentCapture()
                                }
                            }
                            !refreshAttempted && hasUnflaggedPlayback(audioMgr) -> {
                                refreshAttempted = true
                                try { record?.stop() } catch (_: Throwable) {}
                                try { record?.release() } catch (_: Throwable) {}
                                // Fresh config each retry; reusing the same
                                // instance has not empirically triggered a
                                // re-patch on Android 14+.
                                val freshConfig = AudioPlaybackCaptureConfiguration.Builder(proj)
                                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                                    .build()
                                record = buildProjectionRecord(freshConfig, format, bufferBytes)
                                try { record?.startRecording() } catch (_: Throwable) {}
                                lastNonZeroIdx = chunkIdx
                            }
                        }
                    }
                }
                pcmTap?.let { tap ->
                    val frames = n / 2
                    val l = FloatArray(frames); val r = FloatArray(frames)
                    var jj = 0; for (i in 0 until frames) { l[i] = chunk[jj]; r[i] = chunk[jj + 1]; jj += 2 }
                    tap(l, r)
                }
                byteBuf.clear()
                for (j in 0 until n) byteBuf.putFloat(chunk[j])
                byteBuf.flip()
                val bytes = ByteArray(byteBuf.remaining())
                byteBuf.get(bytes)
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                if (myToken == latestToken) {
                    pluginRef?.emitPcmChunk(b64)
                }
            }
        }, "ScopeAudioReader").also { it.start() }
    }

    @SuppressLint("MissingPermission")
    private fun buildProjectionRecord(
        config: AudioPlaybackCaptureConfiguration,
        format: AudioFormat,
        bufferBytes: Int
    ): AudioRecord = AudioRecord.Builder()
        .setAudioFormat(format)
        .setBufferSizeInBytes(bufferBytes)
        .setAudioPlaybackCaptureConfig(config)
        .build()

    /** True iff there is at least one active playback configuration with a
     *  matching usage that ALSO has the FLAG_NO_MEDIA_PROJECTION flag set in
     *  its AudioAttributes (visible in the AudioAttributes.toString() output).
     *
     *  Detection caveat: FLAG_NO_MEDIA_PROJECTION (0x1 << 10) is `@hide` with
     *  no public accessor since Android Q. There is no robust public-API way
     *  to read it; we scrape AudioAttributes.toString(). Verified working on
     *  Android 14, 15, 16; the format may shift on future versions, in which
     *  case detection silently fails (banner never appears, capture stays
     *  silent until the user toggles mic mode manually in the settings
     *  drawer). Acceptable degradation.
     *
     *  We don't filter on clientUid because getClientUid() is also `@hide`.
     *  Restricting on CONTENT_TYPE_{MUSIC,MOVIE,SPEECH} excludes our app's
     *  own silent AAudio stream, which uses CONTENT_TYPE_UNKNOWN. */
    private fun hasSilentRestrictedPlayback(audioMgr: AudioManager): Boolean {
        for (cfg in audioMgr.activePlaybackConfigurations) {
            val attrs = cfg.audioAttributes
            val usage = attrs.usage
            if (usage != AudioAttributes.USAGE_MEDIA &&
                usage != AudioAttributes.USAGE_GAME &&
                usage != AudioAttributes.USAGE_UNKNOWN) continue
            val s = attrs.toString()
            if (s.contains("FLAG_NO_MEDIA_PROJECTION") &&
                (s.contains("CONTENT_TYPE_MUSIC") ||
                 s.contains("CONTENT_TYPE_MOVIE") ||
                 s.contains("CONTENT_TYPE_SPEECH"))) {
                return true
            }
        }
        return false
    }

    /** True iff there is an active playback configuration with a matching
     *  usage that does NOT have FLAG_NO_MEDIA_PROJECTION. Used by mic-mode
     *  polling to offer a switch back to the higher-quality projection path. */
    private fun hasUnflaggedPlayback(audioMgr: AudioManager): Boolean {
        for (cfg in audioMgr.activePlaybackConfigurations) {
            val attrs = cfg.audioAttributes
            val usage = attrs.usage
            if (usage != AudioAttributes.USAGE_MEDIA &&
                usage != AudioAttributes.USAGE_GAME &&
                usage != AudioAttributes.USAGE_UNKNOWN) continue
            val s = attrs.toString()
            if (!s.contains("FLAG_NO_MEDIA_PROJECTION") &&
                (s.contains("CONTENT_TYPE_MUSIC") ||
                 s.contains("CONTENT_TYPE_MOVIE") ||
                 s.contains("CONTENT_TYPE_SPEECH") ||
                 s.contains("CONTENT_TYPE_UNKNOWN"))) {
                return true
            }
        }
        return false
    }

    // RECORD_AUDIO is verified granted in ScopeAudioPlugin.startMicCapture before
    // this service is started; the build here is safe. Lint can't see that path.
    @SuppressLint("MissingPermission")
    private fun startMicReader() {
        // Mic-source AudioRecord. Bypasses AudioPlaybackCapture and is therefore
        // immune to FLAG_NO_MEDIA_PROJECTION (Spotify, Chrome WAV) opt-outs.
        // Quality is degraded by speaker→mic acoustic path + ambient pickup.
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build()
        val minBytes = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_FLOAT
        )
        val bytesPerFrame = 4 // 1 channel x 4 bytes/float
        val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * bytesPerFrame)
        record = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.MIC)
            .setAudioFormat(format)
            .setBufferSizeInBytes(bufferBytes)
            .build()
        // Attach the OS-level Automatic Gain Control + Noise Suppressor audio
        // effects to this AudioRecord session. AGC normalises mic input across
        // wildly different speaker volumes and source-to-mic distances so the
        // visualisation stays usable as songs / playback volume change. NS
        // reduces ambient room noise that would otherwise dominate quiet
        // passages. Both are best-effort: not every device implements them.
        record?.audioSessionId?.let { sessionId ->
            if (AutomaticGainControl.isAvailable()) {
                try {
                    AutomaticGainControl.create(sessionId)?.enabled = true
                } catch (_: Throwable) { /* effect unavailable on this device */ }
            }
            if (NoiseSuppressor.isAvailable()) {
                try {
                    NoiseSuppressor.create(sessionId)?.enabled = true
                } catch (_: Throwable) { /* effect unavailable on this device */ }
            }
        }
        record?.startRecording()
        running = true

        val audioMgr = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val myToken = tokenSeq.incrementAndGet()
        latestToken = myToken

        thread = Thread({
            val mono = FloatArray(FRAMES_PER_CHUNK)
            // Emit STEREO bytes (duplicate mono into L+R) so the JS path
            // (which expects interleaved stereo) stays unchanged.
            val byteBuf = ByteBuffer.allocate(FRAMES_PER_CHUNK * 2 * 4).order(ByteOrder.LITTLE_ENDIAN)
            // Poll for an unflagged source every ~5 s (≈ 235 chunks at 1024 /
            // 48 kHz). The previous 2-minute interval was too long: users
            // who switch to unrestricted content (VLC, a YouTube tab) expect
            // the switch-back prompt within seconds, not minutes. Rate-limit
            // re-firings to one per ~5 min so a single steady-unflagged
            // session (user playing VLC) does not spam the banner.
            val POLL_INTERVAL_CHUNKS = 235
            val RATE_LIMIT_CHUNKS = 14100
            var chunkCount = 0
            var lastFiredCount = Int.MIN_VALUE / 2
            while (running && myToken == latestToken) {
                val n = record?.read(mono, 0, mono.size, AudioRecord.READ_BLOCKING) ?: -1
                if (n <= 0) continue
                chunkCount++
                if (chunkCount % POLL_INTERVAL_CHUNKS == 0 &&
                    (chunkCount - lastFiredCount) > RATE_LIMIT_CHUNKS &&
                    hasUnflaggedPlayback(audioMgr)) {
                    lastFiredCount = chunkCount
                    if (myToken == latestToken) {
                        pluginRef?.notifyUnrestrictedAvailable()
                    }
                }
                pcmTap?.invoke(mono.copyOf(n), null)
                byteBuf.clear()
                for (i in 0 until n) {
                    byteBuf.putFloat(mono[i])
                    byteBuf.putFloat(mono[i])
                }
                byteBuf.flip()
                val bytes = ByteArray(byteBuf.remaining())
                byteBuf.get(bytes)
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                if (myToken == latestToken) {
                    pluginRef?.emitPcmChunk(b64)
                }
            }
        }, "ScopeMicReader").also { it.start() }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // User swiped Scope from the recents tray. If capture is active, keep
        // the foreground service alive so audio (mic / system-audio) continues
        // uninterrupted; otherwise stop. The decision is in CaptureLifecycle
        // so the rule is unit-tested.
        if (CaptureLifecycle.shouldStopOnTaskRemoved(running)) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        running = false
        try { record?.stop() } catch (_: Throwable) {}
        try { record?.release() } catch (_: Throwable) {}
        record = null
        try { projection?.stop() } catch (_: Throwable) {}
        projection = null
        thread?.join(500)
        thread = null
        super.onDestroy()
    }

    private fun buildNotification(text: String = "Capturing audio"): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Audio capture",
                NotificationManager.IMPORTANCE_LOW
            )
            ch.description = "Required for Scope to capture system audio"
            nm.createNotificationChannel(ch)
        }
        // Stop action lets the user deliberately end capture from the
        // notification, instead of relying on Android's own (poorly-discoverable)
        // "Stop sharing" or task-swipe paths.
        val stopIntent = Intent(this, AudioCaptureService::class.java).setAction(ACTION_STOP_CAPTURE)
        val stopPi = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Scope")
            .setContentText(text)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi)
            .build()
    }
}
