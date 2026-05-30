const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fillResample } = require("../main.js");

test("fillResample linearly interpolates between source samples", () => {
  const out = new Float32Array(3);
  fillResample(out, [0, 10], 0);
  assert.deepEqual(Array.from(out), [0, 5, 10]);
});

test("fillResample maps endpoints exactly and interpolates the interior", () => {
  const out = new Float32Array(5);
  fillResample(out, [0, 4], 0);
  assert.deepEqual(Array.from(out), [0, 1, 2, 3, 4]);
});

test("fillResample fills fallback when source is empty", () => {
  const out = new Float32Array(3);
  fillResample(out, null, -140);
  assert.deepEqual(Array.from(out), [-140, -140, -140]);
});

test("fillResample handles a single-sample source", () => {
  const out = new Float32Array(3);
  fillResample(out, [7], 0);
  assert.deepEqual(Array.from(out), [7, 7, 7]);
});
