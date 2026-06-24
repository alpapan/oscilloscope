package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** In mic mode, now-playing must be excluded from the view cycle (view-ids.js viewsFor). */
@RunWith(AndroidJUnit4::class)
class MicModeViewExclusionTest {
    private lateinit var s: ActivityScenario<MainActivity>

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun nowPlayingUnreachableInMicMode() {
        s = JourneySupport.launchReady()
        // micModeAuto must be false: if true, onUnrestrictedAvailable auto-switches back to
        // projection mode (state.micMode=false) and nowplaying re-enters the cycle.
        // DrawerControlsTest resets it to false, but guard here in case of test-order changes.
        JourneySupport.eval(s, "var m=document.getElementById('mobile-micmode-auto'); if(m&&m.checked){m.checked=false; m.dispatchEvent(new Event('change',{bubbles:true}));} 'ok'")
        JourneySupport.startMicCapture(s)

        // The exclusion lives in cycleView (viewsFor drops nowplaying in mic mode), NOT in the
        // drawer <select> (mobile-ui.js populates that once with all 12 views). So cycle more
        // than the full view count and confirm nowplaying is never the current view.
        var sawNowplaying = false
        repeat(15) {
            JourneySupport.eval(s, "window.cycleView && window.cycleView(1); 'ok'")
            Thread.sleep(250)
            if (JourneySupport.currentView(s) == "nowplaying") sawNowplaying = true
        }
        check(!sawNowplaying) { "nowplaying was reachable in mic mode" }
        check(JourneySupport.proveScopeState(s, "micmode-01-no-nowplaying", "(document.getElementById('mobile-view')||{}).value !== 'nowplaying'") is ShotResult.Success)
    }
}
