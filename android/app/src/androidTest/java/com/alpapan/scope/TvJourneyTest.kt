package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assume
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Verifies the TV-mode init path on the same APK that runs on phones.
 * On a phone or FTL emulator the form-factor assumption skips every test.
 * On Sabrina (Google TV) launchReadyTv() waits for tv-pair-overlay to appear,
 * the final DOM signal that startTvMode() and startTvReceiver() completed.
 */
@RunWith(AndroidJUnit4::class)
class TvJourneyTest {

    private lateinit var s: ActivityScenario<MainActivity>

    @Before
    fun setup() {
        val uiModeManager = InstrumentationRegistry.getInstrumentation()
            .targetContext.getSystemService(android.content.Context.UI_MODE_SERVICE)
            as android.app.UiModeManager
        Assume.assumeTrue(
            "TvJourneyTest: not a TV device, skipping",
            uiModeManager.currentModeType == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION,
        )
        JourneySupport.resetApp()
    }

    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test
    fun tvPairCodeShows() {
        s = JourneySupport.launchReadyTv()
        val r = JourneySupport.proveScopeState(
            s, "tv-01-pair-code",
            "!document.getElementById('tv-pair-overlay').hidden",
        )
        check(r is ShotResult.Success) {
            "TV pair code screen did not render: ${(r as ShotResult.Failure).reason}"
        }
    }
}
