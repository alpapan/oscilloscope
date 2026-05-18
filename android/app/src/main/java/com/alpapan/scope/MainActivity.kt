package com.alpapan.scope

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.os.Bundle
import android.util.Rational
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ScopeAudioPlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val plugin = ScopeAudioPlugin.instance
        if (plugin?.isCapturing == true) {
            enterPipMode()
        }
    }

    private fun enterPipMode() {
        val cycleIntent = Intent(this, ScopePipReceiver::class.java).apply {
            action = ScopePipReceiver.ACTION_CYCLE_VIEW
        }
        val cyclePi = PendingIntent.getBroadcast(
            this,
            0,
            cycleIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val cycleAction = RemoteAction(
            Icon.createWithResource(this, R.drawable.ic_cycle_view),
            "Next view",
            "Cycle visualiser view",
            cyclePi
        )
        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setActions(listOf(cycleAction))
            .build()
        try {
            enterPictureInPictureMode(params)
        } catch (_: IllegalStateException) {
            // PiP unsupported / disabled. Fall back: stop capture so service is cleaned up.
            ScopeAudioPlugin.instance?.let { plugin ->
                if (plugin.isCapturing) {
                    stopService(Intent(this, AudioCaptureService::class.java))
                }
            }
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        val js = "document.body.classList.toggle('pip', $isInPictureInPictureMode);"
        bridge?.webView?.post {
            bridge?.webView?.evaluateJavascript(js, null)
        }
    }

    override fun onStop() {
        super.onStop()
        // Stop capture when the activity actually leaves view.
        //   isFinishing = true: user explicitly closed the app (back gesture, exitApp).
        //   isInPictureInPictureMode = false AT THIS POINT means the PiP window
        //     was dismissed (close button or swipe-away) before onStop fired
        //     - Android delivers onPictureInPictureModeChanged(false) first, then
        //     onStop. Locking the phone while still in PiP keeps the flag true,
        //     so capture survives screen-off. Expanding PiP back to fullscreen
        //     does not call onStop at all, so capture also survives that path.
        if (isFinishing || !isInPictureInPictureMode) {
            stopService(Intent(this, AudioCaptureService::class.java))
            ScopeAudioPlugin.instance?.markStopped()
        }
    }
}
