package com.alpapan.scope

/** Decides whether MainActivity.onStop should tear down the capture service.
 *  Kept pure so the lifecycle rule is unit-tested without an Activity. */
object CaptureLifecycle {
    fun shouldStopOnStop(isFinishing: Boolean, inPiP: Boolean, streamingToTv: Boolean): Boolean =
        isFinishing || (!inPiP && !streamingToTv)
}
