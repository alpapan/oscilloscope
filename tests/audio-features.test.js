const test = require("node:test");
const assert = require("node:assert/strict");
const {
  pcmSmooth,
  sumBand,
  createLoudnessTracker,
  createBeatDetector,
  createAudioAnalysis,
} = require("../audio-features.js");

function fakeAnalyser(byteFreqData) {
  return {
    frequencyBinCount: byteFreqData.length,
    getByteFrequencyData(out) { out.set(byteFreqData); },
  };
}

test("pcmSmooth: identity on flat input", () => {
  const inBuf = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  const out = pcmSmooth(inBuf, new Float32Array(4));
  for (let i = 1; i < out.length; i++) assert.equal(out[i], 0.5);
});

test("pcmSmooth: attenuates a 1-sample spike by 50%", () => {
  const inBuf = new Float32Array([0, 0, 1, 0, 0]);
  const out = pcmSmooth(inBuf, new Float32Array(5));
  assert.equal(out[2], 0.5);
  assert.equal(out[3], 0.5);
});

test("pcmSmooth: preserves DC offset", () => {
  const inBuf = new Float32Array([0.3, 0.3, 0.3, 0.3]);
  const out = pcmSmooth(inBuf, new Float32Array(4));
  let sumIn = 0, sumOut = 0;
  for (let i = 0; i < 4; i++) { sumIn += inBuf[i]; sumOut += out[i]; }
  assert.ok(Math.abs(sumIn - sumOut) < 1e-6);
});

test("pcmSmooth: preserves length", () => {
  const out = pcmSmooth(new Float32Array(2048), new Float32Array(2048));
  assert.equal(out.length, 2048);
});

test("sumBand: returns 0 for empty range", () => {
  const bins = new Float32Array(1024).fill(1);
  assert.equal(sumBand(bins, 48000, 100, 100), 0);
});

test("sumBand: at FFT 2048 @ 48 kHz, [20,250] Hz spans bins 1..10", () => {
  const bins = new Float32Array(1024);
  for (let i = 0; i < bins.length; i++) bins[i] = i;
  const sum = sumBand(bins, 48000, 20, 250);
  let expected = 0;
  for (let i = 1; i <= 10; i++) expected += i;
  assert.equal(sum, expected);
});

test("createLoudnessTracker: average converges to constant input fast (attack ~3 s)", () => {
  // attack=0.2 per second; effA at 1/60 is ~0.9735, so 200 frames ~3.3 s.
  // 1 - 0.2^3.3 ≈ 0.995, so |average - 1| should be < 0.05.
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  for (let i = 0; i < 200; i++) t.update(1.0, 1 / 60);
  const { average } = t.update(1.0, 1 / 60);
  assert.ok(Math.abs(average - 1.0) < 0.05, `average=${average}`);
});

test("createLoudnessTracker: longAverage drifts slowly after a step change", () => {
  // Seeded init lands longAverage at the first sample. A step change reveals
  // the slow long-term decay: longRate=0.992 per second, so after 1 s
  // longAverage ≈ 0.1 * 0.992 + 1.0 * 0.008 ≈ 0.107 (still close to old value).
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  for (let i = 0; i < 60; i++) t.update(0.1, 1 / 60);
  for (let i = 0; i < 60; i++) t.update(1.0, 1 / 60);
  const { longAverage } = t.update(1.0, 0);
  assert.ok(longAverage > 0.1 && longAverage < 0.2, `longAverage=${longAverage}`);
});

test("createLoudnessTracker: spike produces ratio > 1", () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  for (let i = 0; i < 100; i++) t.update(0.1, 1 / 60);
  const { ratio } = t.update(2.0, 1 / 60);
  assert.ok(ratio > 2.0);
});

test("createLoudnessTracker: FPS-adjusted decay is rate-invariant", () => {
  const t60 = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const t30 = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  for (let i = 0; i < 60; i++) t60.update(1.0, 1 / 60);
  for (let i = 0; i < 30; i++) t30.update(1.0, 1 / 30);
  const la60 = t60.update(1.0, 0).longAverage;
  const la30 = t30.update(1.0, 0).longAverage;
  assert.ok(Math.abs(la60 - la30) < 0.02);
});

test("createBeatDetector: no beat on flat input", () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const det = createBeatDetector(t, { threshold: 1.5, refractoryMs: 200 });
  for (let i = 0; i < 200; i++) {
    assert.equal(det.update(0.5, 1 / 60, i * 16.7), false);
  }
});

test("createBeatDetector: beat fires on spike", () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const det = createBeatDetector(t, { threshold: 1.5, refractoryMs: 200 });
  for (let i = 0; i < 100; i++) det.update(0.1, 1 / 60, i * 16.7);
  assert.equal(det.update(1.0, 1 / 60, 100 * 16.7), true);
});

test("createBeatDetector: refractory window suppresses re-trigger", () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const det = createBeatDetector(t, { threshold: 1.5, refractoryMs: 200 });
  for (let i = 0; i < 100; i++) det.update(0.1, 1 / 60, i * 16.7);
  det.update(1.0, 1 / 60, 100 * 16.7);
  assert.equal(det.update(1.0, 1 / 60, 100 * 16.7 + 50), false);
  assert.equal(det.update(1.0, 1 / 60, 100 * 16.7 + 250), true);
});

test("createAudioAnalysis: factory bundles update into one state snapshot", () => {
  // Bass band [20, 250] Hz at FFT=2048 @ 48 kHz covers bins 1..10. Quiet
  // baseline then a hard spike: ratio crosses the beat threshold, the
  // pulse latches to 1, decays exponentially with tau=250 ms.
  const bins = new Uint8Array(1024);
  for (let i = 1; i <= 10; i++) bins[i] = 50;             // quiet bass
  for (let i = 11; i < 1024; i++) bins[i] = 5;            // mid/treble quiet
  const analyser = fakeAnalyser(bins);
  const af = createAudioAnalysis({
    analyserL: analyser, analyserR: analyser,
    sampleRate: 48000, fftSize: 2048,
  });

  let last = null;
  for (let i = 0; i < 60; i++) last = af.update(1 / 60, i * 16.7);
  assert.ok(last.bass > 0, `bass=${last.bass}`);
  assert.ok(last.mid >= 0 && last.treb >= 0);

  for (let i = 1; i <= 10; i++) bins[i] = 255;
  let beatSeen = false;
  let beatT = 0;
  for (let i = 60; i < 80 && !beatSeen; i++) {
    const s = af.update(1 / 60, i * 16.7);
    if (s.beat) { beatSeen = true; beatT = i * 16.7; assert.equal(s.beatPulse, 1); }
  }
  assert.ok(beatSeen, "expected a beat on bass spike");

  // Drop bass to baseline before checking beatPulse decay; otherwise the
  // refractory window expires and a new beat fires, re-setting beatPulse=1.
  for (let i = 1; i <= 10; i++) bins[i] = 50;
  const after = af.update(0.250, beatT + 250);
  assert.ok(after.beatPulse < 1 / Math.E + 0.1, `pulse=${after.beatPulse}`);
});

test("createAudioAnalysis: null analyser returns zero state without crashing", () => {
  const af = createAudioAnalysis({
    analyserL: null, analyserR: null, sampleRate: 48000, fftSize: 2048,
  });
  const s = af.update(1 / 60, 0);
  assert.equal(s.bass, 0);
  assert.equal(s.beat, false);
  assert.equal(s.beatPulse, 0);
});
