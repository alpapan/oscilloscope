// view-ids.js - the canonical view<->wire-id mapping. No DOM, no Pixi.
const VIEW_ORDER = [
  "waveform", "spectrum", "lissajous", "cosmos", "grove", "firebird",
  "spiral", "bloom", "lasso", "starburst", "nova",
];
function viewToId(view) { const i = VIEW_ORDER.indexOf(view); return i < 0 ? 0 : i; }
function idToView(id) { return VIEW_ORDER[id] || "waveform"; }

if (typeof module !== "undefined" && module.exports) module.exports = { VIEW_ORDER, viewToId, idToView };
if (typeof globalThis !== "undefined") globalThis.ViewIds = { VIEW_ORDER, viewToId, idToView };
