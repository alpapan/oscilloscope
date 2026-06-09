package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProveDialogStateTest {
    private lateinit var s: ActivityScenario<MainActivity>
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun proveDialogState_succeeds_whenProjectionConsentIsOnTop() {
        s = JourneySupport.launchReady()
        // Trigger the consent dialog without dismissing it.
        JourneySupport.clickId(s, "mobile-capture")
        // Wait for the dialog's package to be on top, then prove + screenshot it.
        val result = JourneySupport.proveDialogState("proj-consent", "android:id/button1", timeoutMs = 8000)
        assertTrue("result is Success", result is ShotResult.Success)
    }
}
