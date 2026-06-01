const { test } = require("node:test");
const assert = require("node:assert/strict");
const { VIEW_ORDER, viewToId, idToView } = require("../view-ids.js");

test("VIEW_ORDER has the 12 views in wire order", () => {
  assert.deepStrictEqual(VIEW_ORDER, [
    "waveform","spectrum","lissajous","cosmos","grove","firebird",
    "spiral","bloom","lasso","starburst","nova","nowplaying",
  ]);
});
test("nowplaying is the last view id (11) and round-trips", () => {
  assert.equal(VIEW_ORDER[VIEW_ORDER.length - 1], "nowplaying");
  assert.equal(viewToId("nowplaying"), 11);
  assert.equal(idToView(11), "nowplaying");
  assert.equal(VIEW_ORDER.length, 12);
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
