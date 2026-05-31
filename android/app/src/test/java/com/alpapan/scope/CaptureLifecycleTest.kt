package com.alpapan.scope
import org.junit.Assert.*
import org.junit.Test
class CaptureLifecycleTest {
    @Test fun keeps_capturing_while_streaming_to_tv_even_without_pip() {
        // The phone is a headless streamer; losing focus must NOT kill capture.
        assertFalse(CaptureLifecycle.shouldStopOnStop(isFinishing = false, inPiP = false, streamingToTv = true, isCapturing = true))
    }
    @Test fun keeps_capturing_while_in_pip() {
        assertFalse(CaptureLifecycle.shouldStopOnStop(isFinishing = false, inPiP = true, streamingToTv = false, isCapturing = true))
    }
    @Test fun keeps_capturing_when_capturing_locally_even_without_pip_or_tv() {
        // Local capture (mic or system-audio) must survive backgrounding so the user
        // can switch apps without dropping audio. Foreground service types in the
        // manifest (mediaProjection|microphone) allow Android to keep us alive.
        assertFalse(CaptureLifecycle.shouldStopOnStop(isFinishing = false, inPiP = false, streamingToTv = false, isCapturing = true))
    }
    @Test fun stops_when_backgrounded_with_nothing_active() {
        // Nothing to keep alive - all gates false.
        assertTrue(CaptureLifecycle.shouldStopOnStop(isFinishing = false, inPiP = false, streamingToTv = false, isCapturing = false))
    }
    @Test fun stops_when_finishing_regardless_of_other_flags() {
        assertTrue(CaptureLifecycle.shouldStopOnStop(isFinishing = true, inPiP = false, streamingToTv = true, isCapturing = true))
        assertTrue(CaptureLifecycle.shouldStopOnStop(isFinishing = true, inPiP = true, streamingToTv = true, isCapturing = true))
        assertTrue(CaptureLifecycle.shouldStopOnStop(isFinishing = true, inPiP = false, streamingToTv = false, isCapturing = false))
    }

    @Test fun keeps_service_alive_on_task_removed_when_capturing() {
        // User swipes the app from recents while capture is active - service must
        // continue so audio (mic / system-audio via MediaProjection) is not interrupted.
        assertFalse(CaptureLifecycle.shouldStopOnTaskRemoved(isCapturing = true))
    }
    @Test fun stops_service_on_task_removed_when_not_capturing() {
        // No capture in progress; nothing to keep alive.
        assertTrue(CaptureLifecycle.shouldStopOnTaskRemoved(isCapturing = false))
    }
}
