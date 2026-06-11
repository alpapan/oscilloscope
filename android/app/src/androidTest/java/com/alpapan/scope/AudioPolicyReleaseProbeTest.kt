package com.alpapan.scope

import android.media.MediaPlayer
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Bug #2 measurement rig. NOT part of the regular suite (@LargeTest, and the runner scripts pass an
 * explicit class list that excludes it); invoked only by tools/audit/probe-audio-policy-release.sh.
 *
 * Each iteration: capture system audio, stop it (the release under test), then immediately start a
 * fresh capture and measure how long AFTER the new capture is nominally active until it produces a
 * non-zero RMS. The clock starts AFTER startSystemCapture returns, so activity-launch and the
 * consent tap are excluded - what remains is the delay attributable to the previous
 * AudioPlaybackCapture policy not yet being released. -1 means audio never flowed within the
 * deadline (the policy was still held: this is bug #2 firing).
 */
@LargeTest
@RunWith(AndroidJUnit4::class)
class AudioPolicyReleaseProbeTest {
    private val n = 10
    private val rmsJs = "(typeof state!=='undefined' && state.audio) ? state.audio.rms : -1"

    @Test fun measureTReleaseMs() {
        for (i in 1..n) {
            // Each iteration is independent: a failure (e.g. the OS throttling repeated projection
            // consent) logs T_release_ms=-1 and the loop continues, so the rig always emits N samples.
            var tRelease = -1L
            var rmsFirst = -1.0
            var tone: MediaPlayer? = null
            try {
                JourneySupport.resetApp()
                JourneySupport.grantMic()
                tone = JourneySupport.startMediaTone()

                // First capture: establishes a live AudioPlaybackCapture policy to be released.
                val s1 = JourneySupport.launchReady()
                JourneySupport.startSystemCapture(s1)
                JourneySupport.cycleToView(s1, "waveform")
                Thread.sleep(1500)
                rmsFirst = JourneySupport.eval(s1, rmsJs).toDoubleOrNull() ?: -1.0
                s1.close()

                // Stop it (the release), then immediately start a back-to-back capture.
                JourneySupport.resetApp()
                val s2 = JourneySupport.launchReady()
                JourneySupport.startSystemCapture(s2)
                JourneySupport.cycleToView(s2, "waveform")

                // Clock starts here: capture is nominally active; measure time until audio flows.
                val t0 = System.currentTimeMillis()
                val deadline = t0 + 8000
                while (System.currentTimeMillis() < deadline) {
                    val rms = JourneySupport.eval(s2, rmsJs).toDoubleOrNull() ?: -1.0
                    if (rms > 0.01) { tRelease = System.currentTimeMillis() - t0; break }
                    Thread.sleep(50)
                }
                s2.close()
            } catch (t: Throwable) {
                Log.w("SCOPE_AUDIO_PROBE", "iteration=$i aborted: ${t.message}")
            } finally {
                try { tone?.stop(); tone?.release() } catch (_: Throwable) {}
                Log.i("SCOPE_AUDIO_PROBE", "T_release_ms=$tRelease firstRms=$rmsFirst iteration=$i")
            }
        }
        JourneySupport.resetApp()
    }
}
