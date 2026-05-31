// tests/beat-fft.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { fftReal } = require("../tools/beat-harness/fft.js");

function magnitudes(re, im) {
  const half = re.length / 2;
  const out = new Float64Array(half);
  for (let k = 0; k < half; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

test("fftReal: a pure cosine peaks at its bin", () => {
  const N = 64, k0 = 4;
  const x = new Float64Array(N);
  for (let n = 0; n < N; n++) x[n] = Math.cos((2 * Math.PI * k0 * n) / N);
  const { re, im } = fftReal(x);
  const mag = magnitudes(re, im);
  let argmax = 1, max = -Infinity;
  for (let k = 1; k < mag.length; k++) if (mag[k] > max) { max = mag[k]; argmax = k; }
  assert.equal(argmax, k0);
});

test("fftReal: DC input concentrates at bin 0", () => {
  const N = 32;
  const x = new Float64Array(N).fill(1);
  const { re, im } = fftReal(x);
  const mag = magnitudes(re, im);
  assert.ok(mag[0] > 1e-6, `DC bin should be large: ${mag[0]}`);
  for (let k = 1; k < mag.length; k++) assert.ok(mag[k] < 1e-6, `bin ${k} should be ~0: ${mag[k]}`);
});

test("fftReal: zero-pads non-power-of-two input to next power of two", () => {
  const x = new Float64Array(48); // not a power of two
  const { re } = fftReal(x);
  assert.equal(re.length, 64);
});
