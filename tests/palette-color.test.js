const test = require("node:test");
const assert = require("node:assert/strict");
const { currentColor } = require("../palette-color.js");

const CRT  = { fg: 0x33ff66, hueCycleRadians: Math.PI / 12, hueShiftOnBeat: 0 };
const NEON = { fg: 0x00e5ff, hueCycleRadians: Math.PI,      hueShiftOnBeat: Math.PI / 3 };
const MONO = { fg: 0xffffff, hueCycleRadians: 0,            hueShiftOnBeat: 0 };

test("currentColor: Mono returns base unchanged at any time/beat", () => {
  assert.equal(currentColor(MONO, 0, 0), 0xffffff);
  assert.equal(currentColor(MONO, 12.345, 0.7), 0xffffff);
});

test("currentColor: CRT cycles with green dominant for all time/beat", () => {
  // CRT base ~120° (green); ±15° range keeps green dominant.
  for (let t = 0; t < 60; t += 0.1) {
    const c = currentColor(CRT, t, 0);
    const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
    assert.ok(g >= r, `green not dominant over red at t=${t}: g=${g} r=${r}`);
    assert.ok(g >= b, `green not dominant over blue at t=${t}: g=${g} b=${b}`);
  }
});

test("currentColor: Neon hue jumps on beatPulse=1, returns near base at beatPulse=0", () => {
  const baseCyan = currentColor(NEON, 0, 0);
  const onBeat   = currentColor(NEON, 0, 1);
  assert.notEqual(baseCyan, onBeat, "hue shifts on beat");
  const decayed  = currentColor(NEON, 0, 0.01);
  const r1 = (baseCyan >> 16) & 0xff, r2 = (decayed >> 16) & 0xff;
  const g1 = (baseCyan >> 8) & 0xff,  g2 = (decayed >> 8) & 0xff;
  const b1 = baseCyan & 0xff,         b2 = decayed & 0xff;
  assert.ok(Math.abs(r1 - r2) <= 8, `r diff=${Math.abs(r1 - r2)}`);
  assert.ok(Math.abs(g1 - g2) <= 8, `g diff=${Math.abs(g1 - g2)}`);
  assert.ok(Math.abs(b1 - b2) <= 8, `b diff=${Math.abs(b1 - b2)}`);
});
