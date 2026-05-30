package com.alpapan.scope
import org.junit.Assert.*
import org.junit.Test
class CaptureLifecycleTest {
    @Test fun keeps_capturing_while_streaming_to_tv_even_without_pip() {
        // The phone is a headless streamer; losing focus must NOT kill capture.
        assertFalse(CaptureLifecycle.shouldStopOnStop(isFinishing = false, inPiP = false, streamingToTv = true))
    }
    @Test fun keeps_capturing_while_in_pip() {
        assertFalse(CaptureLifecycle.shouldStopOnStop(isFinishing = false, inPiP = true, streamingToTv = false))
    }
    @Test fun stops_when_backgrounded_with_no_pip_and_no_tv() {
        assertTrue(CaptureLifecycle.shouldStopOnStop(isFinishing = false, inPiP = false, streamingToTv = false))
    }
    @Test fun stops_when_finishing_regardless_of_streaming() {
        assertTrue(CaptureLifecycle.shouldStopOnStop(isFinishing = true, inPiP = false, streamingToTv = true))
        assertTrue(CaptureLifecycle.shouldStopOnStop(isFinishing = true, inPiP = true, streamingToTv = true))
    }
}
