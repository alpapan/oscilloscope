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
  let r, g, b;
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

// --- OKLCH -> sRGB (Björn Ottosson). L 0-1, C ~0-0.4, h degrees. ---
function oklchToRgbInt(L, C, h) {
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad), b = C * Math.sin(rad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const enc = (v) => {
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    const s2 = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, s2)) * 255);
  };
  return (enc(lr) << 16) | (enc(lg) << 8) | enc(lb);
}

// Bake the palette's OKLCH ramp into a 256-entry packed-RGB LUT, with an
// absolute hueOffsetDeg added to every stop (tempo mapping). A ramp of < 2
// stops is monochrome: the LUT is left null and colorAt returns fg.
function bakeRamp(palette, hueOffsetDeg = 0) {
  const ramp = palette.ramp || [];
  if (ramp.length < 2) { palette._lut = null; return; }
  const lut = new Uint32Array(256);
  const segs = ramp.length - 1;
  for (let j = 0; j < 256; j++) {
    const t = j / 255;
    const f = t * segs;
    const i = Math.min(segs - 1, Math.floor(f));
    const u = f - i;
    const a = ramp[i], b = ramp[i + 1];
    // shortest-path hue lerp: (delta+540)%360-180 maps to [-180,180] so a
    // stop at h=10 and next at h=350 lerp via -20 deg, not +340.
    const dh = ((b.h - a.h + 540) % 360) - 180;
    const L = a.L + (b.L - a.L) * u;
    const C = a.C + (b.C - a.C) * u;
    const h = a.h + dh * u + hueOffsetDeg;
    lut[j] = oklchToRgbInt(L, C, h);
  }
  palette._lut = lut;
}

function colorAt(palette, t) {
  if (!palette._lut) return palette.fg;
  const j = Math.max(0, Math.min(255, Math.round(t * 255)));
  return palette._lut[j];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { currentColor, HUE_CYCLE_FREQ, oklchToRgbInt, bakeRamp, colorAt };
}
if (typeof globalThis !== "undefined") {
  globalThis.PaletteColor = { currentColor, HUE_CYCLE_FREQ, oklchToRgbInt, bakeRamp, colorAt };
}
