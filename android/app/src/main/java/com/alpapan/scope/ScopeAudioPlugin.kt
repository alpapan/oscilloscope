package com.alpapan.scope

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "ScopeAudio")
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
        startActivityForResult(call, pm.createScreenCaptureIntent(), "onProjectionResult")
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
        call.resolve()
    }

    @PluginMethod
    fun stopCapture(call: PluginCall) {
        val intent = Intent(context, AudioCaptureService::class.java)
        context.stopService(intent)
        AudioCaptureService.pluginRef = null
        isCapturing = false
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
}
