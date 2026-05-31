// tools/beat-harness/analyser-emulator.js
// Faithful offline reproduction of the W3C Web Audio AnalyserNode
// getByteFrequencyData transform, so the harness feature equals the shipped
// feature. Formulas verified against https://webaudio.github.io/web-audio-api.
// FIDELITY CONTRACT: getByteFrequencyData() applies the per-bin temporal
// smoothing EMA on EVERY call, exactly as the browser does. The caller MUST
// invoke it once per frame/hop. Calling it twice per hop would double-smooth
// and diverge from the real AnalyserNode. The pipeline (Task 5) calls it once
// per hop, which matches a browser AnalyserNode read once per requestAnimationFrame.
const { fftReal } = require("./fft.js");

function blackmanWindow(N) {
  const w = new Float64Array(N);
  const a0 = 0.42, a1 = 0.5, a2 = 0.08;
  for (let n = 0; n < N; n++) {
    w[n] = a0 - a1 * Math.cos((2 * Math.PI * n) / N) + a2 * Math.cos((4 * Math.PI * n) / N);
  }
  return w;
}

function dbToByte(db, minDb = -100, maxDb = -30) {
  const b = Math.floor((255 / (maxDb - minDb)) * (db - minDb));
  if (b < 0) return 0;
  if (b > 255) return 255;
  return b;
}

function createAnalyserEmulator({
  fftSize = 2048, sampleRate = 48000, smoothing = 0.8, minDb = -100, maxDb = -30,
} = {}) {
  const N = fftSize;
  const half = N >> 1;
  const win = blackmanWindow(N);
  const smooth = new Float64Array(half); // per-bin smoothed magnitude (Xhat)
  const windowed = new Float64Array(N);
  const out = new Uint8Array(half);

  // timeSlice: Float64Array/Float32Array of length fftSize (most-recent samples).
  function getByteFrequencyData(timeSlice) {
    for (let n = 0; n < N; n++) windowed[n] = timeSlice[n] * win[n];
    const { re, im } = fftReal(windowed);
    for (let k = 0; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]) / N;
      smooth[k] = smoothing * smooth[k] + (1 - smoothing) * mag;
      if (smooth[k] <= 0) { out[k] = 0; continue; }
      const db = 20 * Math.log10(smooth[k]);
      out[k] = dbToByte(db, minDb, maxDb);
    }
    return out;
  }

  return { getByteFrequencyData, frequencyBinCount: half };
}

module.exports = { blackmanWindow, dbToByte, createAnalyserEmulator };
