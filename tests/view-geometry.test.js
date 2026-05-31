const { test } = require("node:test");
const assert = require("node:assert/strict");

const { canopyEdge } = require("../view-geometry.js");

test("canopyEdge fills from the top down to the waveform edge", () => {
  const wave = new Float32Array([0, 0, 0, 0]);
  const poly = canopyEdge(wave, { w: 400, h: 300, baseY: 150, amp: 40 });
  assert.strictEqual(poly[0][0], 0);
  const lastTwo = poly.slice(-2);
  assert.deepStrictEqual(lastTwo[0], [400, 0]);
  assert.deepStrictEqual(lastTwo[1], [0, 0]);
});

test("canopyEdge edge y follows the waveform around baseY", () => {
  const wave = new Float32Array([1, 1, 1, 1]);
  const poly = canopyEdge(wave, { w: 400, h: 300, baseY: 150, amp: 40 });
  assert.ok(Math.abs(poly[0][1] - (150 - 40)) < 1e-6, `edge y=${poly[0][1]}`);
});
