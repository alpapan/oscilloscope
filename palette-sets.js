// palette-sets.js - which palettes each view may cycle. No DOM, no Pixi.
const GENERIC = ["crt", "neon", "mono", "chroma"];
const EXCLUSIVE = {
  waveform: "phosphor", spectrum: "prism", lissajous: "stereo",
  cosmos: "nebula", grove: "verdant", firebird: "ember",
  spiral: "vortex", bloom: "orchid", lasso: "voltage", starburst: "supernova", nova: "plasma",
};
function eligiblePalettes(view) {
  const ex = EXCLUSIVE[view];
  return ex ? [...GENERIC, ex] : [...GENERIC];
}
function nextPalette(view, current, dir) {
  const set = eligiblePalettes(view);
  const i = set.indexOf(current);
  if (i < 0) return dir > 0 ? set[0] : set[set.length - 1];
  return set[(i + dir + set.length) % set.length];
}
function reconcileTheme(view, theme) {
  const ex = EXCLUSIVE[view];
  if (GENERIC.includes(theme)) return theme;
  if (ex && theme === ex) return theme;
  return ex || GENERIC[0];
}
function isExclusive(theme) { return Object.values(EXCLUSIVE).includes(theme); }

// Unique top-level name: classic <script> tags share one global lexical scope,
// so a duplicate `const` across files stops the later script from loading.
const paletteSetsApi = { GENERIC, EXCLUSIVE, eligiblePalettes, nextPalette, reconcileTheme, isExclusive };
if (typeof module !== "undefined" && module.exports) module.exports = paletteSetsApi;
if (typeof globalThis !== "undefined") globalThis.PaletteSets = paletteSetsApi;
