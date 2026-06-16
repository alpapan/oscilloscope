package com.alpapan.scope

import android.media.MediaPlayer
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.RequiresDevice
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Proves the system-audio capture -> analyser pipeline actually moves data, not just that a view
 * renders. Plays a USAGE_MEDIA tone, captures system audio, and asserts the measured RMS in
 * state.audio.rms is non-zero. (ToneGenerator was NOT reliably captured on physical devices; a
 * MediaPlayer with explicit USAGE_MEDIA routes through the media path the capture taps.)
 */
@RunWith(AndroidJUnit4::class)
class AudioCaptureTest {
    private lateinit var s: ActivityScenario<MainActivity>
    private var tone: MediaPlayer? = null

    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() {
        try { tone?.stop(); tone?.release() } catch (_: Throwable) {}
        if (::s.isInitialized) s.close()
    }

    /**
     * One captured-audio assertion: the system capture moves real data into the analyser AND the spectrum view
     * renders it correctly. It plays a composite tone with one sine per band - 100 Hz (bass), 1500 Hz (mid),
     * 9000 Hz (treb); see tools/audit/gen-test-tones.sh - so a single spectrum screenshot (audio-01-spectrum)
     * shows three peaks at left / centre / right, which is verified VISUALLY (the FFT bins are not exposed in
     * state.audio). Only ONE captured-audio test runs per instrumentation process: the harness gives the first
     * system capture a clean audio mix and later ones capture silence, so all band coverage rides this single
     * capture. The view-walk journeys run with no audio, so the spectrum had never been exercised with a real
     * signal before this.
     */
    @Test fun capturedAudioDrivesAnalyserAndSpectrumRenders() {
        tone = JourneySupport.startMediaTone("tone-bands-100-1500-9000hz.wav")
        Thread.sleep(500)
        check(tone?.isPlaying == true) { "media tone did not start playing (MediaPlayer.isPlaying == false)" }

        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)
        JourneySupport.cycleToView(s, "waveform")
        Thread.sleep(3000)                       // let captured audio flow into the analyser/features

        // state.audio.rms is the time-domain level of the captured PCM; > 0.01 proves audio is actually being
        // captured and fed to the visualiser, not just that the view rendered. The gate polls so it can rise.
        val r = JourneySupport.proveScopeState(s, "audio-01-captured", "(typeof state!=='undefined' && state.audio && state.audio.rms > 0.01)")
        check(r is ShotResult.Success) { "audio-01 gate failed: ${(r as ShotResult.Failure).reason}" }

        // The spectrum view must render the captured audio: its shot shows the three band peaks (left/centre/
        // right), verified visually. Bins are not exposed in state.audio, so the screenshot is the evidence.
        JourneySupport.cycleToView(s, "spectrum")
        Thread.sleep(1000)
        check(JourneySupport.proveScopeState(s, "audio-01-spectrum", "true") is ShotResult.Success) { "spectrum shot not captured" }
    }

    // Requires a real speaker -> mic acoustic path: the tone plays out the speaker and the raw MIC must
    // pick it up. Emulated/virtual devices (FTL virtual, local managed-device emulators) have no acoustic
    // loopback, so @RequiresDevice makes AndroidJUnitRunner skip it there; it still runs on physical
    // devices (the Nokia X30 and the FTL physical matrix).
    @Test @RequiresDevice fun capturedMicAudioDrivesAnalyser() {
        // The tone plays out the speaker; the mic capture uses raw MediaRecorder.AudioSource.MIC
        // (no AEC), so the speaker tone loops back into the mic and must register a non-zero level.
        tone = JourneySupport.startMediaTone()
        Thread.sleep(500)
        check(tone?.isPlaying == true) { "media tone did not start playing (MediaPlayer.isPlaying == false)" }

        s = JourneySupport.launchReady()
        JourneySupport.startMicCapture(s)
        JourneySupport.cycleToView(s, "waveform")
        Thread.sleep(3000)

        val r2 = JourneySupport.proveScopeState(s, "audio-02-mic-captured", "(typeof state!=='undefined' && state.audio && state.audio.rms > 0.01)")
        check(r2 is ShotResult.Success) { "audio-02 gate failed: ${(r2 as ShotResult.Failure).reason} (raw MIC should pick up the speaker tone)" }
    }
}
