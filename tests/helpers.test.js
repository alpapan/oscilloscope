const { test } = require("node:test");
const assert = require("node:assert/strict");
const { freqToX } = require("../main.js");

test("freqToX maps 20 Hz to x = 0", () => {
  assert.strictEqual(freqToX(20, 1000), 0);
});

test("freqToX maps 20000 Hz to x = width", () => {
  assert.strictEqual(freqToX(20000, 1000), 1000);
});

test("freqToX is logarithmic: sqrt(20 * 20000) ≈ 632 Hz lands at half-width", () => {
  const x = freqToX(Math.sqrt(20 * 20000), 1000);
  assert.ok(Math.abs(x - 500) < 1, `expected ~500, got ${x}`);
});

const { findZeroCrossing } = require("../main.js");

test("findZeroCrossing returns first index where buf[i] < 0 and buf[i+1] >= 0", () => {
  const buf = [0.5, 0.1, -0.2, -0.1, 0.3, 0.4];
  assert.strictEqual(findZeroCrossing(buf), 3);
});

test("findZeroCrossing returns 0 when no negative-to-positive transition exists", () => {
  const buf = [0.1, 0.2, 0.3, 0.4];
  assert.strictEqual(findZeroCrossing(buf), 0);
});

test("findZeroCrossing returns the negative-sample index when buf[i+1] is exactly 0 (zero-crossing to silence)", () => {
  const buf = [-0.1, 0, 0.2, 0.3];
  assert.strictEqual(findZeroCrossing(buf), 0);
});

const { spectrumPolylinePoints } = require("../main.js");

// Helper: 2048-bin Float32Array filled with `db` for every bin in [20, 20000] Hz
// and minDb elsewhere. Mimics an analyser returning a flat in-band response.
function flatSpectrum(bins, sampleRate, fftSize, dbInBand, dbOutOfBand) {
  const buf = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const freq = (i * sampleRate) / fftSize;
    buf[i] = (freq >= 20 && freq <= 20000) ? dbInBand : dbOutOfBand;
  }
  return buf;
}

test("spectrumPolylinePoints anchors first vertex at x=0 (full-width fill)", () => {
  const sampleRate = 48000;
  const fftSize = 2048;
  const bins = fftSize / 2;
  // At 48 kHz / 2048 the first audible bin is i=1 (23.4 Hz) — without the
  // x=0 anchor the polygon would start ~2.3% in from the left.
  const buf = flatSpectrum(bins, sampleRate, fftSize, -60, -100);
  const points = spectrumPolylinePoints(buf, sampleRate, fftSize, 1000, 500, -100, -30);
  assert.ok(points.length >= 2, `expected >=2 points, got ${points.length}`);
  assert.strictEqual(points[0][0], 0, "first vertex must be at x=0");
  assert.strictEqual(points[0][1], points[1][1],
    "anchor y must match first audible bin's y (horizontal lead-in)");
});

test("spectrumPolylinePoints last vertex is within the audible band's x-range", () => {
  const sampleRate = 48000;
  const fftSize = 2048;
  const bins = fftSize / 2;
  const buf = flatSpectrum(bins, sampleRate, fftSize, -60, -100);
  const w = 1000;
  const points = spectrumPolylinePoints(buf, sampleRate, fftSize, w, 500, -100, -30);
  const lastX = points[points.length - 1][0];
  assert.ok(lastX > 0 && lastX <= w, `last x=${lastX} should be in (0, ${w}]`);
  // Last bin frequency must not exceed 20 kHz; ergo lastX ≤ w (freqToX(20000, w) = w)
  assert.ok(lastX <= w);
});

test("spectrumPolylinePoints returns [] when no bin lies in 20 Hz - 20 kHz", () => {
  // fftSize=4 at sampleRate=8 means bin freqs are [0, 2, 4, 6] Hz — all below 20 Hz.
  const buf = new Float32Array([-50, -50, -50, -50]);
  const points = spectrumPolylinePoints(buf, 8, 4, 1000, 500, -100, -30);
  assert.deepStrictEqual(points, []);
});

test("spectrumPolylinePoints maps db magnitude to inverted y (high dB = small y)", () => {
  const sampleRate = 48000;
  const fftSize = 2048;
  const bins = fftSize / 2;
  const h = 500;
  const loud = flatSpectrum(bins, sampleRate, fftSize, -30, -100); // mag=1 → y=0
  const quiet = flatSpectrum(bins, sampleRate, fftSize, -100, -100); // mag=0 → y=h
  const loudPts = spectrumPolylinePoints(loud, sampleRate, fftSize, 1000, h, -100, -30);
  const quietPts = spectrumPolylinePoints(quiet, sampleRate, fftSize, 1000, h, -100, -30);
  assert.strictEqual(loudPts[1][1], 0, "max-dB bin should map to y=0");
  assert.strictEqual(quietPts[1][1], h, "min-dB bin should map to y=h");
});

test("spectrumPolylinePoints clamps out-of-range dB to [0, 1] magnitude", () => {
  const sampleRate = 48000;
  const fftSize = 2048;
  const bins = fftSize / 2;
  const h = 500;
  // Spike a single audible bin above maxDb and another below minDb.
  const buf = flatSpectrum(bins, sampleRate, fftSize, -100, -100);
  buf[10] = 0;     // far above maxDb=-30 → should clamp to mag=1 (y=0)
  buf[20] = -999;  // far below minDb=-100 → should clamp to mag=0 (y=h)
  const points = spectrumPolylinePoints(buf, sampleRate, fftSize, 1000, h, -100, -30);
  // Find the points by their x positions (deterministic from bin index)
  const yAtBin10 = points.find(p => Math.abs(p[0] - freqToX(10 * sampleRate / fftSize, 1000)) < 0.001)[1];
  const yAtBin20 = points.find(p => Math.abs(p[0] - freqToX(20 * sampleRate / fftSize, 1000)) < 0.001)[1];
  assert.strictEqual(yAtBin10, 0);
  assert.strictEqual(yAtBin20, h);
});
