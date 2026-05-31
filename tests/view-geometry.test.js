const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ringDeform } = require("../view-geometry.js");

test("ringDeform returns a closed loop of nPoints+1 vertices", () => {
  const wave = new Float32Array(64).fill(0);
  const pts = ringDeform(wave, { cx: 100, cy: 100, baseR: 50, amp: 10, scale: 1, nPoints: 32 });
  assert.strictEqual(pts.length, 33);
  assert.deepStrictEqual(pts[0], pts[pts.length - 1], "loop is closed");
});

test("ringDeform with zero wave is a circle of radius baseR*scale", () => {
  const wave = new Float32Array(64).fill(0);
  const pts = ringDeform(wave, { cx: 0, cy: 0, baseR: 40, amp: 10, scale: 2, nPoints: 8 });
  for (const [x, y] of pts) {
    assert.ok(Math.abs(Math.hypot(x, y) - 80) < 1e-6, `r=${Math.hypot(x, y)}`);
  }
});

const { wingFromLissajous } = require("../view-geometry.js");

test("wingFromLissajous returns left+right wings, mirrored about cx", () => {
  const L = new Float32Array([0.2, 0.4, 0.6, 0.8]);
  const R = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const { left, right } = wingFromLissajous(L, R, { cx: 100, cy: 100, scale: 50 });
  assert.strictEqual(left.length, 4);
  assert.strictEqual(right.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs((right[i][0] - 100) + (left[i][0] - 100)) < 1e-6, "x mirrored");
    assert.strictEqual(left[i][1], right[i][1], "y shared");
  }
});

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
