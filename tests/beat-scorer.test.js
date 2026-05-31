// tests/beat-scorer.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { matchEvents, scoreBeats } = require("../tools/beat-harness/scorer.js");

test("matchEvents: one-to-one nearest within the window", () => {
  const ref = [10.0, 10.5, 11.0];
  const det = [10.01, 10.49, 11.0];
  const m = matchEvents(ref, det, 0.07);
  assert.equal(m.length, 3);
});

test("matchEvents: a detection outside the window is unmatched", () => {
  const ref = [10.0];
  assert.equal(matchEvents(ref, [10.08], 0.07).length, 0); // 80 ms > 70 ms
  assert.equal(matchEvents(ref, [10.06], 0.07).length, 1); // 60 ms <= 70 ms
});

test("scoreBeats: perfect detection scores F=1", () => {
  const ref = [6, 6.5, 7, 7.5, 8];
  const r = scoreBeats(ref.slice(), ref.slice(), { window: 0.07, trimStart: 5 });
  assert.equal(r.precision, 1);
  assert.equal(r.recall, 1);
  assert.equal(r.f, 1);
  assert.ok(r.meanAbsErrMs < 1e-6);
});

test("scoreBeats: one miss and one extra gives the expected P/R/F", () => {
  const ref = [6, 6.5, 7, 7.5];     // 4 reference
  const det = [6, 6.5, 7, 9.9];     // 3 correct, 1 false positive, 1 miss (7.5)
  const r = scoreBeats(ref, det, { window: 0.07, trimStart: 5 });
  assert.ok(Math.abs(r.precision - 3 / 4) < 1e-9);
  assert.ok(Math.abs(r.recall - 3 / 4) < 1e-9);
  assert.ok(Math.abs(r.f - 3 / 4) < 1e-9);
});

test("scoreBeats: events before trimStart are ignored", () => {
  const ref = [1, 2, 3, 6, 6.5];   // first three dropped
  const det = [1, 2, 3, 6, 6.5];
  const r = scoreBeats(ref, det, { window: 0.07, trimStart: 5 });
  assert.equal(r.nRef, 2);
  assert.equal(r.nDet, 2);
  assert.equal(r.f, 1);
});

test("scoreBeats: empty reference reports false positives, not F", () => {
  const r = scoreBeats([], [6.0, 7.0], { window: 0.07, trimStart: 5 });
  assert.equal(r.isNegativeControl, true);
  assert.equal(r.falsePositives, 2);
});

test("scoreBeats: expected beats but no detections gives F=0, not a control", () => {
  // Reference beats survive the 5s trim; zero detections -> P=0, R=0, F=0.
  const r = scoreBeats([6, 6.5, 7], [], { window: 0.07, trimStart: 5 });
  assert.equal(r.isNegativeControl, false);
  assert.equal(r.precision, 0);
  assert.equal(r.recall, 0);
  assert.equal(r.f, 0);
});
