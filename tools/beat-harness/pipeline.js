// tools/beat-harness/pipeline.js
// Runs the app's per-frame chain offline: each frame advances the sample
// cursor by HOP, takes the trailing fftSize-sample window, emulates
// getByteFrequencyData, normalizes to freqLin, and feeds the detector. The
// frame clock is derived from HOP so it never drifts from the sample cursor.
const { createAnalyserEmulator } = require("./analyser-emulator.js");

// HOP = round(sampleRate / fps) = round(48000 / 60). One rAF at 60 fps. The
// frame clock is frameDt = hop/sampleRate, so the "now" clock and the sample
// cursor share one step and never drift. This constant bakes in 48 kHz @ 60 fps;
// a different rate/fps means passing a recomputed `hop` to runPipeline.
const HOP = 800;

function runPipeline({
  pcm, sampleRate = 48000, fftSize = 2048, smoothing = 0.8, hop = HOP, detector = null,
}) {
  const em = createAnalyserEmulator({ fftSize, sampleRate, smoothing });
  const half = fftSize >> 1;
  const window = new Float64Array(fftSize);
  const freqLin = new Float64Array(half);
  const frameDt = hop / sampleRate;
  const detected = [];
  const nFrames = Math.floor(pcm.length / hop);

  for (let f = 0; f < nFrames; f++) {
    // Trailing-window invariant: frame f's window covers samples
    // [end - fftSize + 1, end], front-padded with zeros for early frames (the
    // first full window appears at frame ceil((fftSize-1)/hop)). Any beat
    // emitted during the zero-padded warm-up falls inside the scorer's 5s trim.
    const end = f * hop; // most-recent sample index for this frame
    const startSample = end - fftSize + 1;
    for (let n = 0; n < fftSize; n++) {
      const idx = startSample + n;
      window[n] = idx >= 0 && idx < pcm.length ? pcm[idx] : 0;
    }
    const bytes = em.getByteFrequencyData(window);
    for (let k = 0; k < half; k++) freqLin[k] = bytes[k] / 255;
    const dt = f === 0 ? 0 : frameDt;
    const nowMs = f * frameDt * 1000;
    // A detector's update() may return a plain boolean (the bass-onset adapter
    // and the test fakes) or an object { beat, bpm } (createBeatTracker, which
    // also reports tempo). Extract the beat flag the same way createAudioAnalysis
    // does, so an object return is not treated as always-truthy.
    const r = detector ? detector.update(freqLin, dt, nowMs) : false;
    const isBeat = r && typeof r === "object" ? r.beat : r;
    if (isBeat) detected.push(nowMs / 1000);
  }
  return detected;
}

module.exports = { runPipeline, HOP };
