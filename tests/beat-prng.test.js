// tests/beat-prng.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrng } = require("../tools/beat-harness/prng.js");

test("createPrng: same seed yields the same sequence", () => {
  const a = createPrng(42);
  const b = createPrng(42);
  for (let i = 0; i < 8; i++) assert.equal(a(), b());
});

test("createPrng: different seeds diverge", () => {
  const a = createPrng(1);
  const b = createPrng(2);
  let differ = false;
  for (let i = 0; i < 8; i++) if (a() !== b()) differ = true;
  assert.ok(differ, "expected different sequences for different seeds");
});

test("createPrng: outputs lie in [0, 1)", () => {
  const r = createPrng(12345);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});
