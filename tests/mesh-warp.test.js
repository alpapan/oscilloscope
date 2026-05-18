const test = require("node:test");
const assert = require("node:assert/strict");
const {
  meshTransform,
  MESH_SCALE_AMP,
  MESH_ROT_AMP,
  MESH_ROT_FREQ,
} = require("../mesh-warp.js");

test("meshTransform: identity at zero input", () => {
  const { scale, rotation } = meshTransform(0, 0);
  assert.equal(scale, 1);
  assert.equal(rotation, 0);
});

test("meshTransform: scale > 1 for positive bassAtt, bounded", () => {
  const { scale } = meshTransform(1.0, 0);
  assert.ok(scale > 1, `scale=${scale}`);
  assert.ok(scale < 1 + MESH_SCALE_AMP + 1e-9, `scale=${scale}`);
});

test("meshTransform: rotation bounded by MESH_ROT_AMP * 3 for all inputs", () => {
  const bound = MESH_ROT_AMP * 3;
  for (let bass = 0; bass <= 1; bass += 0.05) {
    for (let t = 0; t < 100; t += 0.13) {
      const { rotation } = meshTransform(bass, t);
      assert.ok(
        Math.abs(rotation) <= bound + 1e-12,
        `|rot|=${rotation} at bass=${bass}, t=${t}`
      );
    }
  }
});

test("meshTransform: mean rotation across one period ≈ 0", () => {
  let sum = 0;
  const N = 100;
  const period = 2 * Math.PI / MESH_ROT_FREQ;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * period;
    sum += meshTransform(0.5, t).rotation;
  }
  const mean = sum / N;
  assert.ok(Math.abs(mean) < 1e-4, `mean=${mean}`);
});
