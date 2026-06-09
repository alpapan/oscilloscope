package com.alpapan.scope

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EnsureForegroundTest {
    private lateinit var s: ActivityScenario<MainActivity>
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun ensureForeground_returnsResumedAfterPressHome() {
        s = JourneySupport.launchReady()
        JourneySupport.device.pressHome()
        Thread.sleep(500)
        val ok = JourneySupport.ensureForeground(s, timeoutMs = 5000)
        assertEquals("ensureForeground must succeed", true, ok)
        // Verify the lifecycle is actually RESUMED, not just "intent fired".
        var state: Lifecycle.State = Lifecycle.State.DESTROYED
        s.onActivity { state = it.lifecycle.currentState }
        assertEquals("lifecycle RESUMED", Lifecycle.State.RESUMED, state)
        // And that the topFocusedWindow belongs to us.
        val focus = JourneySupport.currentPackageOnTop()
        assertEquals(JourneySupport.PKG, focus)
    }
}
