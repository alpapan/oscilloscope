const { test } = require("node:test");
const assert = require("node:assert/strict");
const PS = require("../palette-sets.js");

test("every view has exactly one exclusive, all distinct", () => {
  const views = require("../view-ids.js").VIEW_ORDER;
  const ex = views.map(v => PS.EXCLUSIVE[v]);
  assert.strictEqual(ex.filter(Boolean).length, views.length);
  assert.strictEqual(new Set(ex).size, views.length);
});
test("eligible set = generic pool + this view's exclusive", () => {
  assert.deepStrictEqual(PS.eligiblePalettes("spiral"),
    ["crt","neon","mono","chroma","vortex"]);
});
test("nextPalette cycles within the eligible set and never lands on another view's exclusive", () => {
  let t = "crt";
  const seen = new Set();
  for (let i = 0; i < 5; i++) { t = PS.nextPalette("spiral", t, +1); seen.add(t); }
  assert.ok(!seen.has("nebula") && !seen.has("plasma"));
  assert.ok(seen.has("vortex"));
});
test("reconcileTheme keeps generic, snaps foreign exclusive to this view's", () => {
  assert.strictEqual(PS.reconcileTheme("spiral", "neon"), "neon");
  assert.strictEqual(PS.reconcileTheme("spiral", "vortex"), "vortex");
  assert.strictEqual(PS.reconcileTheme("spiral", "ember"), "vortex");
});
