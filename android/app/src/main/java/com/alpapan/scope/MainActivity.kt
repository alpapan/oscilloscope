package com.alpapan.scope

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.os.Bundle
import android.util.Rational
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ScopeAudioPlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    /**
     * Update Picture-in-Picture params. When [autoEnter] is true the system
     * automatically enters PiP whenever the activity would otherwise go to
     * background (Android 12+); we also attach the cycle-view RemoteAction
     * so the PiP window shows a working button. When false, autoEnter is
     * disabled so backgrounding the app without capture does not pop a PiP.
     *
     * Called from ScopeAudioPlugin on the UI thread when capture starts/stops.
     */
    fun setPipAutoEnter(autoEnter: Boolean) {
        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setAutoEnterEnabled(autoEnter)
            .setSeamlessResizeEnabled(true)
        if (autoEnter) {
            builder.setActions(listOf(buildCycleViewAction()))
        }
        try {
            setPictureInPictureParams(builder.build())
        } catch (_: IllegalStateException) {
            // Activity not in a state that accepts PiP params right now;
            // safe to ignore - the next call will retry.
        }
    }

    private fun buildCycleViewAction(): RemoteAction {
        val cycleIntent = Intent(this, ScopePipReceiver::class.java).apply {
            action = ScopePipReceiver.ACTION_CYCLE_VIEW
        }
        val cyclePi = PendingIntent.getBroadcast(
            this,
            0,
            cycleIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return RemoteAction(
            Icon.createWithResource(this, R.drawable.ic_cycle_view),
            "Next view",
            "Cycle visualiser view",
            cyclePi
        )
    }

    /**
     * Fallback for devices where autoEnter does not fire (some older Android
     * versions, some third-party launchers). Manually enters PiP if the
     * system has not already done so via autoEnter.
     */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val plugin = ScopeAudioPlugin.instance
        if (plugin?.isCapturing == true && !isInPictureInPictureMode) {
            enterPipMode()
        }
    }

    private fun enterPipMode() {
        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setActions(listOf(buildCycleViewAction()))
            .setSeamlessResizeEnabled(true)
            .build()
        try {
            enterPictureInPictureMode(params)
        } catch (_: IllegalStateException) {
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
        //   streamingToTv = true: the phone is a headless TV streamer, so it must
        //     keep capturing even with no PiP and no focus (else mic dies on
        //     background and never restarts).
        val streaming = ScopeAudioPlugin.instance?.isStreamingToTv == true
        val willStop = CaptureLifecycle.shouldStopOnStop(isFinishing, isInPictureInPictureMode, streaming)
        android.util.Log.i("ScopeLife", "onStop finishing=$isFinishing pip=$isInPictureInPictureMode streamingTv=$streaming -> ${if (willStop) "STOP service" else "keep capturing"}")
        if (willStop) {
            stopService(Intent(this, AudioCaptureService::class.java))
            ScopeAudioPlugin.instance?.markStopped()
        }
    }

    override fun onDestroy() {
        // Defence-in-depth: ensure the keep-screen-on flag does not outlive
        // the activity. ScopeAudioPlugin.setKeepScreenOn clears it on toggle-
        // off, but a force-stop or crash skips that path.
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }
}
