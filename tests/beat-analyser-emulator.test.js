// tests/beat-analyser-emulator.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  blackmanWindow, dbToByte, createAnalyserEmulator,
} = require("../tools/beat-harness/analyser-emulator.js");

test("blackmanWindow: endpoints are ~0, center is maximal", () => {
  const w = blackmanWindow(2048);
  assert.equal(w.length, 2048);
  assert.ok(Math.abs(w[0]) < 1e-9, `w[0]=${w[0]}`);
  assert.ok(w[1024] > w[1] && w[1024] > 0.9, `center=${w[1024]}`);
});

test("dbToByte: spec scaling over [-100,-30]", () => {
  assert.equal(dbToByte(-30), 255);
  assert.equal(dbToByte(-100), 0);
  assert.equal(dbToByte(-65), 127); // floor(255/70*35) = floor(127.5)
  assert.equal(dbToByte(-20), 255); // clamps high
  assert.equal(dbToByte(-120), 0);  // clamps low
});

test("createAnalyserEmulator: silence yields all-zero bytes", () => {
  const em = createAnalyserEmulator({ fftSize: 2048 });
  const bytes = em.getByteFrequencyData(new Float64Array(2048));
  assert.equal(bytes.length, 1024);
  for (let k = 0; k < bytes.length; k++) assert.equal(bytes[k], 0);
});

test("createAnalyserEmulator: a tone peaks at its bin", () => {
  const fftSize = 2048, sampleRate = 48000;
  const binWidth = sampleRate / fftSize; // 23.4375 Hz
  const targetBin = 10;
  const freq = binWidth * targetBin; // 234.375 Hz, exactly on a bin center
  const em = createAnalyserEmulator({ fftSize, sampleRate, smoothing: 0 });
  const frame = new Float64Array(fftSize);
  for (let n = 0; n < fftSize; n++) frame[n] = Math.sin((2 * Math.PI * freq * n) / sampleRate);
  const bytes = em.getByteFrequencyData(frame);
  let argmax = 0, max = -1;
  for (let k = 0; k < bytes.length; k++) if (bytes[k] > max) { max = bytes[k]; argmax = k; }
  assert.ok(Math.abs(argmax - targetBin) <= 1, `peak bin ${argmax}, expected ~${targetBin}`);
  assert.ok(max > 0, "tone should produce a non-zero peak");
});

test("createAnalyserEmulator: temporal smoothing ramps the bytes up over frames", () => {
  const fftSize = 2048, sampleRate = 48000;
  const freq = (sampleRate / fftSize) * 10;
  const em = createAnalyserEmulator({ fftSize, sampleRate, smoothing: 0.8 });
  const frame = new Float64Array(fftSize);
  // Quiet amplitude (0.03) keeps the bytes mid-range so the EMA ramp is
  // observable. A full-scale tone saturates the peak bin to 255 on the first
  // frame (correct browser behavior), which would hide the ramp.
  for (let n = 0; n < fftSize; n++) frame[n] = 0.03 * Math.sin((2 * Math.PI * freq * n) / sampleRate);
  const first = em.getByteFrequencyData(frame)[10];
  let last = first;
  for (let i = 0; i < 50; i++) last = em.getByteFrequencyData(frame)[10];
  assert.ok(last > first, `smoothed byte should rise: first=${first} last=${last}`);
});
