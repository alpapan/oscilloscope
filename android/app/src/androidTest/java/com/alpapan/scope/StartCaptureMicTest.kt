package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StartCaptureMicTest {

    private lateinit var s: ActivityScenario<MainActivity>

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun startMicCaptureRunsForegroundService() {
        s = JourneySupport.launchReady()
        // mic capture: RECORD_AUDIO is pre-granted so the permission dialog is optional
        JourneySupport.clickId(s, "mobile-capture-mic")
        JourneySupport.tapDialog("com.android.permissioncontroller:id/permission_allow_foreground_only_button", 3000)
        JourneySupport.assertJs(s, "document.getElementById('mobile-start').hidden === true")
        JourneySupport.assertJs(s, "!!document.querySelector('.capture-opt[data-mic=\"true\"].active')")
        // the native foreground service can lag the JS success signal; poll briefly
        val deadline = System.currentTimeMillis() + 8000
        while (System.currentTimeMillis() < deadline && !JourneySupport.isForegroundService(".AudioCaptureService")) Thread.sleep(250)
        check(JourneySupport.isForegroundService(".AudioCaptureService")) { "AudioCaptureService is not running in the foreground" }
        check(JourneySupport.proveScopeState(s, "01-mic-canvas", "document.getElementById('mobile-start').hidden === true") is ShotResult.Success)
    }
}
