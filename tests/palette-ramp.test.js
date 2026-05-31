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

test("bakeRamp hueOffsetDeg rotates every stop's hue", () => {
  const stops = [{ L: 0.6, C: 0.2, h: 30 }, { L: 0.6, C: 0.2, h: 30 }];
  const a = { fg: 0, ramp: stops.map(s => ({ ...s })) }; bakeRamp(a, 0);
  const b = { fg: 0, ramp: stops.map(s => ({ ...s })) }; bakeRamp(b, 120);
  assert.notStrictEqual(colorAt(a, 0.5), colorAt(b, 0.5), "hue offset must change colour");
});
