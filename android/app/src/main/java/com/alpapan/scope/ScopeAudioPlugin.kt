package com.alpapan.scope

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.view.WindowManager
import androidx.activity.result.ActivityResult
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

@CapacitorPlugin(
    name = "ScopeAudio",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "mic")
    ]
)
class ScopeAudioPlugin : Plugin() {

    @Volatile var isCapturing: Boolean = false
        private set

    companion object {
        @Volatile var instance: ScopeAudioPlugin? = null
    }

    override fun load() {
        instance = this
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
}
