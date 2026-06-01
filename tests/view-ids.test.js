const { test } = require("node:test");
const assert = require("node:assert/strict");
const { VIEW_ORDER, viewToId, idToView } = require("../view-ids.js");

test("VIEW_ORDER has the 11 views in wire order", () => {
  assert.deepStrictEqual(VIEW_ORDER, [
    "waveform","spectrum","lissajous","cosmos","grove","firebird",
    "spiral","bloom","lasso","starburst","nova",
  ]);
});
test("viewToId / idToView round-trip", () => {
  for (let id = 0; id < VIEW_ORDER.length; id++) {
    assert.strictEqual(viewToId(idToView(id)), id);
  }
  assert.strictEqual(viewToId("waveform"), 0);
  assert.strictEqual(viewToId("nova"), 10);
});
test("unknown names/ids fall back to waveform / 0", () => {
  assert.strictEqual(viewToId("bogus"), 0);
  assert.strictEqual(idToView(99), "waveform");
  assert.strictEqual(idToView(-1), "waveform");
});
