package com.alpapan.scope

import android.media.MediaPlayer
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Exercise the palette UI. Palettes are colour-only and the chip mechanism is identical across
 * views (palette-sets.js), so cycling every palette on ONE representative view proves the palette
 * controls without redundantly screenshotting every view x palette combination.
 */
@RunWith(AndroidJUnit4::class)
class PaletteWalkTest {
    private lateinit var s: ActivityScenario<MainActivity>
    private var tone: MediaPlayer? = null

    private val generic = listOf("crt", "neon", "mono", "chroma")

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() {
        try { tone?.stop(); tone?.release() } catch (_: Throwable) {}
        if (::s.isInitialized) s.close()
    }

    @Test fun paletteChipsApply() {
        tone = JourneySupport.startMediaTone()

        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)
        JourneySupport.cycleToView(s, "waveform")

        // Each generic palette: click its chip, assert it activated, screenshot the canvas.
        for (theme in generic) {
            JourneySupport.openDrawer(s)
            JourneySupport.eval(s, "document.querySelector('#mobile-theme-chips .chip[data-theme=\"$theme\"]').click(); 'ok'")
            JourneySupport.assertJs(s, "document.querySelector('#mobile-theme-chips .chip[data-theme=\"$theme\"]').classList.contains('active')")
            JourneySupport.closeDrawer(s)
            Thread.sleep(600)
            val pred = "document.querySelector('#mobile-theme-chips .chip[data-theme=\"$theme\"]').classList.contains('active')"
            val r = JourneySupport.proveScopeState(s, "palette-$theme", pred)
            check(r is ShotResult.Success) { "palette $theme gate failed: ${(r as ShotResult.Failure).reason}" }
        }

        // The per-view signature (exclusive) palette via the sns chip (waveform -> phosphor).
        JourneySupport.openDrawer(s)
        JourneySupport.eval(s, "document.getElementById('mobile-sns-chip').click(); 'ok'")
        JourneySupport.assertJs(s, "document.getElementById('mobile-sns-chip').classList.contains('active')")
        JourneySupport.closeDrawer(s)
        Thread.sleep(600)
        val r2 = JourneySupport.proveScopeState(s, "palette-signature-phosphor", "document.getElementById('mobile-sns-chip').classList.contains('active')")
        check(r2 is ShotResult.Success) { "signature palette gate failed: ${(r2 as ShotResult.Failure).reason}" }
    }
}
