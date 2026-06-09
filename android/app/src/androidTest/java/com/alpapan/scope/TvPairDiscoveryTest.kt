package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvPairDiscoveryTest {

    private lateinit var s: ActivityScenario<MainActivity>

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun connectToTvShowsDiscoverySurface() {
        s = JourneySupport.launchReady()
        // capture must be active before the drawer exposes Connect to TV
        JourneySupport.clickId(s, "mobile-capture")
        JourneySupport.tapDialog("android:id/button1")
        JourneySupport.assertJs(s, "document.getElementById('mobile-start').hidden === true")
        // open the drawer and confirm it actually slid into view (the fixed,
        // display:flex drawer means offsetParent is never null, so assert the
        // transform landed: rect.bottom ~= 0 closed -> == its height when open)
        JourneySupport.eval(s, "document.body.classList.add('drawer-open'); 'ok'")
        JourneySupport.assertJs(s, "document.getElementById('mobile-drawer').getBoundingClientRect().bottom > 50")
        // open the pairing surface; mDNS discovery shows "Searching" then offers manual IP entry
        JourneySupport.clickId(s, "mobile-connect-tv")
        JourneySupport.assertJs(s, "/Enter IP manually|Searching/i.test(document.body.innerText)")
        check(JourneySupport.proveScopeState(s, "01-pair-surface", "/Enter IP manually|Searching/i.test(document.body.innerText)") is ShotResult.Success)
    }
}
