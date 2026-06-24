package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Drive every drawer control to representative values and assert the DOM reflects the change. */
@RunWith(AndroidJUnit4::class)
class DrawerControlsTest {
    private lateinit var s: ActivityScenario<MainActivity>

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() {
        if (::s.isInitialized) {
            // Safety reset: ensure micModeAuto is false in localStorage even if an assertion above threw.
            try { JourneySupport.eval(s, "var m=document.getElementById('mobile-micmode-auto'); if(m&&m.checked){m.checked=false; m.dispatchEvent(new Event('change',{bubbles:true}));} 'ok'") } catch (_: Throwable) {}
            s.close()
        }
    }

    @Test fun drawerControlsRespond() {
        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)
        JourneySupport.openDrawer(s)
        check(JourneySupport.proveScopeState(s, "ctrl-00-drawer-open", "document.body.classList.contains('drawer-open')") is ShotResult.Success)

        // FFT stepper down to min, then up to max. mobile-ui.js FFT_VALUES has exactly 8
        // entries [128..16384]; the steppers clamp at indices 0 and 7, so 8 clicks from any
        // start reaches the bound. fftSizeLabel renders 128 -> "0.125k", 16384 -> "16k".
        repeat(8) { JourneySupport.clickId(s, "mobile-fft-prev") }
        JourneySupport.assertJs(s, "document.getElementById('mobile-fft-value').textContent === '0.125k'")
        check(JourneySupport.proveScopeState(s, "ctrl-01-fft-min", "document.getElementById('mobile-fft-value').textContent === '0.125k'") is ShotResult.Success)
        repeat(8) { JourneySupport.clickId(s, "mobile-fft-next") }
        JourneySupport.assertJs(s, "document.getElementById('mobile-fft-value').textContent === '16k'")
        check(JourneySupport.proveScopeState(s, "ctrl-02-fft-max", "document.getElementById('mobile-fft-value').textContent === '16k'") is ShotResult.Success)

        // Smoothing range to its bounds.
        JourneySupport.setRange(s, "mobile-smooth", "0.65")
        JourneySupport.assertJs(s, "parseFloat(document.getElementById('mobile-smooth').value) === 0.65")
        JourneySupport.setRange(s, "mobile-smooth", "0.95")
        JourneySupport.assertJs(s, "parseFloat(document.getElementById('mobile-smooth').value) === 0.95")
        check(JourneySupport.proveScopeState(s, "ctrl-03-smoothing", "parseFloat(document.getElementById('mobile-smooth').value) === 0.95") is ShotResult.Success)

        // Auto-gain off -> gain slider enabled; set gain bounds; auto-gain on -> disabled.
        // Confirm BOTH the toggle state and its effect landed before driving the slider,
        // so a setRange on a still-disabled input cannot pass silently.
        JourneySupport.eval(s, "var a=document.getElementById('mobile-autogain'); if(a.checked){a.checked=false; a.dispatchEvent(new Event('change',{bubbles:true}));} 'ok'")
        JourneySupport.assertJs(s, "document.getElementById('mobile-autogain').checked === false")
        JourneySupport.assertJs(s, "document.getElementById('mobile-gain').disabled === false")
        JourneySupport.setRange(s, "mobile-gain", "0.1")
        JourneySupport.assertJs(s, "parseFloat(document.getElementById('mobile-gain').value) === 0.1")
        JourneySupport.setRange(s, "mobile-gain", "2")
        JourneySupport.assertJs(s, "parseFloat(document.getElementById('mobile-gain').value) === 2")
        check(JourneySupport.proveScopeState(s, "ctrl-04-gain", "parseFloat(document.getElementById('mobile-gain').value) === 2") is ShotResult.Success)
        JourneySupport.eval(s, "var a=document.getElementById('mobile-autogain'); if(!a.checked){a.checked=true; a.dispatchEvent(new Event('change',{bubbles:true}));} 'ok'")
        JourneySupport.assertJs(s, "document.getElementById('mobile-gain').disabled === true")

        // Keep-screen-on toggle flips.
        JourneySupport.eval(s, "var k=document.getElementById('mobile-keepawake'); k.checked=!k.checked; k.dispatchEvent(new Event('change',{bubbles:true})); 'ok'")
        check(JourneySupport.proveScopeState(s, "ctrl-05-keepawake", "typeof document.getElementById('mobile-keepawake').checked === 'boolean'") is ShotResult.Success)

        // micmode-auto toggle: force to true, verify, then reset to false so localStorage is clean
        // for subsequent tests (MicModeViewExclusionTest depends on micModeAuto being false).
        JourneySupport.eval(s, "var m=document.getElementById('mobile-micmode-auto'); m.checked=true; m.dispatchEvent(new Event('change',{bubbles:true})); 'ok'")
        JourneySupport.assertJs(s, "document.getElementById('mobile-micmode-auto').checked === true")
        check(JourneySupport.proveScopeState(s, "ctrl-06-micmode-auto", "document.getElementById('mobile-micmode-auto').checked === true") is ShotResult.Success)
        JourneySupport.eval(s, "var m=document.getElementById('mobile-micmode-auto'); m.checked=false; m.dispatchEvent(new Event('change',{bubbles:true})); 'ok'")
        JourneySupport.assertJs(s, "!document.getElementById('mobile-micmode-auto').checked")

        // Per-band EQ, then reset to 1.0.
        JourneySupport.setRange(s, "mobile-eq-bass", "1.8")
        JourneySupport.setRange(s, "mobile-eq-mid", "0.4")
        JourneySupport.setRange(s, "mobile-eq-treb", "1.5")
        JourneySupport.assertJs(s, "parseFloat(document.getElementById('mobile-eq-bass').value) === 1.8")
        check(JourneySupport.proveScopeState(s, "ctrl-07-eq-set", "parseFloat(document.getElementById('mobile-eq-bass').value) === 1.8") is ShotResult.Success)
        JourneySupport.clickId(s, "mobile-eq-reset")
        JourneySupport.assertJs(s, "['mobile-eq-bass','mobile-eq-mid','mobile-eq-treb'].every(id=>parseFloat(document.getElementById(id).value)===1)")
        check(JourneySupport.proveScopeState(s, "ctrl-08-eq-reset", "['mobile-eq-bass','mobile-eq-mid','mobile-eq-treb'].every(id=>parseFloat(document.getElementById(id).value)===1)") is ShotResult.Success)
    }
}
