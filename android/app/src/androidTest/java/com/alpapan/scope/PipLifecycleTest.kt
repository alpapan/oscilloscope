package com.alpapan.scope

import android.content.pm.PackageManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Capture, background the activity, and confirm the app enters Picture-in-Picture (auto-enter path). */
@RunWith(AndroidJUnit4::class)
class PipLifecycleTest {
    private lateinit var s: ActivityScenario<MainActivity>

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun entersPipOnBackground() {
        val pm = InstrumentationRegistry.getInstrumentation().targetContext.packageManager
        assumeTrue("device lacks PiP", pm.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE))

        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)

        JourneySupport.device.pressHome()        // triggers onUserLeaveHint / auto-enter PiP
        // proveScopePipState polls for isInPictureInPictureMode, screenshots the PiP window,
        // and subsumes the explicit inPip check - lifecycle is STARTED (not RESUMED) in PiP.
        val r = JourneySupport.proveScopePipState(s, "pip-01-window")
        check(r is ShotResult.Success) { "PiP gate failed: ${(r as ShotResult.Failure).reason}" }
    }
}
