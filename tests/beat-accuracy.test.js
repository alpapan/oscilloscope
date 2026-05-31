// tests/beat-accuracy.test.js
// Committed regression gate for the causal beat tracker. Runs a representative
// subset of the synthesized battery through the SAME offline pipeline the
// harness uses and asserts the operator-agreed F-measure targets (steady
// F>=0.9, aggregate >=0.75, +/-70ms window, 5s trim - the mir_eval standard).
// Subset rationale: steady-120 = baseline mid-tempo lock; steady-90 = a second
// tempo so a single hard-coded period cannot pass; syncopation = off-beat
// rejection; tempo-change = re-lock across a mid-track BPM switch; white-noise =
// false-positive gate. The full 14-case battery runs via tools/beat-harness/run.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCase } = require("../tools/beat-harness/signal-gen.js");
const { runPipeline } = require("../tools/beat-harness/pipeline.js");
const { scoreBeats } = require("../tools/beat-harness/scorer.js");
const { createBeatTracker } = require("../audio-features.js");

function scoreCase(name) {
  const c = buildCase(name);
  const detector = createBeatTracker({ frameDt: 1 / 60 });
  const detected = runPipeline({ pcm: c.pcm, sampleRate: 48000, fftSize: 2048, detector });
  return scoreBeats(c.beats, detected, { window: 0.07, trimStart: 5 });
}

test("beat accuracy: steady 120 bpm clears the steady target", () => {
  const s = scoreCase("steady-120");
  assert.ok(s.f >= 0.9, `steady-120 F=${s.f.toFixed(3)} (need >= 0.9)`);
});

test("beat accuracy: a second steady tempo clears the steady target", () => {
  const s = scoreCase("steady-90");
  assert.ok(s.f >= 0.9, `steady-90 F=${s.f.toFixed(3)} (need >= 0.9)`);
});

test("beat accuracy: syncopation stays above the aggregate target", () => {
  const s = scoreCase("syncopation");
  assert.ok(s.f >= 0.75, `syncopation F=${s.f.toFixed(3)} (need >= 0.75)`);
});

test("beat accuracy: tempo change stays above the aggregate target", () => {
  const s = scoreCase("tempo-change");
  assert.ok(s.f >= 0.75, `tempo-change F=${s.f.toFixed(3)} (need >= 0.75)`);
});

test("beat accuracy: white noise produces ~no false beats", () => {
  const s = scoreCase("white-noise");
  assert.ok(s.isNegativeControl);
  // Operational target is 0 false positives; <=2 allows slack for the +/-70ms
  // matcher over a 15s scored region.
  assert.ok(s.falsePositives <= 2, `white-noise false positives=${s.falsePositives}`);
});
