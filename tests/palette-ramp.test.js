const { test } = require("node:test");
const assert = require("node:assert/strict");
const { oklchToRgbInt, bakeRamp, colorAt } = require("../palette-color.js");

function rgb(int) { return [(int >> 16) & 255, (int >> 8) & 255, int & 255]; }

test("oklchToRgbInt converts high-L low-C to near white", () => {
  const [r, g, b] = rgb(oklchToRgbInt(0.98, 0.02, 95));
  assert.ok(r > 240 && g > 240 && b > 220, `got ${r},${g},${b}`);
});

test("bakeRamp on a 1-stop ramp makes colorAt return fg for all t", () => {
  const pal = { fg: 0x123456, ramp: [{ L: 0.5, C: 0.1, h: 200 }] };
  bakeRamp(pal, 0);
  assert.strictEqual(colorAt(pal, 0), 0x123456);
  assert.strictEqual(colorAt(pal, 0.5), 0x123456);
  assert.strictEqual(colorAt(pal, 1), 0x123456);
});

test("bakeRamp multi-stop: colorAt endpoints differ in luminance, mid between", () => {
  const pal = { fg: 0, ramp: [
    { L: 0.2, C: 0.05, h: 270 }, { L: 0.9, C: 0.05, h: 270 },
  ] };
  bakeRamp(pal, 0);
  const lo = rgb(colorAt(pal, 0)), hi = rgb(colorAt(pal, 1)), mid = rgb(colorAt(pal, 0.5));
  const sum = a => a[0] + a[1] + a[2];
  assert.ok(sum(hi) > sum(lo), "t=1 lighter than t=0");
  assert.ok(sum(mid) > sum(lo) && sum(mid) < sum(hi), "mid between ends");
});

test("bakeRamp applies hueOffsetDeg only to tempoHue palettes", () => {
  const stops = [{ L: 0.6, C: 0.2, h: 30 }, { L: 0.6, C: 0.2, h: 30 }];
  // A fixed palette (no tempoHue) must ignore the tempo hue offset so it keeps
  // its designed colours regardless of tempo.
  const fixed0   = { fg: 0, ramp: stops.map(s => ({ ...s })) }; bakeRamp(fixed0, 0);
  const fixed120 = { fg: 0, ramp: stops.map(s => ({ ...s })) }; bakeRamp(fixed120, 120);
  assert.strictEqual(colorAt(fixed0, 0.5), colorAt(fixed120, 0.5), "fixed palette ignores tempo hue offset");
  // A tempoHue palette rotates every stop by the offset.
  const rot0   = { fg: 0, tempoHue: true, ramp: stops.map(s => ({ ...s })) }; bakeRamp(rot0, 0);
  const rot120 = { fg: 0, tempoHue: true, ramp: stops.map(s => ({ ...s })) }; bakeRamp(rot120, 120);
  assert.notStrictEqual(colorAt(rot0, 0.5), colorAt(rot120, 0.5), "tempoHue palette rotates with offset");
});

test("new exclusive palettes bake to a 256-entry multi-stop LUT", () => {
  const ramps = {
    phosphor: [{L:0.32,C:0.09,h:70},{L:0.93,C:0.07,h:88}],
    prism:    [{L:0.60,C:0.20,h:25},{L:0.52,C:0.22,h:300}],
    plasma:   [{L:0.42,C:0.19,h:290},{L:0.95,C:0.08,h:72}],
  };
  for (const key of Object.keys(ramps)) {
    const p = { ramp: ramps[key] };
    bakeRamp(p, 0);
    assert.ok(p._lut && p._lut.length === 256, `${key} LUT`);
    assert.notStrictEqual(p._lut[0], p._lut[255]);
    assert.ok(new Set(p._lut).size > 8, `${key} is a real multi-stop gradient`);
  }
});
