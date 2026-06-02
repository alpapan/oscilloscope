// @ts-nocheck - intentionally duck-types a minimal fake DOM (global.window /
// document stubs) that TypeScript cannot model.
// Reproduction harness for the "single-tap palette is broken" report.
// Loads the real mobile-ui.js against a minimal fake DOM and drives the
// touch state machine directly, so the single/double-tap contract is locked
// and any logic-level break is reproducible off-device.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadMobileUi() {
  // mobile-ui.js is an IIFE that bails when `window` is undefined and reads
  // window.PaletteSets / window.classifySwipe / window.ViewIds at runtime.
  // Aliasing window to global keeps those lookups consistent with how the
  // browser <script> tags populate the same names.
  global.window = global;
  global.document = {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    body: { classList: { add() {}, remove() {}, contains() { return false; } } },
  };
  require(path.join(ROOT, "palette-sets.js"));   // sets global.PaletteSets
  require(path.join(ROOT, "swipe-detector.js")); // sets global.classifySwipe
  delete require.cache[require.resolve(path.join(ROOT, "mobile-ui.js"))];
  require(path.join(ROOT, "mobile-ui.js"));      // sets global.MobileUI
  return global.MobileUI;
}

function freshState() {
  return {
    view: "waveform", theme: "crt", micMode: false,
    sensitivity: 1, autoGain: false, fftSize: 2048, smoothing: 0.8,
    bandGain: { bass: 1, mid: 1, treb: 1 },
  };
}

function wireFakeCanvas(MobileUI, state) {
  const handlers = {};
  const canvas = {
    clientWidth: 1000,
    addEventListener(type, fn) { handlers[type] = fn; },
  };
  let applyCalls = 0;
  MobileUI.wireGestures(canvas, state, () => { applyCalls++; });
  const touch = (x, y) => ({ changedTouches: [{ clientX: x, clientY: y }] });
  return {
    start: (x, y) => handlers.touchstart(touch(x, y)),
    end: (x, y) => handlers.touchend(touch(x, y)),
    applyCalls: () => applyCalls,
  };
}

test("isolated single tap cycles the palette by one after the double-tap window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const MobileUI = loadMobileUi();
  const state = freshState();
  const ui = wireFakeCanvas(MobileUI, state);

  ui.start(200, 300);
  ui.end(200, 300);            // negligible movement -> tap; palette change scheduled
  assert.strictEqual(state.theme, "crt", "palette must not change before the window elapses");

  t.mock.timers.tick(300);     // confirmed single tap
  assert.strictEqual(state.theme, "neon", "single tap should advance crt -> neon");
  assert.strictEqual(state.view, "waveform", "single tap must not change the view");
});

test("double tap cycles the view and leaves the palette untouched", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const MobileUI = loadMobileUi();
  const state = freshState();
  const ui = wireFakeCanvas(MobileUI, state);

  ui.start(200, 300); ui.end(200, 300);   // first tap
  ui.start(202, 302); ui.end(202, 302);   // second tap within the window (no tick)
  t.mock.timers.tick(300);

  assert.strictEqual(state.view, "spectrum", "double tap should advance waveform -> spectrum");
  assert.strictEqual(state.theme, "crt", "double tap must not change the palette");
});

// Characterisation (not yet an assertion of desired behaviour): a duplicate
// touchend delivered immediately after the first - a plausible on-device
// micro-bounce - is currently swallowed by the double-tap branch, cancelling
// the pending palette change. Documents the suspected device-side mechanism.
test("CHARACTERISATION: a duplicate touchend at ~0ms is read as a double tap", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const MobileUI = loadMobileUi();
  const state = freshState();
  const ui = wireFakeCanvas(MobileUI, state);

  ui.start(200, 300); ui.end(200, 300);   // intended single tap
  ui.start(200, 300); ui.end(200, 300);   // spurious duplicate touchend, same spot, ~0ms
  t.mock.timers.tick(300);

  // Current behaviour: the duplicate is treated as a deliberate double tap.
  assert.strictEqual(state.view, "spectrum", "duplicate touchend currently cycles the view");
  assert.strictEqual(state.theme, "crt", "duplicate touchend currently suppresses the palette change");
});
