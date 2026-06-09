package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Exercise the canvas gesture wiring: single-tap cycles palette, double-tap cycles view, swipe-down opens the drawer. */
@RunWith(AndroidJUnit4::class)
class GestureTest {
    private lateinit var s: ActivityScenario<MainActivity>

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun canvasGesturesDriveActions() {
        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)
        JourneySupport.cycleToView(s, "waveform")   // a tappable view (now-playing card has pointer-events:none over canvas)

        // Double-tap cycles the view (waveform -> spectrum). The assertJs poll IS the
        // confirmation the gesture fired; if it does not, the test fails here (not silently).
        JourneySupport.doubleTapCanvas(s)
        JourneySupport.assertJs(s, "(document.getElementById('mobile-view')||{}).value === 'spectrum'")
        check(JourneySupport.proveScopeState(s, "gesture-01-doubletap-view", "(document.getElementById('mobile-view')||{}).value === 'spectrum'") is ShotResult.Success)

        // Single-tap cycles the palette; the single-tap action fires after the 300ms double-tap window.
        // The before/after check below is the palette-CHANGE proof; the gated shot only needs a
        // boolean predicate confirming a palette is active (a non-empty theme string would not
        // satisfy proveScopeState's strict ==="true" contract).
        val before = JourneySupport.currentTheme(s)
        JourneySupport.tapCanvas(s)
        Thread.sleep(500)
        val after = JourneySupport.currentTheme(s)
        check(before != after) { "single-tap did not change palette ($before -> $after)" }
        check(JourneySupport.proveScopeState(s, "gesture-02-singletap-palette", "!!document.querySelector('#mobile-theme-chips .chip.active, #mobile-sns-chip.active')") is ShotResult.Success)

        // Swipe-down opens the drawer.
        JourneySupport.swipeDownCanvas(s)
        JourneySupport.assertJs(s, "document.getElementById('mobile-drawer').getBoundingClientRect().bottom > 50")
        check(JourneySupport.proveScopeState(s, "gesture-03-swipedown-drawer", "document.getElementById('mobile-drawer').getBoundingClientRect().bottom > 50") is ShotResult.Success)
    }
}
