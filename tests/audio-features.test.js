const test = require("node:test");
const assert = require("node:assert/strict");
const {
  pcmSmooth,
  sumBand,
  createLoudnessTracker,
  createAudioAnalysis,
} = require("../audio-features.js");

function fakeAnalyser(byteFreqData, floatTimeData) {
  return {
    fftSize: floatTimeData ? floatTimeData.length : byteFreqData.length * 2,
    frequencyBinCount: byteFreqData.length,
    getByteFrequencyData(out) { out.set(byteFreqData); },
    getFloatTimeDomainData(out) {
      if (floatTimeData) out.set(floatTimeData);
      else out.fill(0);
    },
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

test("createAudioAnalysis: bundles features and drives the causal beat tracker", () => {
  // Bass band [20, 250] Hz at FFT=2048 @ 48 kHz covers bins 1..10. Quiet
  // baseline establishes bass/mid/treb; a steady low-band kick pattern then
  // drives the causal tracker, which must lock, emit beats, latch beatPulse to
  // 1, and report a positive bpm. A single spike no longer fires - the tracker
  // needs an established periodicity, which is the point of the rewrite.
  const bins = new Uint8Array(1024);
  for (let i = 1; i <= 10; i++) bins[i] = 50;             // quiet bass
  for (let i = 11; i < 1024; i++) bins[i] = 5;            // mid/treble quiet
  const analyser = fakeAnalyser(bins);
  const af = createAudioAnalysis({
    analyserL: analyser,
    sampleRate: 48000, fftSize: 2048,
  });

  const first = af.update(1 / 60, 0);
  assert.ok(first.bass > 0, `bass=${first.bass}`);
  assert.ok(first.mid >= 0 && first.treb >= 0);

  // Steady 120 bpm kick: a low-band onset every 30 frames for ~5 s.
  let beatSeen = false;
  let lastBpm = 0;
  for (let f = 1; f < 300; f++) {
    const kick = f % 30 === 0;
    for (let i = 1; i <= 10; i++) bins[i] = kick ? 255 : 50;
    const s = af.update(1 / 60, (f * 1000) / 60);
    if (s.beat) { beatSeen = true; assert.equal(s.beatPulse, 1); }
    lastBpm = s.bpm;
  }
  assert.ok(beatSeen, "expected the causal tracker to emit beats on a steady kick pattern");
  assert.ok(typeof lastBpm === "number" && lastBpm > 0, `bpm should be a positive number, got ${lastBpm}`);
});

test("createAudioAnalysis: null analyser returns zero state without crashing", () => {
  const af = createAudioAnalysis({
    analyserL: null, sampleRate: 48000, fftSize: 2048,
  });
  const s = af.update(1 / 60, 0);
  assert.equal(s.bass, 0);
  assert.equal(s.beat, false);
  assert.equal(s.beatPulse, 0);
  assert.equal(s.rms, 0);
  assert.equal(s.rmsLongAverage, 0);
});

test("createAudioAnalysis: tracks time-domain RMS for auto-gain", () => {
  // RMS of a constant amplitude is just |amp|. Feed a synthetic time-domain
  // signal of constant 0.5 and verify rms ≈ 0.5 and rmsLongAverage converges
  // toward 0.5 over enough frames.
  const fftSize = 2048;
  const td = new Float32Array(fftSize).fill(0.5);
  const bins = new Uint8Array(1024);             // freq side: zeros, doesn't matter
  const analyser = fakeAnalyser(bins, td);
  const af = createAudioAnalysis({
    analyserL: analyser, sampleRate: 48000, fftSize,
  });

  const first = af.update(1 / 60, 0);
  assert.ok(Math.abs(first.rms - 0.5) < 1e-6, `rms=${first.rms}`);
  assert.ok(Math.abs(first.rmsLongAverage - 0.5) < 1e-6, `seed rmsLong=${first.rmsLongAverage}`);

  // After many frames at constant 0.5, rmsLongAverage stays near 0.5.
  let last = first;
  for (let i = 1; i < 300; i++) last = af.update(1 / 60, i * 16.7);
  assert.ok(Math.abs(last.rmsLongAverage - 0.5) < 0.05, `late rmsLong=${last.rmsLongAverage}`);
});

test("createAudioAnalysis: rms responds to amplitude changes faster than rmsLongAverage", () => {
  // Quiet baseline, then loud step. Short-term RMS must reflect the new
  // amplitude immediately; long-term tracker should still be biased toward
  // the old level so auto-gain has a stable target.
  const fftSize = 2048;
  const quiet = new Float32Array(fftSize).fill(0.05);
  const loud  = new Float32Array(fftSize).fill(0.5);
  const bins = new Uint8Array(1024);
  let timeData = quiet;
  const analyser = {
    fftSize, frequencyBinCount: 1024,
    getByteFrequencyData(out) { out.set(bins); },
    getFloatTimeDomainData(out) { out.set(timeData); },
  };
  const af = createAudioAnalysis({
    analyserL: analyser, sampleRate: 48000, fftSize,
  });
  for (let i = 0; i < 60; i++) af.update(1 / 60, i * 16.7);
  timeData = loud;
  const after = af.update(1 / 60, 60 * 16.7);
  assert.ok(after.rms > 0.4, `rms should jump quickly: ${after.rms}`);
  assert.ok(after.rmsLongAverage < 0.2, `rmsLong should still be biased toward quiet baseline: ${after.rmsLongAverage}`);
});
