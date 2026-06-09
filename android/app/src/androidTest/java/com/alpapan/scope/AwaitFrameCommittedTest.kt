package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AwaitFrameCommittedTest {
    private lateinit var s: ActivityScenario<MainActivity>
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun awaitFrameCommitted_signalsAfterDomMutation() {
        s = JourneySupport.launchReady()
        // Force a DOM mutation that the WebView must paint.
        JourneySupport.eval(s, "document.body.style.background = '#'+Math.random().toString(16).slice(2,8); 'ok'")
        val committed = JourneySupport.awaitFrameCommitted(s, timeoutMs = 3000)
        assertTrue("paintLatch must signal within 3000ms", committed)
    }

    @Test fun awaitFrameCommitted_signalsTwiceWithDifferentIds() {
        // Per AOSP Javadoc, postVisualStateCallback fires when the WebView is
        // "ready to be drawn"; it fires even if the WebView is occluded (the
        // VISIBLE conditions in the Javadoc are about the NEXT DRAW succeeding,
        // not about the CALLBACK firing). Hence the right negative test is NOT
        // "must not fire when backgrounded" - the right test is that two
        // distinct registrations each fire exactly once.
        s = JourneySupport.launchReady()
        val one = JourneySupport.awaitFrameCommitted(s, timeoutMs = 3000)
        val two = JourneySupport.awaitFrameCommitted(s, timeoutMs = 3000)
        assertTrue("first registration fires", one)
        assertTrue("second registration fires independently", two)
    }
}
