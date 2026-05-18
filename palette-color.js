// Palette color adapted from projectM's ApplyHueShaderColors. Each palette
// has a base color (fg, packed RGB), a cycling amplitude in radians, and a
// hue jump applied on beat. Output is a packed RGB int.
//
// Constants are adapted, not quoted from projectM. Hue-cycling period is
// ~30 s at full amplitude (hueCycleRadians = π).

const HUE_CYCLE_FREQ = 2 * Math.PI / 30;   // rad/s; period ~30 s at full π

function rgbIntToHsv(rgb) {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >>  8) & 0xff) / 255;
  const b = ( rgb        & 0xff) / 255;
  const cmax = Math.max(r, g, b);
  const cmin = Math.min(r, g, b);
  const d = cmax - cmin;
  let h = 0;
  if (d > 0) {
    if (cmax === r) h = ((g - b) / d) % 6;
    else if (cmax === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = cmax === 0 ? 0 : d / cmax;
  const v = cmax;
  return { h, s, v };
}

function hsvToRgbInt(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const rb = Math.round((r + m) * 255);
  const gb = Math.round((g + m) * 255);
  const bb = Math.round((b + m) * 255);
  return (rb << 16) | (gb << 8) | bb;
}

function currentColor(palette, time, beatPulse) {
  const cycleRad = palette.hueCycleRadians || 0;
  const beatRad  = palette.hueShiftOnBeat || 0;
  // Fast path: no hue manipulation requested.
  if (cycleRad === 0 && beatRad === 0) return palette.fg;
  const { h, s, v } = rgbIntToHsv(palette.fg);
  if (s === 0) return palette.fg;   // desaturated (e.g. white): hue has no effect
  // hueCycleRadians is the amplitude in *radians*; convert to degrees on the wheel.
  const cycleDeg = (cycleRad * Math.sin(time * HUE_CYCLE_FREQ)) * 180 / Math.PI;
  const beatDeg  = (beatRad * beatPulse) * 180 / Math.PI;
  return hsvToRgbInt(h + cycleDeg + beatDeg, s, v);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { currentColor, HUE_CYCLE_FREQ };
}
if (typeof globalThis !== "undefined") {
  globalThis.PaletteColor = { currentColor, HUE_CYCLE_FREQ };
}
