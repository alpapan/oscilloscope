package com.alpapan.scope

import android.media.MediaPlayer
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Capture once, then cycle through every view and screenshot each. Proves all 12 views render on the device. */
@RunWith(AndroidJUnit4::class)
class ViewWalkTest {
    private lateinit var s: ActivityScenario<MainActivity>
    private var tone: MediaPlayer? = null

    private val views = listOf(
        "waveform", "spectrum", "lissajous", "cosmos", "grove", "firebird",
        "spiral", "bloom", "lasso", "starburst", "nova", "nowplaying",
    )

    // Grant notification access too so the now-playing card has its MediaSession listener
    // active when we reach that view (NowPlayingTest covers the populated-metadata case).
    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic(); JourneySupport.grantNotificationAccess() }
    @After fun tearDown() {
        try { tone?.stop(); tone?.release() } catch (_: Throwable) {}
        if (::s.isInitialized) s.close()
    }

    @Test fun everyViewRenders() {
        tone = JourneySupport.startMediaTone()

        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)

        views.forEachIndexed { i, v ->
            JourneySupport.cycleToView(s, v)
            Thread.sleep(1500)               // let the scene animate a few frames
            val name = "view-%02d-%s".format(i + 1, v)
            val predicate = "(document.getElementById('mobile-view')||{}).value === '$v'"
            val r = JourneySupport.proveScopeState(s, name, predicate)
            check(r is ShotResult.Success) { "view $v gate failed: ${(r as ShotResult.Failure).reason}" }
        }
    }
}
