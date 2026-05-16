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
