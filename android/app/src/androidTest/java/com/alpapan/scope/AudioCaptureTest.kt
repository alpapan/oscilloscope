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

    @Test fun capturedAudioDrivesAnalyser() {
        tone = JourneySupport.startMediaTone()
        Thread.sleep(500)
        val playingAtStart = tone?.isPlaying == true
        check(playingAtStart) { "media tone did not start playing (MediaPlayer.isPlaying == false)" }

        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)
        JourneySupport.cycleToView(s, "waveform")
        Thread.sleep(3000)                       // let captured audio flow into the analyser/features

        // state.audio.rms is the measured level of the captured PCM (0..1); > 0.01 means audio is
        // actually being captured and fed to the visualiser, not just that the view rendered. The
        // RMS threshold IS the gate predicate now, and it polls so the level has time to rise.
        val r = JourneySupport.proveScopeState(s, "audio-01-captured", "(typeof state!=='undefined' && state.audio && state.audio.rms > 0.01)")
        check(r is ShotResult.Success) { "audio-01 gate failed: ${(r as ShotResult.Failure).reason} (tone.isPlaying start=$playingAtStart)" }
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
