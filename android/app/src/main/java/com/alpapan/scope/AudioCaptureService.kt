package com.alpapan.scope

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
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
        private const val NOTIFICATION_ID = 0x5C09E    // "scope"-ish
        private const val CHANNEL_ID = "scope_audio_capture"
        private const val SAMPLE_RATE = 48000
        private const val FRAMES_PER_CHUNK = 1024
        @Volatile var pluginRef: ScopeAudioPlugin? = null
    }

    @Volatile private var running = false
    private var projection: MediaProjection? = null
    private var record: AudioRecord? = null
    private var thread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running) return START_STICKY
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
            buildNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        )

        val pm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = pm.getMediaProjection(resultCode, data).also { proj ->
            // Per Android 14: register a callback before using projection.
            proj.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { stopSelf() }
            }, null)
            startReader(proj)
        }

        return START_STICKY
    }

    private fun startReader(proj: MediaProjection) {
        val config = AudioPlaybackCaptureConfiguration.Builder(proj)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()
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
        record = AudioRecord.Builder()
            .setAudioFormat(format)
            .setBufferSizeInBytes(bufferBytes)
            .setAudioPlaybackCaptureConfig(config)
            .build()
        record?.startRecording()
        running = true

        thread = Thread({
            val chunk = FloatArray(FRAMES_PER_CHUNK * 2) // interleaved L,R,L,R...
            val byteBuf = ByteBuffer.allocate(chunk.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            while (running) {
                val n = record?.read(chunk, 0, chunk.size, AudioRecord.READ_BLOCKING) ?: -1
                if (n <= 0) continue
                byteBuf.clear()
                for (i in 0 until n) byteBuf.putFloat(chunk[i])
                byteBuf.flip()
                val bytes = ByteArray(byteBuf.remaining())
                byteBuf.get(bytes)
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                pluginRef?.emitPcmChunk(b64)
            }
        }, "ScopeAudioReader").also { it.start() }
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

    private fun buildNotification(): Notification {
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
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Scope")
            .setContentText("Capturing audio")
            .setOngoing(true)
            .build()
    }
}
