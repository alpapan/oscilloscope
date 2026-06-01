const { test } = require("node:test");
const assert = require("node:assert/strict");

const { canopyEdge, spiral, bloom, starburst, lasso, nova, smoothWave4 } = require("../view-geometry.js");

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

function flat(n, v = 0) { return new Float32Array(n).fill(v); }
function allFinite(pts) { return pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])); }

test("smoothWave4 preserves length and is finite", () => {
  const out = smoothWave4([[0,0],[1,1],[2,0],[3,1]]);
  assert.strictEqual(out.length, 4);
  assert.ok(out.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
});
test("spiral: closed loop, finite, zeros collapse to a known point", () => {
  const L = flat(300), R = flat(300);
  const pts = spiral(L, R, { w: 400, h: 400, time: 0, bpm: 120, bassAtt: 0, samples: 256 });
  assert.strictEqual(pts.length, 257);
  assert.deepStrictEqual(pts[0], pts[pts.length - 1]);
  assert.ok(allFinite(pts));
  assert.ok(Math.abs(pts[0][1] - 200) < 1e-6);
});
test("bloom/starburst/lasso/nova: finite and on a sane canvas", () => {
  const L = flat(2048, 0.2), R = flat(2048, -0.1);
  for (const fn of [bloom, starburst, lasso, nova]) {
    const pts = fn(L, R, { w: 400, h: 400, time: 1.5, bpm: 120, bassAtt: 0.3, rms: 0.2 });
    assert.ok(pts.length > 8, `${fn.name} count`);
    assert.ok(allFinite(pts), `${fn.name} finite`);
    assert.ok(pts.every(p => p[0] > -400 && p[0] < 800 && p[1] > -400 && p[1] < 800), `${fn.name} bounds`);
  }
});
test("geometry never reads past the buffer end (tight buffer)", () => {
  const L = flat(256), R = flat(256);
  for (const fn of [spiral, bloom, starburst, lasso, nova]) {
    const pts = fn(L, R, { w:400, h:400, time:1, bpm:120, bassAtt:0.5, rms:0.3, samples:256 });
    assert.ok(pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])), `${fn.name} finite on tight buffer`);
  }
});
