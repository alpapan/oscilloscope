package com.alpapan.scope

import android.media.AudioManager
import android.media.ToneGenerator
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Produces a screenshot of the live Waveform visualiser, entirely in-process, so it
 * runs unmodified on any Firebase Test Lab device (virtual or physical) via
 * `--type instrumentation`. UIAutomator drives the WebView through the Capacitor
 * bridge (Robo/Espresso cannot see WebView content); the screenshot lands in
 * getExternalFilesDir/journeys and is pulled from FTL with --directories-to-pull.
 */
@RunWith(AndroidJUnit4::class)
class WaveformShotTest {
    private lateinit var s: ActivityScenario<MainActivity>
    private var tone: ToneGenerator? = null

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }

    @After fun tearDown() {
        try { tone?.stopTone(); tone?.release() } catch (_: Throwable) {}
        if (::s.isInitialized) s.close()
    }

    @Test fun waveformRendersOnCloudDevice() {
        // A continuous tone on the music stream (USAGE_MEDIA) so the captured trace
        // is non-flat. If the platform excludes own-uid playback from capture the
        // view still renders (a flat trace); reaching the Waveform view is the gate.
        tone = ToneGenerator(AudioManager.STREAM_MUSIC, ToneGenerator.MAX_VOLUME)
        tone!!.startTone(ToneGenerator.TONE_DTMF_5, 60_000)

        s = ActivityScenario.launch(MainActivity::class.java)
        val ready = "typeof (document.getElementById('mobile-capture')||{}).onclick === 'function'"
        var d = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < d && JourneySupport.eval(s, ready) != "true") Thread.sleep(250)
        assertEquals("mobile-capture handler wired", "true", JourneySupport.eval(s, ready))

        // Start capture (WebView button via JS), then accept the MediaProjection consent.
        // Physical devices require tapping "Start now" (button1); FTL emulators auto-grant
        // the projection (capture starts in ~200ms with no dialog), so the tap is
        // best-effort. Capture becoming active is the real gate.
        JourneySupport.eval(s, "document.getElementById('mobile-capture').click(); 'ok'")
        JourneySupport.tapDialog("android:id/button1", 6000)
        val active = "document.getElementById('mobile-start').hidden === true"
        d = System.currentTimeMillis() + 8000
        while (System.currentTimeMillis() < d && JourneySupport.eval(s, active) != "true") Thread.sleep(250)
        assertEquals("capture active", "true", JourneySupport.eval(s, active))

        // Cycle to the Waveform view. Default after consent is now-playing; window.cycleView
        // (main.js, the same call the PiP button uses) wraps now-playing -> waveform.
        val viewIs = "(document.getElementById('mobile-view')||{}).value || ''"
        var i = 0
        while (i++ < 15 && JourneySupport.eval(s, viewIs) != "waveform") {
            JourneySupport.eval(s, "window.cycleView && window.cycleView(1); 'ok'")
            Thread.sleep(400)
        }
        assertEquals("view is waveform", "waveform", JourneySupport.eval(s, viewIs))

        // Let the tone-driven trace animate a few frames, then capture.
        Thread.sleep(2500)
        check(JourneySupport.proveScopeState(s, "waveform", "(document.getElementById('mobile-view')||{}).value === 'waveform'") is ShotResult.Success)
    }
}
