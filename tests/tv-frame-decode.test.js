const test = require("node:test");
const assert = require("node:assert");
const { decodeAnalysisFrame } = require("../tv-frame-decode.js");
test("decodes mono waveform frame", () => {
  const bytes = new Uint8Array([1,0,1,0,2,0,0, 0xFF,0x7F, 0x01,0x80]); // N=2, [32767,-32767]
  const f = decodeAnalysisFrame(bytes.buffer);
  assert.strictEqual(f.view, 0);
  assert.ok(Math.abs(f.waveform[0] - 1.0) < 1e-3);
  assert.ok(Math.abs(f.waveform[1] + 1.0) < 1e-3);
});
test("decodes spectrum (fft) frame agreeing with the kotlin encoder", () => {
  // Same bytes the Kotlin encodeSpectrum test asserts for dB [-100,-50,0].
  const bytes = new Uint8Array([1,1,2,0,0,0,3, 0,128,255]);
  const f = decodeAnalysisFrame(bytes.buffer);
  assert.strictEqual(f.view, 1);
  assert.strictEqual(f.fft.length, 3);
  assert.ok(Math.abs(f.fft[0] + 100) < 0.5);   // byte 0   -> -100 dB
  assert.ok(Math.abs(f.fft[1] + 49.8) < 0.6);  // byte 128 -> ~-49.8 dB
  assert.ok(Math.abs(f.fft[2] - 0) < 0.5);     // byte 255 -> 0 dB
  assert.strictEqual(f.waveform, undefined);   // FFT-only frame has no waveform
});
