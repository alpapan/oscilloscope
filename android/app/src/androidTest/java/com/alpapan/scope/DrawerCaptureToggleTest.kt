package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DrawerCaptureToggleTest {

    private lateinit var s: ActivityScenario<MainActivity>

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun toggleCaptureSourceFromDrawer() {
        s = JourneySupport.launchReady()
        // start system capture, accept the MediaProjection consent
        JourneySupport.clickId(s, "mobile-capture")
        JourneySupport.tapDialog("android:id/button1")
        JourneySupport.assertJs(s, "document.getElementById('mobile-start').hidden === true")
        check(JourneySupport.proveScopeState(s, "01-canvas", "document.getElementById('mobile-start').hidden === true") is ShotResult.Success)
        // open the settings drawer; assert it actually slid into the viewport
        // (translateY(-100%) when closed -> rect.bottom ~= 0; translateY(0) when
        // open -> rect.bottom == its height), then that the active pill reads "system"
        JourneySupport.eval(s, "document.body.classList.add('drawer-open'); 'ok'")
        JourneySupport.assertJs(s, "document.getElementById('mobile-drawer').getBoundingClientRect().bottom > 50")
        JourneySupport.assertJs(s, "!!document.querySelector('.capture-opt[data-mic=\"false\"].active')")
        check(JourneySupport.proveScopeState(s, "02-drawer-system", "document.body.classList.contains('drawer-open') && !!document.querySelector('.capture-opt[data-mic=\"false\"].active')") is ShotResult.Success)
        // switch to mic (RECORD_AUDIO pre-granted, so the permission dialog is optional)
        JourneySupport.eval(s, "document.querySelector('.capture-opt[data-mic=\"true\"]').click(); 'ok'")
        JourneySupport.tapDialog("com.android.permissioncontroller:id/permission_allow_foreground_only_button", 3000)
        JourneySupport.assertJs(s, "!!document.querySelector('.capture-opt[data-mic=\"true\"].active')")
        check(JourneySupport.proveScopeState(s, "03-mic-active", "!!document.querySelector('.capture-opt[data-mic=\"true\"].active')") is ShotResult.Success)
        // switch back to system; this restarts capture so the consent dialog reappears
        JourneySupport.eval(s, "document.querySelector('.capture-opt[data-mic=\"false\"]').click(); 'ok'")
        JourneySupport.tapDialog("android:id/button1", 3000)
        JourneySupport.assertJs(s, "!!document.querySelector('.capture-opt[data-mic=\"false\"].active')")
        check(JourneySupport.proveScopeState(s, "04-system-again", "!!document.querySelector('.capture-opt[data-mic=\"false\"].active')") is ShotResult.Success)
    }
}
