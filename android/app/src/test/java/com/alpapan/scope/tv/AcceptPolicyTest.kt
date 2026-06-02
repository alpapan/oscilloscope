package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test

class AcceptPolicyTest {
    @Test fun retriesWhileRunningOnTransient() {
        assertTrue(AcceptPolicy.shouldRetry(running = true, serverClosed = false))
    }
    @Test fun stopsWhenNotRunning() {
        assertFalse(AcceptPolicy.shouldRetry(running = false, serverClosed = false))
    }
    @Test fun stopsWhenServerClosed() {
        assertFalse(AcceptPolicy.shouldRetry(running = true, serverClosed = true))
    }
}
