package com.alpapan.scope

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import kotlin.math.log10
import com.alpapan.scope.tv.ControlRouter
import com.alpapan.scope.tv.PhoneInboundAction
import com.alpapan.scope.tv.SlidingWindow
import com.alpapan.scope.tv.WaveformPrep

const val MAX_FFT_SIZE = 16384
const val WIRE_DOWNSAMPLE_FACTOR: Float = 1f   // ratio output/input; 1f = no downsample (TV waveform equals phone waveform)

object RenderSpecClamp {
    fun clampFftSize(raw: Int): Int = raw.coerceAtMost(MAX_FFT_SIZE).coerceAtLeast(64)
}

data class RenderSpec(val view: Int, val waveformPoints: Int, val fftBins: Int, val channels: Int, val fftSize: Int = 2048)

@CapacitorPlugin(
    name = "ScopeAudio",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "mic")
    ]
)
class ScopeAudioPlugin : Plugin() {

    @Volatile var isCapturing: Boolean = false
        private set

    /** True while a paired TV is actively receiving frames. The phone then acts
     *  as a headless streamer, so capture must survive losing window focus. */
    val isStreamingToTv: Boolean get() = sender.connected

    companion object {
        @Volatile var instance: ScopeAudioPlugin? = null
    }

    private var browser: com.alpapan.scope.tv.TvBrowser? = null
    private val sender = com.alpapan.scope.tv.PhoneSenderClient { notifyTvDisconnected() }
    @Volatile private var spec = RenderSpec(0, 512, 256, 2)
    private val windowL = SlidingWindow(MAX_FFT_SIZE)
    private val windowR = SlidingWindow(MAX_FFT_SIZE)
    private val smoothScratchL = FloatArray(MAX_FFT_SIZE)
    private val smoothScratchR = FloatArray(MAX_FFT_SIZE)
    @Volatile private var smoothingAlpha: Float = 0f

    override fun load() {
        instance = this
        sender.onControl = { json ->
            when (val a = ControlRouter.route(json)) {
                is PhoneInboundAction.ApplyRequest -> applyRequest(a.json)
                is PhoneInboundAction.ForwardViewRequest -> notifyPhoneViewRequest(a.view)
                PhoneInboundAction.Drop -> android.util.Log.w("ScopeCtl", "dropped inbound control: $json")
            }
        }
    }

    @PluginMethod
    fun startCapture(call: PluginCall) {
        if (isCapturing) {
            call.resolve()
            return
        }
        val ctx = context ?: return call.reject("No Android context")
        val pm = ctx.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        // startActivityForResult launches the system MediaProjection consent
        // dialog. The user dismisses with Allow (RESULT_OK) or Cancel
        // (RESULT_CANCELED). onProjectionResult fires on the main thread when
        // the dialog returns. If the user backgrounds the activity mid-dialog,
        // the result is delivered when the activity resumes.
        //
        // On Android 14+ we force-pin the dialog to "Entire screen" via
        // MediaProjectionConfig.createConfigForDefaultDisplay(). Without this
        // the system shows a "Single app" option whose audio scope is the
        // selected app only - which is useless to a system-audio visualiser.
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            pm.createScreenCaptureIntent(
                MediaProjectionConfig.createConfigForDefaultDisplay()
            )
        } else {
            @Suppress("DEPRECATION")
            pm.createScreenCaptureIntent()
        }
        startActivityForResult(call, intent, "onProjectionResult")
    }

    @ActivityCallback
    fun onProjectionResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            call.reject("Permission denied")
            return
        }
        val intent = Intent(context, AudioCaptureService::class.java).apply {
            putExtra(AudioCaptureService.EXTRA_PROJECTION_RESULT_CODE, result.resultCode)
            putExtra(AudioCaptureService.EXTRA_PROJECTION_DATA, result.data)
        }
        context.startForegroundService(intent)
        AudioCaptureService.pluginRef = this
        isCapturing = true
        // Tell the activity to auto-enter PiP on backgrounding. UI-thread only.
        (bridge?.activity as? MainActivity)?.let { act ->
            act.runOnUiThread { act.setPipAutoEnter(true) }
        }
        call.resolve()
    }

    /** Mic-source capture path. Bypasses AudioPlaybackCapture so it works
     *  for any source on the phone, including ones that opt out with
     *  FLAG_NO_MEDIA_PROJECTION (Spotify music, some Chrome paths). Quality
     *  is reduced (speaker -> mic acoustic loop) but it visualises. */
    @PluginMethod
    fun startMicCapture(call: PluginCall) {
        if (isCapturing) {
            call.resolve()
            return
        }
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micPermissionCallback")
            return
        }
        launchMicService()
        call.resolve()
    }

    @PermissionCallback
    private fun micPermissionCallback(call: PluginCall) {
        if (getPermissionState("mic") == PermissionState.GRANTED) {
            launchMicService()
            call.resolve()
        } else {
            call.reject("Mic permission denied")
        }
    }

    private fun launchMicService() {
        val intent = Intent(context, AudioCaptureService::class.java).apply {
            putExtra(AudioCaptureService.EXTRA_MIC_MODE, true)
        }
        context.startForegroundService(intent)
        AudioCaptureService.pluginRef = this
        isCapturing = true
        (bridge?.activity as? MainActivity)?.let { act ->
            act.runOnUiThread { act.setPipAutoEnter(true) }
        }
    }

    @PluginMethod
    fun stopCapture(call: PluginCall) {
        val intent = Intent(context, AudioCaptureService::class.java)
        context.stopService(intent)
        AudioCaptureService.pluginRef = null
        isCapturing = false
        emitNowPlayingCleared()
        (bridge?.activity as? MainActivity)?.let { act ->
            act.runOnUiThread { act.setPipAutoEnter(false) }
        }
        call.resolve()
    }

    /** Called by MainActivity.onStop when the user dismissed PiP, after the
     *  service has been stopped. Resets the capturing flag so subsequent
     *  startCapture calls take the normal permission path again. */
    fun markStopped() {
        isCapturing = false
    }

    /** Called by AudioCaptureService on its reader thread. */
    fun emitPcmChunk(base64: String) {
        val data = JSObject().apply { put("data", base64) }
        notifyListeners("audioChunk", data)
    }

    /** Diagnostic stream surfaced to JS; the JS overlay renders it in-app
     *  because the device has no adb tether on this build host. */
    fun emitDebug(msg: String) {
        val data = JSObject().apply { put("data", msg) }
        notifyListeners("audioDebug", data)
    }

    /** Called by AudioCaptureService when projection-mode capture is stuck at
     *  zero PCM while another app is actively playing matching usage. JS
     *  should respond by offering the user a switch to mic mode. */
    fun notifySilentCapture() {
        notifyListeners("silentCapture", JSObject())
    }

    /** Called by AudioCaptureService periodically in mic mode when an unflagged
     *  source becomes available; JS can offer the user to switch back to the
     *  higher-quality projection path. */
    /** Phone-side: MediaProjection callback fired onStop (system revoked the
     *  projection). JS shows a banner / offers re-prompt. */
    fun notifyCaptureLost(reason: String) {
        notifyListeners("captureLost", JSObject().put("reason", reason))
    }

    fun notifyUnrestrictedAvailable() {
        notifyListeners("unrestrictedAvailable", JSObject())
    }

    /** Hide / show the system status and navigation bars. Browser-side
     *  document.documentElement.requestFullscreen() does not affect them on
     *  a Capacitor WebView, so JS toggles immersive via this bridge call
     *  instead. BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE keeps a swipe-from-top
     *  gesture available so the user can still pull the bars down briefly. */
    @PluginMethod
    fun setImmersive(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        val activity = bridge?.activity ?: return call.reject("No activity")
        activity.runOnUiThread {
            val window = activity.window
            WindowCompat.setDecorFitsSystemWindows(window, !enabled)
            val controller = WindowInsetsControllerCompat(window, window.decorView)
            if (enabled) {
                controller.systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsetsCompat.Type.systemBars())
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars())
            }
        }
        call.resolve()
    }

    /** Toggle FLAG_KEEP_SCREEN_ON on the activity window. Must run on the UI
     *  thread. The flag is a window attribute, not a permission, so no
     *  manifest changes are required. Cleared again on stopCapture and as a
     *  defence-in-depth measure in MainActivity.onDestroy. */
    @PluginMethod
    fun setKeepScreenOn(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        val activity = bridge?.activity ?: return call.reject("No activity")
        activity.runOnUiThread {
            if (enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
        call.resolve()
    }

    // ---- Phone-paired TV visualiser bridge ----

    /** Returns the app's versionName (from the package manager) for display. */
    @PluginMethod
    fun getAppVersion(call: PluginCall) {
        val name = try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        } catch (_: Throwable) { null }
        call.resolve(JSObject().put("version", name ?: ""))
    }

    @PluginMethod
    fun getFormFactor(call: PluginCall) {
        val tv = (context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION ||
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        call.resolve(JSObject().put("formFactor", if (tv) "tv" else "phone"))
    }

    @PluginMethod
    fun hasNotificationAccess(call: PluginCall) {
        val granted = try {
            NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
        } catch (_: Throwable) { false }
        call.resolve(JSObject().put("granted", granted))
    }

    @PluginMethod
    fun openNotificationAccessSettings(call: PluginCall) {
        try {
            val i = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        } catch (_: Throwable) {}
        call.resolve()
    }

    /** Called by MediaMetadataService on a new track. Forwards to this phone's JS
     *  and (if paired and capturing) to the TV. Gated on isCapturing so the readout
     *  only appears while the scope is capturing. Works headless: this runs on the
     *  native side, so the paired TV is updated even when the phone JS is backgrounded. */
    fun emitNowPlaying(np: NowPlaying?) {
        if (!isCapturing) return
        val data = JSObject()
            .put("title", np?.title ?: "")
            .put("artist", np?.artist ?: "")
            .put("album", np?.album ?: "")
        if (np?.art != null) data.put("art", np.art)
        notifyListeners("nowPlayingChanged", data)
        if (np != null) sender.sendControl(NowPlayingLogic.encodeMessage(np))
    }

    private fun emitNowPlayingCleared() {
        // Not gated on isCapturing: runs as capture stops, to clear the JS state.
        notifyListeners("nowPlayingChanged", JSObject().put("title", "").put("artist", "").put("album", ""))
        // Also clear a paired TV (no-op if not connected): when the phone stops
        // capturing, the TV should drop its readout rather than freeze the card.
        sender.sendControl(NowPlayingLogic.clearMessage())
    }

    /** Phone: start NSD browse; each resolved TV is surfaced as a `tvFound` event. */
    @PluginMethod
    fun discoverTvs(call: PluginCall) {
        browser?.stop()
        browser = com.alpapan.scope.tv.TvBrowser(context).also { b ->
            b.start { name, host, port ->
                notifyListeners("tvFound", JSObject().put("name", name).put("host", host).put("port", port))
            }
        }
        call.resolve()
    }

    /** Phone: connect+pair to a TV, then start feeding analysis frames from capture. */
    @PluginMethod
    fun connectTv(call: PluginCall) {
        val host = call.getString("host") ?: return call.reject("host")
        val port = call.getInt("port") ?: return call.reject("port")
        val code = call.getString("code") ?: return call.reject("code")
        Thread {
            val ok = try { sender.connect(host, port, code) } catch (_: Throwable) { false }
            if (ok) {
                com.alpapan.scope.AudioCaptureService.pcmTap = makePcmTap()
                notifyTvConnected()
                call.resolve()
            } else {
                call.reject("pairing failed")
            }
        }.start()
    }

    @PluginMethod
    fun disconnectTv(call: PluginCall) {
        com.alpapan.scope.AudioCaptureService.pcmTap = null
        sender.close(); browser?.stop(); browser = null
        call.resolve()
    }

    /** Bidirectional: applies the request to the phone's spec AND (if this is the
     *  TV) forwards it to the paired phone over the control channel. */
    @PluginMethod
    fun sendRenderRequest(call: PluginCall) {
        val json = call.data.toString()
        applyRequest(json)                                          // phone-local spec (headless: drives makePcmTap)
        com.alpapan.scope.tv.TvReceiverService.sendControl(json)    // TV -> phone (no-op if not the TV)
        call.resolve()
    }

    /** Phone: push the current view + theme to the paired TV so the TV mirrors
     *  the phone's visual state. JSON shape: {type:"mirror-state", view, theme}.
     *  No-op at the wire level when not connected (PhoneSenderClient.enqueue
     *  silently drops when !connected). */
    @PluginMethod
    fun sendPhoneMirror(call: PluginCall) {
        sender.sendControl(call.data.toString())
        call.resolve()
    }

    /** Phone: set the EMA smoothing alpha used by the phone-side WaveformPrep
     *  pipeline (mirrors the JS state.smoothing slider into native). */
    @PluginMethod
    fun setSmoothingAlpha(call: PluginCall) {
        smoothingAlpha = call.getFloat("value") ?: 0f
        call.resolve()
    }

    /** TV: start the receiver service and return the pairing code to show. */
    @PluginMethod
    fun startTvReceiver(call: PluginCall) {
        val sess = com.alpapan.scope.tv.PairingSession()
        com.alpapan.scope.tv.TvReceiverService.session = sess
        com.alpapan.scope.tv.TvReceiverService.onCodeRotated = { c ->
            notifyListeners("tvPairCode", JSObject().put("code", c))
        }
        context.startService(Intent(context, com.alpapan.scope.tv.TvReceiverService::class.java))
        call.resolve(JSObject().put("code", sess.code).put("ip", com.alpapan.scope.tv.LanIp.current()))
    }

    @PluginMethod
    fun stopTvReceiver(call: PluginCall) {
        context.stopService(Intent(context, com.alpapan.scope.tv.TvReceiverService::class.java))
        call.resolve()
    }

    fun notifyTvConnected() = notifyListeners("tvConnected", JSObject())
    fun notifyTvDisconnected() {
        com.alpapan.scope.AudioCaptureService.pcmTap = null
        notifyListeners("tvDisconnected", JSObject())
    }
    fun notifyTvRenderRequest(json: String) {
        applyRequest(json)
        notifyListeners("tvRenderRequest", JSObject().put("json", json))
    }
    /** Phone-side: forwards a TV remote D-pad press from the paired TV up to JS
     *  so JS can update state.view and re-mirror back to the TV (single source
     *  of truth on the phone). */
    fun notifyPhoneViewRequest(view: Int) {
        notifyListeners("phoneViewRequest", JSObject().put("view", view))
    }
    fun notifyTvAnalysisFrame(b64: String) = notifyListeners("tvAnalysisFrame", JSObject().put("data", b64))

    private fun applyRequest(json: String) {
        try {
            val o = JSONObject(json)
            spec = RenderSpec(
                o.optInt("view", 0),
                o.optInt("waveformPoints", 512),
                o.optInt("fftBins", 256),
                o.optInt("channels", 2),
                RenderSpecClamp.clampFftSize(o.optInt("fftSize", 2048)),
            )
        } catch (_: Throwable) {}
    }

    /** Apply WIRE_DOWNSAMPLE_FACTOR (ratio output/input). factor >= 1f means
     *  no downsample - wire carries the full prepped buffer (TV waveform
     *  equals phone waveform). factor < 1f reduces wire bandwidth by that
     *  ratio at the cost of TV waveform detail. */
    private fun downsampleForWireIfConfigured(buf: FloatArray): FloatArray {
        if (WIRE_DOWNSAMPLE_FACTOR >= 1f) return buf
        val target = (buf.size * WIRE_DOWNSAMPLE_FACTOR).toInt().coerceAtLeast(1)
        return com.alpapan.scope.tv.Dsp.downsample(buf, target)
    }

    /** Capture-thread callback: pushes raw PCM into the sliding window, reads
     *  the latest spec.fftSize samples, runs view-specific prep (smoothing +
     *  optional trigger for waveform), optionally downsamples for the wire,
     *  then hands to the sender's bounded queue. */
    private fun makePcmTap(): (FloatArray, FloatArray?) -> Unit = tap@{ left, right ->
        val s = spec
        windowL.push(left)
        if (right != null) windowR.push(right)
        val winL = windowL.last(s.fftSize)
        val winR = if (s.channels == 2 && right != null) windowR.last(s.fftSize) else null
        val frame = when (s.view) {
            11 -> return@tap                                                    // now-playing view: text-only card, event-driven; no per-frame frame
            1 -> {                                                              // spectrum: mono mix -> FFT dB on the window
                val mono = FloatArray(winL.size) {
                    (winL[it] + (winR?.getOrElse(it) { winL[it] } ?: winL[it])) * 0.5f
                }
                val mags = com.alpapan.scope.tv.Dsp.downsample(com.alpapan.scope.tv.Fft.magnitudes(mono), s.fftBins)
                val db = FloatArray(mags.size) { 20f * log10((mags[it] + 1e-9f)) }
                com.alpapan.scope.tv.AnalysisFrameCodec.encodeSpectrum(s.view, db)
            }
            2 -> {                                                              // lissajous: pcmSmooth + smoothBuf on both channels
                val sL = WaveformPrep.pcmSmooth(winL, smoothScratchL)
                val emaL = WaveformPrep.smoothBuf("L", sL, smoothingAlpha)
                val dL = downsampleForWireIfConfigured(emaL)
                val dR = if (winR != null) {
                    val sR = WaveformPrep.pcmSmooth(winR, smoothScratchR)
                    val emaR = WaveformPrep.smoothBuf("R", sR, smoothingAlpha)
                    downsampleForWireIfConfigured(emaR)
                } else null
                com.alpapan.scope.tv.AnalysisFrameCodec.encodeWaveform(s.view, dL, dR)
            }
            3, 4 -> {                                                              // cosmos/grove: mono waveform + FFT
                val sL = WaveformPrep.pcmSmooth(winL, smoothScratchL)
                val emaL = WaveformPrep.smoothBuf("L", sL, smoothingAlpha)
                val dL = downsampleForWireIfConfigured(emaL)
                val mono = FloatArray(winL.size) {
                    (winL[it] + (winR?.getOrElse(it) { winL[it] } ?: winL[it])) * 0.5f
                }
                val mags = com.alpapan.scope.tv.Dsp.downsample(com.alpapan.scope.tv.Fft.magnitudes(mono), s.fftBins)
                val db = FloatArray(mags.size) { 20f * log10((mags[it] + 1e-9f)) }
                com.alpapan.scope.tv.AnalysisFrameCodec.encodeWaveformAndSpectrum(s.view, dL, null, db)
            }
            5 -> {                                                              // firebird: stereo waveform + FFT
                val sL = WaveformPrep.pcmSmooth(winL, smoothScratchL)
                val dL = downsampleForWireIfConfigured(WaveformPrep.smoothBuf("L", sL, smoothingAlpha))
                val dR = if (winR != null) {
                    val sR = WaveformPrep.pcmSmooth(winR, smoothScratchR)
                    downsampleForWireIfConfigured(WaveformPrep.smoothBuf("R", sR, smoothingAlpha))
                } else null
                val mono = FloatArray(winL.size) {
                    (winL[it] + (winR?.getOrElse(it) { winL[it] } ?: winL[it])) * 0.5f
                }
                val mags = com.alpapan.scope.tv.Dsp.downsample(com.alpapan.scope.tv.Fft.magnitudes(mono), s.fftBins)
                val db = FloatArray(mags.size) { 20f * log10((mags[it] + 1e-9f)) }
                com.alpapan.scope.tv.AnalysisFrameCodec.encodeWaveformAndSpectrum(s.view, dL, dR, db)
            }
            6, 7, 8, 9, 10 -> {                                                 // spiral/bloom/lasso/starburst/nova: reuse the stereo-waveform prep (like lissajous, case 2)
                val sL = WaveformPrep.pcmSmooth(winL, smoothScratchL)
                val emaL = WaveformPrep.smoothBuf("L", sL, smoothingAlpha)
                val dL = downsampleForWireIfConfigured(emaL)
                val dR = if (winR != null) {
                    val sR = WaveformPrep.pcmSmooth(winR, smoothScratchR)
                    val emaR = WaveformPrep.smoothBuf("R", sR, smoothingAlpha)
                    downsampleForWireIfConfigured(emaR)
                } else null   // mono-paired source: shapes fall back to L-only
                com.alpapan.scope.tv.AnalysisFrameCodec.encodeWaveform(s.view, dL, dR)
            }
            else -> {                                                           // waveform (view==0): smooth + trigger + trim + downsample
                val sL = WaveformPrep.pcmSmooth(winL, smoothScratchL)
                val emaL = WaveformPrep.smoothBuf("L", sL, smoothingAlpha)
                val start = WaveformPrep.findZeroCrossing(emaL)
                val trimmed = if (start == 0) emaL else emaL.copyOfRange(start, emaL.size)
                val dL = downsampleForWireIfConfigured(trimmed)
                com.alpapan.scope.tv.AnalysisFrameCodec.encodeWaveform(s.view, dL, null)
            }
        }
        sender.enqueue(frame)
    }
}
