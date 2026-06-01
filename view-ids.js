// view-ids.js - the canonical view<->wire-id mapping. No DOM, no Pixi.
const VIEW_ORDER = [
  "waveform", "spectrum", "lissajous", "cosmos", "grove", "firebird",
  "spiral", "bloom", "lasso", "starburst", "nova", "nowplaying",
];
function viewToId(view) { const i = VIEW_ORDER.indexOf(view); return i < 0 ? 0 : i; }
function idToView(id) { return VIEW_ORDER[id] || "waveform"; }
// Views selectable in the cycle for a given capture mode. now-playing is
// unavailable in mic mode: the mic captures acoustic input that has no relation
// to the phone's MediaSession, so the readout would be misleading.
function viewsFor(micMode) { return micMode ? VIEW_ORDER.filter(v => v !== "nowplaying") : VIEW_ORDER.slice(); }

if (typeof module !== "undefined" && module.exports) module.exports = { VIEW_ORDER, viewToId, idToView, viewsFor };
if (typeof globalThis !== "undefined") globalThis.ViewIds = { VIEW_ORDER, viewToId, idToView, viewsFor };
