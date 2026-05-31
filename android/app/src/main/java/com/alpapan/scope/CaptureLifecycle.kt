package com.alpapan.scope

/** Decides whether MainActivity.onStop should tear down the capture service.
 *  Kept pure so the lifecycle rule is unit-tested without an Activity.
 *
 *  Keep capture alive when ANY of: in PiP, streaming to a paired TV, or
 *  actively capturing locally (mic or system-audio). The manifest declares
 *  foregroundServiceType="mediaProjection|microphone" so Android permits
 *  background continuation. The only forced-stop case is isFinishing
 *  (user explicitly closed the app via back gesture or exitApp). */
object CaptureLifecycle {
    fun shouldStopOnStop(isFinishing: Boolean, inPiP: Boolean, streamingToTv: Boolean, isCapturing: Boolean): Boolean =
        isFinishing || (!inPiP && !streamingToTv && !isCapturing)

    /** Decides whether AudioCaptureService.onTaskRemoved should stop the service.
     *  User swiped the app from recents - if we are not capturing, stop; if we
     *  are, keep going so audio is not interrupted. The OS will recreate per
     *  START_STICKY if it kills us anyway, but explicit handling avoids the
     *  MediaProjection-token-lost path that recreation goes through. */
    fun shouldStopOnTaskRemoved(isCapturing: Boolean): Boolean = !isCapturing
}
