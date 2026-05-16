# Scope — Music Oscilloscope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Scope", a single-page web visualiser that captures audio from a Chromium tab (Spotify Web Player, YouTube) via `getDisplayMedia({audio: true})` and renders it through three views (time-domain waveform, frequency spectrum, stereo Lissajous) with three switchable themes (retro CRT, neon glow, minimal mono).

**Architecture:** Flat single-file project. Three top-level files (`index.html`, `main.js`, `style.css`) plus `docs/` and `README.md`. PixiJS v8 + pixi-filters v6 loaded from jsdelivr CDN as `<script>` tags. Audio graph built once at capture-start (`MediaStreamSource → GainNode → ChannelSplitterNode → [AnalyserNode_L, AnalyserNode_R]`); render loop is a single `requestAnimationFrame` that dispatches on the active view ID; trail persistence (CRT phosphor) is done via a PixiJS `RenderTexture` re-rendered with reduced alpha each frame.

**Tech Stack:** Vanilla JavaScript (no build step, no bundler, no TypeScript), HTML5, CSS3, Web Audio API, PixiJS 8.x, pixi-filters 6.x. Tests via `node --test` (built into Node 18+, no test framework). Dev server: `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md` (read this before starting; it is the source of truth for design decisions and contains a §14 resolution table for all 13 plan-reviewer findings).

**Project root:** `~/my_work/oscilloscope/` (paths in this plan are relative to that root unless prefixed).

**Important rules for the implementer:**

- **No commits per task.** Implement multiple tasks, verify each one's acceptance criterion, then make ONE commit at the very end (Task 17 — Final Commit). The user's project rule overrides the writing-plans skill's default of frequent commits.
- **No mocks of our own code.** Tests live only for the two pure helpers (`freqToX`, `findZeroCrossing`). Everything else is verified by manual browser checks. Do not introduce a mock of `audio.gain`, `pixi.app`, or any other internal handle.
- **No `file://` testing.** Always run via `python3 -m http.server 8000` from the project root. `getDisplayMedia` rejects `file://` origins with `SecurityError`.
- **Chromium browsers only.** Test in Chrome, Edge, or Brave. Firefox cannot capture tab audio.
- **PixiJS v8 API.** v7 patterns (`lineStyle()`, three-arg `renderer.render()`, `app.view`) are removed. Use v8 forms (`stroke({color, width})`, options-object `render({container, target, clear})`, `app.canvas`).

---

## File Structure

| File | Created in Task | Responsibility |
|---|---|---|
| `index.html` | T1 | DOM shell, CDN script tags for Pixi + pixi-filters, links to `style.css` and `main.js`, controls panel HTML |
| `style.css` | T1 / extended T5, T15 | Theme CSS variables, full-viewport canvas, controls panel layout and auto-hide |
| `main.js` | T1 / extended every task after | Entire app: pure helpers, state object, themes, audio graph, PixiJS init, render loop, view draw functions, event wiring |
| `tests/helpers.test.js` | T2 / extended T3 | Node tests for `freqToX` and `findZeroCrossing` |
| `docs/manual-qa.md` | T16 | Manual QA checklist for release verification |
| `README.md` | T16 | Quickstart: how to run, browser requirements, hotkeys |

---

## Task 1: Project scaffolding

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `main.js`
- Create: `tests/` (empty directory; populated in Task 2)

- [ ] **Step 1: Create `index.html` with the CDN scripts and DOM skeleton**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scope</title>
  <link rel="stylesheet" href="style.css">
  <script src="https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pixi-filters@6/dist/browser/pixi-filters.min.js"></script>
</head>
<body>
  <canvas id="stage"></canvas>
  <div id="controls" hidden>
    <button id="stop" type="button">Stop</button>
    <label>View
      <select id="view">
        <option value="waveform">Waveform</option>
        <option value="spectrum">Spectrum</option>
        <option value="lissajous">Lissajous</option>
      </select>
    </label>
    <label>Theme
      <select id="theme">
        <option value="crt">Retro CRT</option>
        <option value="neon">Neon glow</option>
        <option value="mono">Minimal mono</option>
      </select>
    </label>
    <label>Sensitivity
      <input id="gain" type="range" min="0.1" max="4" step="0.1" value="1">
    </label>
    <details>
      <summary>Advanced</summary>
      <label>FFT size
        <select id="fft">
          <option>256</option><option>512</option><option>1024</option>
          <option selected>2048</option><option>4096</option><option>8192</option>
          <option>16384</option><option>32768</option>
        </select>
      </label>
      <label>Smoothing
        <input id="smooth" type="range" min="0" max="0.95" step="0.05" value="0.6">
      </label>
    </details>
  </div>
  <div id="start-screen">
    <h1>Scope</h1>
    <p>A music oscilloscope. Open Spotify Web Player or YouTube in another tab, then click Start and share that tab with audio.</p>
    <button id="capture" type="button">Start capture</button>
    <p id="status"></p>
  </div>
  <script src="main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `style.css` with minimal layout**

```css
:root {
  --bg: #000;
  --fg: #33ff66;
  --panel-bg: rgba(0, 0, 0, 0.5);
  --panel-fg: #ddd;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--panel-fg);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  overflow: hidden;
}

#stage {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

#start-screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 24px;
  background: var(--bg);
}

#start-screen h1 {
  font-size: 64px;
  letter-spacing: 8px;
  margin: 0 0 24px;
  color: var(--fg);
}

#start-screen p {
  max-width: 480px;
  margin: 8px 0;
}

#start-screen button {
  margin-top: 24px;
  padding: 16px 32px;
  font-size: 18px;
  background: var(--fg);
  color: #000;
  border: none;
  cursor: pointer;
}

#status {
  min-height: 1.4em;
  color: #f88;
}

#controls {
  position: fixed;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--panel-bg);
  color: var(--panel-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font-size: 13px;
}

#controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

#controls[hidden] { display: none; }
```

- [ ] **Step 3: Create `main.js` with the file-header comment and a no-op DOMContentLoaded handler**

```js
// Scope — Music Oscilloscope
// See docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md

// =============================================================================
// Pure helpers (also testable in Node)
// =============================================================================

// (Task 2: freqToX)
// (Task 3: findZeroCrossing)

// =============================================================================
// Browser-only state, audio, render, views, controls
// =============================================================================

// Status surface — used by init() error handling, capture errors, and the
// silent-input detection. Pulled into scaffolding (not inside the audio
// section) because init() references it before the audio code is written.
function setStatus(text) {
  const el = typeof document !== "undefined" ? document.getElementById("status") : null;
  if (el) el.textContent = text;
}

// (Tasks 4 onwards)

function init() {
  // Wired in later tasks.
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

if (typeof module !== "undefined") {
  module.exports = { /* helpers added in T2/T3 */ };
}
```

- [ ] **Step 4: Verify the scaffolding loads cleanly in a Chromium browser**

Run from the project root:
```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in Chrome/Edge/Brave. **Expected:**
- Page shows "Scope" heading, the description paragraph, and a "Start capture" button.
- Browser DevTools Console (F12) shows zero errors — in particular, both `<script src="https://cdn.jsdelivr.net/npm/pixi.js@8/...">` and the pixi-filters script must load (200 OK in the Network tab).
- Clicking "Start capture" does nothing yet (no handler wired).

If a CDN URL 404s, the version pin moved; pin to a known-good minor like `pixi.js@8.6.6` and re-test.

---

## Task 2: `freqToX` helper (TDD)

**Files:**
- Create: `tests/helpers.test.js`
- Modify: `main.js` (Pure helpers section near top + module.exports at bottom)

- [ ] **Step 1: Write the failing test**

Create `tests/helpers.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { freqToX } = require("../main.js");

test("freqToX maps 20 Hz to x = 0", () => {
  assert.strictEqual(freqToX(20, 1000), 0);
});

test("freqToX maps 20000 Hz to x = width", () => {
  assert.strictEqual(freqToX(20000, 1000), 1000);
});

test("freqToX is logarithmic: sqrt(20 * 20000) ≈ 632 Hz lands at half-width", () => {
  const x = freqToX(Math.sqrt(20 * 20000), 1000);
  assert.ok(Math.abs(x - 500) < 1, `expected ~500, got ${x}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/helpers.test.js
```

**Expected:** All three tests fail with `TypeError: freqToX is not a function`. The `require('../main.js')` call succeeds (Task 1 created the file with a `module.exports = { }` block), but destructuring `freqToX` from the empty export gives `undefined`, and calling `undefined(20, 1000)` throws.

- [ ] **Step 3: Implement `freqToX` in `main.js`**

Locate the `// (Task 2: freqToX)` comment line in `main.js` and replace that section so it reads:

```js
function freqToX(freq, width) {
  const minLog = Math.log(20);
  const maxLog = Math.log(20000);
  return (Math.log(freq) - minLog) / (maxLog - minLog) * width;
}
```

At the bottom of `main.js`, update the export block:

```js
if (typeof module !== "undefined") {
  module.exports = { freqToX };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/helpers.test.js
```

**Expected:** All three tests pass; output reports `tests 3`, `pass 3`, `fail 0`.

---

## Task 3: `findZeroCrossing` helper (TDD)

**Files:**
- Modify: `tests/helpers.test.js` (add three tests)
- Modify: `main.js` (add function + extend module.exports)

- [ ] **Step 1: Write the failing tests**

Append to `tests/helpers.test.js`:

```js
const { findZeroCrossing } = require("../main.js");

test("findZeroCrossing returns first index where buf[i] < 0 and buf[i+1] >= 0", () => {
  const buf = [0.5, 0.1, -0.2, -0.1, 0.3, 0.4];
  assert.strictEqual(findZeroCrossing(buf), 3);
});

test("findZeroCrossing returns 0 when no negative-to-positive transition exists", () => {
  const buf = [0.1, 0.2, 0.3, 0.4];
  assert.strictEqual(findZeroCrossing(buf), 0);
});

test("findZeroCrossing returns the negative-sample index when buf[i+1] is exactly 0 (zero-crossing to silence)", () => {
  const buf = [-0.1, 0, 0.2, 0.3];
  assert.strictEqual(findZeroCrossing(buf), 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test tests/helpers.test.js
```

**Expected:** The three new tests fail with `findZeroCrossing is not a function`; the three Task 2 tests still pass.

- [ ] **Step 3: Implement `findZeroCrossing`**

In `main.js`, add below the `freqToX` function:

```js
function findZeroCrossing(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] < 0 && buf[i + 1] >= 0) return i;
  }
  return 0;
}
```

Extend the module.exports:

```js
if (typeof module !== "undefined") {
  module.exports = { freqToX, findZeroCrossing };
}
```

- [ ] **Step 4: Run the tests to verify all pass**

```bash
node --test tests/helpers.test.js
```

**Expected:** All six tests pass; `tests 6`, `pass 6`, `fail 0`.

---

## Task 4: State object and themes

**Files:**
- Modify: `main.js` (add `state`, `audio`, `pixi`, `themes` declarations in the browser-only section)

- [ ] **Step 1: Declare the state, audio handles, pixi handles, and themes**

In `main.js`, replace the `// (Tasks 4 onwards)` comment with:

```js
const state = {
  view: "waveform",       // "waveform" | "spectrum" | "lissajous"
  theme: "crt",           // "crt" | "neon" | "mono"
  sensitivity: 1.0,
  fftSize: 2048,
  smoothing: 0.6,
  running: false,
  channels: 2,            // detected at capture start
};

const audio = {
  ctx: null,
  stream: null,
  source: null,
  gain: null,
  splitter: null,
  analyserL: null,
  analyserR: null,
};

const pixi = {
  app: null,
  trail: null,            // PIXI.RenderTexture
  trailSprite: null,      // PIXI.Sprite
  current: null,          // PIXI.Graphics
  fade: null,             // PIXI.Graphics for the decay overlay
};

const themes = {
  crt:  { fg: 0x33ff66, fgCss: "#33ff66", decayAlpha: 0.12, lineWidth: 1.5, filters: [] },
  neon: { fg: 0x00e5ff, fgCss: "#00e5ff", decayAlpha: 1.0,  lineWidth: 2.0, filters: [] },
  mono: { fg: 0xffffff, fgCss: "#ffffff", decayAlpha: 1.0,  lineWidth: 1.0, filters: [] },
};
// Filters are populated inside init() once PIXI globals are available
// (they reference new PIXI.filters.GlowFilter etc.; instantiating them at
// module top-level would crash under node --test).
```

- [ ] **Step 2: Verify with a manual console check**

Reload `http://localhost:8000` in Chromium. Open DevTools console and run:

```js
state.view; state.theme; themes.crt.fgCss;
```

**Expected:** Returns `"waveform"`, `"crt"`, `"#33ff66"`. No errors.

- [ ] **Step 3: Verify the Node tests still pass**

```bash
node --test tests/helpers.test.js
```

**Expected:** All six tests still pass. (Declaring `themes` at module top-level must not break the Node harness; the filter arrays are empty so PIXI is never referenced.)

---

## Task 5: PixiJS Application and trail render texture

**Files:**
- Modify: `main.js` (extend `init()` to create the Pixi Application, RenderTexture, scene graph, and instantiate filters into `themes`)

- [ ] **Step 1: Implement Pixi initialisation inside `init()`**

Replace the body of `init()` in `main.js`. The Pixi init is wrapped
in a try/catch so that a WebGL failure or missing canvas surfaces via
`setStatus()` rather than as an unhandled promise rejection that
leaves the page blank with only a DevTools warning. (The Task 1
`DOMContentLoaded` handler invokes `init` without `await` — that is
intentional because a DOM event listener cannot await; the try/catch
inside `init()` is the supported way to handle async failures.)

```js
async function init() {
  try {
    pixi.app = new PIXI.Application();
    await pixi.app.init({
      canvas: document.getElementById("stage"),
      resizeTo: window,
      background: 0x000000,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    const w = window.innerWidth;
    const h = window.innerHeight;
    pixi.trail = PIXI.RenderTexture.create({
      width: w,
      height: h,
      resolution: window.devicePixelRatio || 1,
    });
    pixi.trailSprite = new PIXI.Sprite(pixi.trail);
    pixi.app.stage.addChild(pixi.trailSprite);

    pixi.fade = new PIXI.Graphics();
    pixi.current = new PIXI.Graphics();
    // pixi.fade and pixi.current are deliberately NOT added to app.stage.
    // The spec's §5 scene graph shows `current` as a stage child for
    // illustrative purposes; this implementation renders them into the
    // trail texture explicitly via `renderer.render(graphics, {renderTexture})`
    // each frame (see Task 7). Adding `current` to stage would cause the
    // fresh trace to be drawn twice per frame — once baked into the trail
    // texture (with decay over time) and once live on stage (with no
    // decay), producing a doubled trace on the CRT theme. Do not "fix"
    // this by adding them to stage.

    // Populate theme filters now that PIXI.filters is available.
    // VERIFY BEFORE WRITING THIS BLOCK: open DevTools console after the
    // page loads and run `Object.keys(PIXI.filters)`. The output must
    // include `GlowFilter`, `CRTFilter`, and `BloomFilter`. If
    // `PIXI.filters` is undefined, the pixi-filters CDN bundle failed
    // to load — check the Network tab. If the classes are at the top
    // level (e.g. `PIXI.GlowFilter`), the browser bundle moved its
    // exports; adjust the constructor calls accordingly.
    themes.crt.filters = [
      new PIXI.filters.GlowFilter({ distance: 8, outerStrength: 1.5, color: 0x33ff66 }),
      new PIXI.filters.CRTFilter({ curvature: 1, lineWidth: 1, vignetting: 0.3 }),
    ];
    themes.neon.filters = [
      new PIXI.filters.BloomFilter({ strength: { x: 8, y: 8 } }),
    ];
    themes.mono.filters = [];

    // Apply default theme to trailSprite so the first frame already has filters.
    pixi.trailSprite.filters = themes[state.theme].filters;

    // Resize handling: rebuild trail on viewport change.
    // Note: the spec's §5 says `ResizeObserver on document.body`. This plan
    // uses `window.addEventListener("resize")` because the canvas is fixed
    // to the viewport (`position: fixed; inset: 0`); the two are functionally
    // equivalent for this layout (any viewport-size change is reflected in
    // both). `ResizeObserver` would be the right choice if the canvas were
    // sized to a non-viewport container element.
    const resize = () => {
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      pixi.trail.destroy(true);
      pixi.trail = PIXI.RenderTexture.create({
        width: newW,
        height: newH,
        resolution: window.devicePixelRatio || 1,
      });
      pixi.trailSprite.texture = pixi.trail;
    };
    window.addEventListener("resize", resize);
  } catch (err) {
    setStatus(`Visualiser failed to start: ${err.message}. WebGL may be unavailable in this browser.`);
    document.getElementById("capture").disabled = true;
    throw err;   // Re-throw so DevTools shows the underlying error too.
  }
}
```

Note: `setStatus` is referenced inside the catch and is defined in
Task 1's scaffolding (so it is callable from `init()` even if Pixi
init throws before any other code runs). The earlier (Task 1) empty
`init()` body is replaced here.

- [ ] **Step 2: Verify Pixi attaches and renders a black canvas**

Reload the page. **Expected:**
- The page still shows the "Scope" start screen.
- DevTools Console shows zero errors.
- Inspecting the DOM, `<canvas id="stage">` has `width` and `height` attributes matching the viewport × devicePixelRatio.
- Running `pixi.app.canvas` in the console returns the canvas element.
- Running `pixi.trail.width` returns the viewport width (CSS px).

If `PIXI.filters` is undefined, the pixi-filters CDN bundle failed to load — check the Network tab and the script URL.

- [ ] **Step 3: Verify Node tests still pass**

```bash
node --test tests/helpers.test.js
```

**Expected:** Still 6/6 pass. (No browser globals at module top-level were added; everything is inside `init()` which Node never invokes.)

---

## Task 6: Audio capture (startCapture + stopCapture)

**Files:**
- Modify: `main.js` (add `startCapture`, `stopCapture`, helper to set status text, and wire the Start button)

- [ ] **Step 1: Implement `startCapture` and `stopCapture`**

Below the `themes` declaration in `main.js`, add (`setStatus` is
already in scaffolding from Task 1; do not redefine it):

```js
async function startCapture() {
  if (state.running) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("This visualiser needs Chrome, Edge, or Brave. Firefox cannot capture tab audio.");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    if (err.name === "NotAllowedError") {
      setStatus("Capture cancelled. Click Start again to try once more.");
    } else {
      setStatus(`Capture failed: ${err.message}`);
    }
    return;
  }

  // Drop the video track immediately — we never use it, but leaving it active
  // keeps Chromium's screen-sharing indicator visible.
  stream.getVideoTracks().forEach(t => t.stop());

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    setStatus("No audio in the shared stream. Re-share the tab and tick 'Share tab audio'.");
    stream.getTracks().forEach(t => t.stop());
    return;
  }

  const audioTrack = audioTracks[0];
  state.channels = audioTrack.getSettings().channelCount ?? 2;

  // End-of-share detection from the browser bar's "Stop sharing" button.
  audioTrack.onended = () => {
    setStatus("Sharing ended.");
    stopCapture();
  };

  // Build the audio graph.
  audio.stream = stream;
  audio.ctx = new AudioContext();
  if (audio.ctx.state === "suspended") {
    await audio.ctx.resume();
  }
  audio.source = audio.ctx.createMediaStreamSource(stream);
  audio.gain = audio.ctx.createGain();
  audio.gain.gain.value = state.sensitivity;
  audio.splitter = audio.ctx.createChannelSplitter(2);
  audio.analyserL = audio.ctx.createAnalyser();
  audio.analyserR = audio.ctx.createAnalyser();
  audio.analyserL.fftSize = state.fftSize;
  audio.analyserR.fftSize = state.fftSize;
  audio.analyserL.smoothingTimeConstant = state.smoothing;
  audio.analyserR.smoothingTimeConstant = state.smoothing;

  audio.source.connect(audio.gain);
  audio.gain.connect(audio.splitter);
  audio.splitter.connect(audio.analyserL, 0);
  audio.splitter.connect(audio.analyserR, 1);
  // Note: we deliberately do not connect anything to audio.ctx.destination.

  state.running = true;
  setStatus("");
  document.getElementById("start-screen").hidden = true;
  document.getElementById("controls").hidden = false;

  // Render loop is started in Task 7.
}

function stopCapture() {
  // Idempotent: safe to call when already stopped.
  if (!state.running && !audio.stream && !audio.ctx) return;

  if (audio.stream) {
    audio.stream.getTracks().forEach(t => t.stop());
    audio.stream = null;
  }
  if (audio.ctx) {
    audio.ctx.close().catch(() => {});
    audio.ctx = null;
  }
  audio.source = audio.gain = audio.splitter = audio.analyserL = audio.analyserR = null;

  state.running = false;
  // Note: we don't cancelAnimationFrame here. The in-flight rAF tick (if
  // any) will call `frame()`, see `!state.running`, and exit immediately
  // without scheduling another tick. No leaked timer; no need for a
  // stored rAF handle.
  document.getElementById("start-screen").hidden = false;
  document.getElementById("controls").hidden = true;
}
```

- [ ] **Step 2: Wire the Start and Stop buttons inside `init()`**

At the end of `init()` (just before the closing brace), append:

```js
  document.getElementById("capture").addEventListener("click", startCapture);
  document.getElementById("stop").addEventListener("click", stopCapture);
```

- [ ] **Step 3: Verify capture starts and stops cleanly in the browser**

Reload `http://localhost:8000` in a Chromium browser. Open Spotify Web Player or a YouTube video in another tab and start playing audio.

In Scope, click "Start capture" → in the share-picker dialog, choose the Spotify/YouTube tab and tick "Share tab audio" → click Share.

**Expected:**
- Start screen disappears, controls panel appears top-left.
- Browser's screen-sharing indicator (red border / top-bar badge) is **not visible** — the video track was stopped.
- DevTools Console: zero errors. Running `audio.ctx.state` returns `"running"`. Running `audio.analyserL.fftSize` returns `2048`.

Click "Stop". **Expected:** Start screen returns, controls hidden, `state.running === false`, `audio.ctx` is `null`.

Try error paths:
- Click Start, then click Cancel in the share-picker → status shows "Capture cancelled. Click Start again to try once more."
- Click Start, share a window (not a tab) → status shows "No audio in the shared stream."

---

## Task 7: Render loop + applyState

**Files:**
- Modify: `main.js` (add `applyState`, `frame`, and the trail-fade rendering; start the loop at the end of `startCapture`)

- [ ] **Step 1: Implement `applyState` and the per-frame `frame` function**

Below `stopCapture` in `main.js`, add:

```js
function applyState() {
  if (audio.gain) {
    audio.gain.gain.value = state.sensitivity;
  }
  if (audio.analyserL && audio.analyserR) {
    audio.analyserL.fftSize = state.fftSize;
    audio.analyserR.fftSize = state.fftSize;
    audio.analyserL.smoothingTimeConstant = state.smoothing;
    audio.analyserR.smoothingTimeConstant = state.smoothing;
  }
  if (pixi.trailSprite) {
    pixi.trailSprite.filters = themes[state.theme].filters;
  }
  document.documentElement.style.setProperty("--fg", themes[state.theme].fgCss);

  // Sync UI controls to state (so hotkeys reflect in the dropdowns).
  const viewSel = document.getElementById("view");
  const themeSel = document.getElementById("theme");
  const gainEl = document.getElementById("gain");
  const fftEl = document.getElementById("fft");
  const smoothEl = document.getElementById("smooth");
  if (viewSel) viewSel.value = state.view;
  if (themeSel) themeSel.value = state.theme;
  if (gainEl) gainEl.value = String(state.sensitivity);
  if (fftEl) fftEl.value = String(state.fftSize);
  if (smoothEl) smoothEl.value = String(state.smoothing);

  // Mono guard for the Lissajous tab.
  if (viewSel) {
    const lissOpt = viewSel.querySelector('option[value="lissajous"]');
    if (lissOpt) {
      lissOpt.disabled = state.channels === 1;
      lissOpt.title = state.channels === 1 ? "Source is mono — no stereo to plot." : "";
    }
  }
}

function frame() {
  if (!state.running) return;
  const theme = themes[state.theme];
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Step 1: decay (or full clear) on the trail texture.
  pixi.fade.clear();
  pixi.fade.rect(0, 0, w, h).fill({ color: 0x000000, alpha: theme.decayAlpha });
  pixi.app.renderer.render(pixi.fade, { renderTexture: pixi.trail, clear: false });

  // Note on the renderer.render call form: PixiJS v8 keeps the two-argument
  // overload `render(container, { renderTexture, clear })` from v7 for
  // off-screen rendering into a RenderTexture. The single-object form
  // `render({ container, target, ... })` uses `target` as the source
  // container (not the destination), so it cannot be used here. If a future
  // Pixi minor removes the two-arg overload, the alternative documented in
  // v8.12+ is `render({ container: source, target: destinationRT, clear: false })`
  // — but at the time of writing only the two-arg form is unambiguously
  // documented as off-screen rendering into a texture.

  // Step 2: build this frame's fresh trace.
  pixi.current.clear();
  if (state.view === "waveform")  drawWaveform(pixi.current, audio.analyserL, theme, w, h);
  if (state.view === "spectrum")  drawSpectrum(pixi.current, audio.analyserL, theme, w, h);
  if (state.view === "lissajous") drawLissajous(pixi.current, audio.analyserL, audio.analyserR, theme, w, h);

  // Step 3: bake current onto the trail texture.
  pixi.app.renderer.render({ container: pixi.current, target: pixi.trail, clear: false });

  // PixiJS automatically presents the stage (which contains trailSprite) on the next tick.
  requestAnimationFrame(frame);
}

// Placeholder draw functions — implemented in Tasks 8, 9, 10.
function drawWaveform(g, analyser, theme, w, h) {}
function drawSpectrum(g, analyser, theme, w, h) {}
function drawLissajous(g, analyserL, analyserR, theme, w, h) {}
```

**Note on the `renderer.render` API:** The plan uses the two-argument
overload `renderer.render(sourceContainer, { renderTexture: destination,
clear: false })`. This is the form PixiJS v8 inherits from v7 for
off-screen rendering into a `RenderTexture`. The newer single-object
form `render({ container, target, clear })` uses `target` as the
**source** container (a v8 surprise that has caused widespread
confusion), so it cannot be used to specify a destination texture and
is not the right call form for trail accumulation. If a future Pixi
minor removes the two-arg overload, audit the
`AbstractRenderer.render` signature in `node_modules/pixi.js/src/`
(or via DevTools `pixi.app.renderer.render.toString()`) before
swapping forms.

**Verification microstep before Task 8:** After step 3, with capture
active, run in DevTools:

```js
pixi.app.renderer.extract.canvas(pixi.trail)
```

You should get an `HTMLCanvasElement`. Inspect it in the console — it
should show a thin black rectangle covering the viewport (the
single-frame decay write). If it shows a solid black image with no
content, or throws, the trail texture is not receiving the `fade`
render call. Resolve before proceeding to Task 8.

- [ ] **Step 2: Kick the render loop at the end of `startCapture`**

Inside `startCapture`, at the very end (just after `document.getElementById("controls").hidden = false;`), append:

```js
  applyState();
  requestAnimationFrame(frame);
```

- [ ] **Step 3: Verify the canvas turns black after capture starts**

Reload, start capture (share a tab). **Expected:**
- Canvas is fully black (no traces drawn yet — view-draw functions are placeholders).
- DevTools Console: zero errors.
- Running `state.running` returns `true`.

If the canvas shows leftover content from before capture (artifacts), the trail-fade write isn't reaching the trail texture; double-check the `target` vs `renderTexture` field name above.

---

## Task 8: drawWaveform

**Files:**
- Modify: `main.js` (replace the `drawWaveform` placeholder)

- [ ] **Step 1: Implement the waveform draw**

Replace the `drawWaveform` placeholder in `main.js`:

```js
function drawWaveform(g, analyser, theme, w, h) {
  if (!analyser) return;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);

  const start = findZeroCrossing(buf);
  const len = buf.length - start;
  if (len < 2) return;

  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * w;
    const y = h / 2 - buf[start + i] * (h / 2) * 0.9;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke({ color: theme.fg, width: theme.lineWidth });
}
```

- [ ] **Step 2: Verify the waveform renders against an audible source**

Reload, click Start capture, share a tab playing music with audible sound.

**Expected:**
- Canvas shows a moving green (CRT theme) waveform trace centred vertically.
- The trace is stable (does not slide horizontally) — this is the zero-crossing trigger working.
- With CRT theme, you should see a slight ghosting from previous frames (phosphor decay). If the trace clears entirely each frame, `theme.decayAlpha` isn't being applied — go back and check Task 7 Step 1's fade write.
- Switch theme dropdown to "neon glow" and reload only if needed: the trace should now redraw cleanly each frame (no decay). The dropdown wiring is in Task 12; for now, change manually in the console: `state.theme = "neon"; applyState();`

Try silence (mute the source tab): the trace flattens to a near-horizontal line at the canvas midline.

---

## Task 9: drawSpectrum

**Files:**
- Modify: `main.js` (replace `drawSpectrum`)

- [ ] **Step 1: Implement the spectrum draw**

Replace the `drawSpectrum` placeholder:

```js
function drawSpectrum(g, analyser, theme, w, h) {
  if (!analyser) return;
  const bins = analyser.frequencyBinCount;
  const buf = new Float32Array(bins);
  analyser.getFloatFrequencyData(buf);

  const sampleRate = audio.ctx.sampleRate;
  const minDb = -100;
  const maxDb = -30;

  // Build a path: walk along the visible audible range (20 Hz – 20 kHz),
  // mapping each bin to its log-X position and its dB-magnitude Y.
  let started = false;
  for (let i = 1; i < bins; i++) {
    const freq = (i * sampleRate) / analyser.fftSize;
    if (freq < 20 || freq > 20000) continue;
    const x = freqToX(freq, w);
    const mag = Math.max(0, Math.min(1, (buf[i] - minDb) / (maxDb - minDb)));
    const y = h - mag * h;
    if (!started) {
      g.moveTo(x, h);   // start of the ribbon at the bottom-left
      g.lineTo(x, y);
      started = true;
    } else {
      g.lineTo(x, y);
    }
  }
  // Close the ribbon back down to the baseline. The closing sequence
  // `lineTo(w, h)` + `lineTo(0, h)` + `closePath()` returns the path to
  // the moveTo start point via the baseline; the subsequent stroke
  // traces the full perimeter including the baseline. The baseline
  // stroke is intentional — it frames the ribbon visually. If under
  // the CRT theme this reads as cluttered with the glow filter, split
  // the fill and stroke into two passes (fill first with closePath,
  // then re-walk only the top of the ribbon for the stroke).
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill({ color: theme.fg, alpha: 0.5 });
  g.stroke({ color: theme.fg, width: theme.lineWidth });
}
```

- [ ] **Step 2: Verify the spectrum renders correctly**

In the browser console (capture active): `state.view = "spectrum"; applyState();`

**Expected:**
- Filled ribbon along the bottom of the canvas, hugging the audio's spectral envelope.
- Bass content (low frequencies) appears on the **left**; treble on the **right**. (If reversed, the log mapping is inverted — recheck `freqToX`.)
- Distinct beats / kick drums pulse the leftmost portion of the ribbon.
- With the neon theme, the bloom filter halos the top edge of the ribbon.

---

## Task 10: drawLissajous

**Files:**
- Modify: `main.js` (replace `drawLissajous`)

- [ ] **Step 1: Implement the Lissajous draw**

Replace the `drawLissajous` placeholder:

```js
function drawLissajous(g, analyserL, analyserR, theme, w, h) {
  if (!analyserL || !analyserR) return;
  const n = analyserL.fftSize;
  const bufL = new Float32Array(n);
  const bufR = new Float32Array(n);
  analyserL.getFloatTimeDomainData(bufL);
  analyserR.getFloatTimeDomainData(bufR);

  const radius = Math.min(w, h) * 0.4;
  const cx = w / 2;
  const cy = h / 2;
  const inv = 1 / Math.SQRT2;

  for (let i = 0; i < n; i++) {
    const xr = (bufL[i] - bufR[i]) * radius * inv;
    const yr = (bufL[i] + bufR[i]) * radius * inv;
    const x = cx + xr;
    const y = cy - yr;   // canvas y increases downward; flip so positive amplitude rises
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke({ color: theme.fg, width: theme.lineWidth });
}
```

- [ ] **Step 2: Verify the Lissajous renders against a stereo source**

In the console (capture active, sharing a stereo source like a music video): `state.view = "lissajous"; applyState();`

**Expected:**
- A continuous curve roughly centred on the canvas, oscillating around a vertical orientation. For a strongly mono source (most podcasts, dialogue), it collapses to a near-vertical line. For a stereo music source, it opens into looping curves of varying width.
- The curve fades naturally with CRT theme; redraws cleanly with neon/mono.

If `state.channels === 1` is reported at capture-start (some screen-share configurations report mono), the Lissajous view will receive bufR samples identical to bufL (the Web Audio splitter feeds the same data to both analysers when source is mono), so the rendering will be a perfect vertical line — that is correct behaviour.

---

## Task 11: View dropdown + hotkeys

**Files:**
- Modify: `main.js` (wire `#view` dropdown and `keydown` handler inside `init()`)

- [ ] **Step 1: Wire the view dropdown and hotkeys**

At the end of `init()`, append:

```js
  document.getElementById("view").addEventListener("change", (e) => {
    state.view = e.target.value;
    applyState();
  });

  document.addEventListener("keydown", (e) => {
    if (!state.running && e.key !== "Escape") return;
    if (e.key === "1") { state.view = "waveform";  applyState(); }
    if (e.key === "2") { state.view = "spectrum";  applyState(); }
    if (e.key === "3") {
      if (state.channels === 1) return;  // honour the mono grey-out
      state.view = "lissajous"; applyState();
    }
    if (e.key === "Escape") stopCapture();
  });
```

- [ ] **Step 2: Verify view switching via dropdown and hotkeys**

Reload, start capture, share a music tab.

**Expected:**
- Dropdown change cycles waveform → spectrum → lissajous, each rendering correctly.
- Pressing `1`, `2`, `3` switches identically and the dropdown's displayed value updates to match.
- Pressing `3` when `state.channels === 1` does nothing and the dropdown shows the Lissajous option greyed.

---

## Task 12: Theme dropdown + cycle hotkey

**Files:**
- Modify: `main.js` (wire `#theme` dropdown and `T` hotkey inside `init()`)

- [ ] **Step 1: Wire the theme dropdown and the T hotkey**

Append inside `init()` (after the view-handler block):

```js
  document.getElementById("theme").addEventListener("change", (e) => {
    state.theme = e.target.value;
    applyState();
  });
```

Inside the keydown handler added in Task 11, locate this exact line:

```js
    if (e.key === "Escape") stopCapture();
```

Immediately **before** that line, insert:

```js
    if (e.key === "t" || e.key === "T") {
      const order = ["crt", "neon", "mono"];
      const idx = order.indexOf(state.theme);
      state.theme = order[(idx + 1) % order.length];
      applyState();
    }
```

After the edit the keydown handler should contain blocks for `1`,
`2`, `3`, `T` (new), and `Escape` in that order.

- [ ] **Step 2: Verify theme switching**

Reload, start capture, cycle themes via the dropdown and via `T`.

**Expected:**
- CRT: green trace with subtle phosphor decay, scanline overlay (CRTFilter), slight bloom on edges.
- Neon: cyan trace with bright bloom halo, no decay.
- Mono: crisp white trace, no decay, no glow.
- The dropdown's displayed value updates when `T` is pressed.
- The `--fg` CSS variable updates so the controls panel's heading colour (if any styled with `var(--fg)`) tracks the theme.

If CRT shows no scanlines, the `CRTFilter` import is missing — verify `PIXI.filters.CRTFilter` is defined in the console.

---

## Task 13: Sensitivity + FFT + smoothing controls

**Files:**
- Modify: `main.js` (wire `#gain`, `#fft`, `#smooth` inside `init()`)

- [ ] **Step 1: Wire the three sliders/select**

Append inside `init()`:

```js
  document.getElementById("gain").addEventListener("input", (e) => {
    state.sensitivity = parseFloat(e.target.value);
    applyState();
  });
  document.getElementById("fft").addEventListener("change", (e) => {
    state.fftSize = parseInt(e.target.value, 10);
    applyState();
  });
  document.getElementById("smooth").addEventListener("input", (e) => {
    state.smoothing = parseFloat(e.target.value);
    applyState();
  });
```

- [ ] **Step 2: Verify the controls take effect**

Reload, start capture, play a quiet section of music.

**Expected:**
- Dragging the sensitivity slider from 1 to 4 visibly amplifies the trace's vertical excursion in the waveform view and brightens the spectrum ribbon.
- Selecting FFT size 256 makes the spectrum coarse (few wide bins) and the waveform low-resolution; selecting 32768 makes the spectrum dense and the waveform smoother.
- Dragging the smoothing slider toward 0.95 visibly slows the spectrum's response; toward 0 makes it twitchy.

Verify in the console: after a slider change, `state.sensitivity` / `state.fftSize` / `state.smoothing` reflect the slider position, and `audio.gain.gain.value` / `audio.analyserL.fftSize` / `audio.analyserL.smoothingTimeConstant` match.

---

## Task 14: Error handling (Chromium check, silent-input timeout, browser-bar stop)

**Files:**
- Modify: `main.js` (add Chromium feature-detect on init; add silent-input timer inside `frame`; rely on `track.onended` from Task 6 for browser-bar stop)

- [ ] **Step 1: Add the Chromium feature-detect on load**

At the very start of `init()` (immediately inside the `try {` block,
before `pixi.app = new PIXI.Application()`), insert:

```js
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("This visualiser needs Chrome, Edge, or Brave. Firefox cannot capture tab audio.");
      document.getElementById("capture").disabled = true;
      return;   // Skip Pixi init entirely — there's nothing to visualise.
    }
```

`setStatus` is defined in Task 1's scaffolding, so this call is safe
even if it runs before any of the audio code. Returning from inside
the `try` block skips the rest of `init()` cleanly (the catch only
fires on a thrown error, not on early return).

- [ ] **Step 2: Add silent-input detection inside the render loop**

In `main.js`, just above the `frame()` function, add a small accumulator:

```js
let silentMs = 0;
let lastFrameTime = 0;
const SILENT_THRESHOLD = 0.005;
const SILENT_TIMEOUT_MS = 3000;
```

Inside `frame()`, near the top (just after `if (!state.running) return;`), add:

```js
  const now = performance.now();
  const dt = lastFrameTime === 0 ? 0 : now - lastFrameTime;
  lastFrameTime = now;
  if (audio.analyserL) {
    const probe = new Float32Array(audio.analyserL.fftSize);
    audio.analyserL.getFloatTimeDomainData(probe);
    let peak = 0;
    for (let i = 0; i < probe.length; i++) {
      const v = Math.abs(probe[i]);
      if (v > peak) peak = v;
    }
    if (peak < SILENT_THRESHOLD) silentMs += dt;
    else silentMs = 0;
    if (silentMs > SILENT_TIMEOUT_MS) {
      setStatus("No signal detected. Is the source playing?");
    } else {
      const statusEl = document.getElementById("status");
      if (statusEl && statusEl.textContent === "No signal detected. Is the source playing?") {
        setStatus("");
      }
    }
  }
```

(The `track.onended` handler in Task 6 already covers the "user stopped sharing from the browser bar" case — no extra work here.)

- [ ] **Step 3: Verify each error path**

1. **Chromium detection.** Open `http://localhost:8000` in Firefox (if available). **Expected:** "Start capture" button disabled, status shows the Firefox message.
2. **Permission denied.** In Chromium, click Start, click Cancel in the share-picker. **Expected:** Status shows the cancellation message (from Task 6); re-clicking Start works.
3. **No audio.** Click Start, share a window or entire screen (Chromium does not include audio for those). **Expected:** Status shows the "No audio in the shared stream" message.
4. **Silent input.** Start capture against a paused source. After 3 seconds, **expected:** status shows "No signal detected. Is the source playing?". Resume playback; status clears within a frame.
5. **Browser-bar stop.** Click Start, then click "Stop sharing" in Chromium's screen-share notification bar (not Scope's Stop button). **Expected:** Scope returns to the start screen; status shows "Sharing ended."

---

## Task 15: Controls auto-hide, fullscreen toggle, Escape behaviour

**Files:**
- Modify: `style.css` (auto-hide CSS transition)
- Modify: `main.js` (mouse-near-top tracking + `F` hotkey)

- [ ] **Step 1: Add the auto-hide CSS rules**

Append to `style.css`:

```css
#controls {
  transition: opacity 200ms ease;
  opacity: 1;
}
#controls.idle {
  opacity: 0.15;
}
#controls:hover {
  opacity: 1;
}
```

- [ ] **Step 2: Track mouse-near-top and idle-timeout in main.js**

Append inside `init()` (after the keydown handler):

```js
  let idleTimer = null;
  const controlsEl = document.getElementById("controls");
  const markActive = () => {
    controlsEl.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controlsEl.classList.add("idle"), 3000);
  };
  document.addEventListener("mousemove", (e) => {
    if (e.clientY < 100) markActive();
  });
  // A second keydown listener is intentional: markActive must fire on
  // ALL keypresses (to keep the panel visible during interaction),
  // including keys the main handler ignores (`!state.running` early
  // return, unmapped keys, etc.). Do not consolidate this into the
  // main keydown handler — that would skip the idle-reset for keys
  // that early-return.
  document.addEventListener("keydown", markActive);
  // Start in the active state so the panel is visible the moment capture begins.
  markActive();
```

- [ ] **Step 3: Add the F hotkey for fullscreen**

Inside the keydown handler (the one with `1`/`2`/`3`/`T`/`Escape`),
locate this exact line:

```js
    if (e.key === "Escape") stopCapture();
```

Immediately **before** that line (and after the `T` block from Task
12), insert:

```js
    if (e.key === "f" || e.key === "F") {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
```

After the edit the keydown handler contains blocks for `1`, `2`, `3`,
`T`, `F` (new), and `Escape` in that order.

- [ ] **Step 4: Verify auto-hide, fullscreen, and Escape**

Reload, start capture.

**Expected:**
- Move the mouse away from the top edge and wait 3 seconds → controls panel fades to ~15% opacity.
- Move the mouse back near the top, OR hover over the panel, OR press any key → panel returns to full opacity.
- Press `F` → browser fullscreen toggles; press `F` again → exits fullscreen.
- Press `Escape` → capture stops cleanly (start screen returns).
- Press `Escape` again on the start screen → no-op (idempotent `stopCapture`).

---

## Task 16: README and manual QA checklist

**Files:**
- Create: `README.md`
- Create: `docs/manual-qa.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Scope

A music oscilloscope. Captures audio from a Chromium browser tab and
renders three live views: time-domain waveform, frequency spectrum, and
stereo Lissajous.

## Run it

1. Clone the repo.
2. From the project root: `python3 -m http.server 8000`
3. Open `http://localhost:8000` in Chrome, Edge, or Brave.
4. Open Spotify Web Player or YouTube in another tab and play something.
5. In Scope, click **Start capture** → share that tab → tick **Share tab audio**.

## Browser requirements

- Chromium-based browsers only (Chrome, Edge, Brave). Firefox and Safari
  do not support audio capture via `getDisplayMedia`.
- `localhost` or `https://` origin (the page does not work over `file://`).
- WebGL 2 (any modern Chromium).

## Hotkeys

| Key | Action |
|---|---|
| `1` / `2` / `3` | Switch to waveform / spectrum / Lissajous |
| `T` | Cycle theme (CRT → neon → mono → CRT) |
| `F` | Toggle browser fullscreen |
| `Esc` | Stop capture |

## Test

```bash
node --test tests/helpers.test.js
```

Two pure helper functions are unit-tested; everything else is verified
via the manual QA checklist at `docs/manual-qa.md`.

## Design

See `docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md`.
```

- [ ] **Step 2: Create `docs/manual-qa.md`**

```markdown
# Scope — Manual QA Checklist

Run this checklist before declaring a release ready. Each step assumes
the previous one succeeded.

## Setup

- [ ] Serve the page: `python3 -m http.server 8000` from the project root.
- [ ] Open `http://localhost:8000` in a Chromium browser.
- [ ] Open Spotify Web Player or a YouTube video in another tab and start
      audible playback.

## Capture and Views

- [ ] Click **Start capture** → share the source tab with **Share tab
      audio** ticked.
- [ ] Waveform view renders a stable, centred trace.
- [ ] Switch to spectrum via dropdown → ribbon along the bottom; bass on
      the left, treble on the right; beats pulse the low end.
- [ ] Switch to Lissajous via dropdown → curve oscillating around a
      vertical orientation; opens into loops for stereo content.
- [ ] Switch views via hotkeys `1` / `2` / `3` → same result as dropdown;
      dropdown value updates to match.

## Themes

- [ ] CRT theme: green trace, phosphor decay (visible ghosting from
      previous frames), scanline overlay, slight bloom.
- [ ] Neon theme: cyan trace, bright bloom halo, no decay.
- [ ] Mono theme: crisp white trace, no decay, no glow.
- [ ] Cycle themes via `T` → dropdown value updates to match.

## Controls

- [ ] Sensitivity slider at 4.0 on a quiet source → trace excursion
      visibly amplified, no clipping at the canvas edges.
- [ ] FFT size at 256 → spectrum coarse, waveform low-resolution.
- [ ] FFT size at 32768 → spectrum dense, waveform smoother.
- [ ] Smoothing at 0.95 → spectrum responds slowly.
- [ ] Smoothing at 0 → spectrum twitchy.

## UI behaviour

- [ ] Move mouse away from top, wait 3 s → controls fade to ~15% opacity.
- [ ] Move mouse near top OR hover panel OR press any key → controls
      return to full opacity.
- [ ] Press `F` → browser fullscreen toggles.
- [ ] Resize the browser window mid-capture → canvas re-fits; no trail
      artifacts beyond a single frame of transient.

## Error paths

- [ ] Open in Firefox → "needs Chromium" message; Start button disabled.
- [ ] Cancel the share-picker → status shows "Capture cancelled".
- [ ] Share a window or screen (not a tab) → status shows "No audio in
      the shared stream".
- [ ] Pause the source for >3 s → status shows "No signal detected"; on
      resume, status clears.
- [ ] Click "Stop sharing" in Chromium's screen-share bar → Scope
      returns to start screen; status shows "Sharing ended".
- [ ] Press `Esc` mid-capture → returns to start screen; can restart cleanly.
- [ ] Press `Esc` again on start screen → no-op (no error in console).

## Mono source

- [ ] Share a tab playing a known-mono source (a podcast, a phone-call
      audio track) → `audioTrack.getSettings().channelCount` in the
      console reads `1`; the Lissajous option in the dropdown is greyed
      with tooltip "Source is mono — no stereo to plot"; pressing `3`
      does nothing.
```

- [ ] **Step 3: Verify the docs render correctly**

Open `README.md` and `docs/manual-qa.md` in a Markdown previewer (any editor that renders Markdown — VS Code, GitHub's web preview, etc.). **Expected:** Both files render cleanly; tables align; code blocks have language tags; no broken Markdown syntax.

---

## Task 17: Code review

- [ ] **Step 1: Dispatch the code-reviewer agent**

Dispatch the `superpowers:code-reviewer` agent (or `feature-dev:code-reviewer` if `superpowers` is unavailable in the active session) with this prompt:

```
Review the implementation of the Scope music oscilloscope against the plan at
docs/plans/2026-05-16-music-oscilloscope.md and the spec at
docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md.

Verify:
1. All tasks in the plan were completed; each acceptance criterion was
   manually verified by the implementer (look for evidence in the code:
   wired event handlers, populated themes, the trail-fade render call).
2. The PixiJS v8 API forms are correct: `app.canvas` not `app.view`;
   `Graphics.stroke({color, width})` not `lineStyle()`;
   `renderer.render({container, target, clear})` not the v7 three-arg form;
   `BloomFilter({strength: {x, y}})` not `{strength: <number>}`;
   `new GlowFilter(...)`, `new CRTFilter(...)`, `new BloomFilter(...)` —
   all constructors use `new`.
3. The audio pipeline is built correctly: `getDisplayMedia({video: true,
   audio: true})`, video tracks immediately stopped via `videoTrack.stop()`,
   `MediaStreamSource → Gain → ChannelSplitter → [AnalyserL, AnalyserR]`,
   nothing connected to `ctx.destination`.
4. `stopCapture` is idempotent (safe to call when already stopped).
5. The two pure helper unit tests pass (`node --test tests/helpers.test.js`).
6. No mocks of our own code anywhere; only browser-API calls are exercised
   in tests, and only via `node --test` for the pure helpers.
7. No introductions of `file://`-related code paths; the README and
   docs/manual-qa.md only recommend `localhost`.
8. No em dashes in prose anywhere (README, manual-qa.md, comments in
   main.js). Hyphens and en dashes are fine.
9. No commits-per-task; the implementer should have made at most ONE
   commit at the end (or none, leaving the commit to the user).

Report critical/important/nice-to-have findings with file:line citations.
```

The code-reviewer's full report should be saved to
`docs/plans/reviews/2026-05-16-music-oscilloscope-code-review.md`.
Address every finding (regardless of severity) by either fixing the code
or documenting an explicit rejection with evidence.

---

## Task 18: Final commit

This is the single commit for the whole feature (per the user's
"one commit per feature" rule). Run only after Task 17's review has
been addressed.

- [ ] **Step 1: Confirm the working tree state**

```bash
git status
```

**Expected:** Untracked / modified files limited to:
- `index.html`
- `style.css`
- `main.js`
- `tests/helpers.test.js`
- `README.md`
- `docs/manual-qa.md`
- `docs/plans/reviews/2026-05-16-music-oscilloscope-code-review.md` (if Task 17 saved one)

Nothing else should be modified.

- [ ] **Step 2: Stage by pathspec and commit**

Before running the command below, replace `<CLAUDE-MODEL-NAME-AT-COMMIT-TIME>`
in the commit message with the actual Claude model name in use (e.g.
`Sonnet 4.6`, `Opus 4.7`, `Haiku 4.5`). The placeholder must not survive
into the commit message.

```bash
git add \
  index.html \
  style.css \
  main.js \
  tests/helpers.test.js \
  README.md \
  docs/manual-qa.md \
  docs/plans/reviews/2026-05-16-music-oscilloscope-code-review.md   # only if it exists

git commit -m "$(cat <<'EOF'
feat: implement Scope music oscilloscope

Single-page web visualiser. Captures audio from a Chromium tab via
getDisplayMedia({audio: true}); renders three views (time-domain
waveform, frequency spectrum, stereo Lissajous) with three themes
(CRT, neon, mono) using PixiJS v8 + pixi-filters v6.

Implements the design in
docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md per the
plan in docs/plans/2026-05-16-music-oscilloscope.md. Two pure helper
functions are unit-tested via node --test; everything else verified
against the manual QA checklist in docs/manual-qa.md.

Co-Authored-By: Claude <CLAUDE-MODEL-NAME-AT-COMMIT-TIME> <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify the commit landed**

```bash
git log -1 --stat
git status
```

**Expected:**
- `git log -1 --stat` shows the new commit with all the files listed.
- `git status` shows `nothing to commit, working tree clean`.

Do **not** push; pushing is a separate per-invocation ask from the user.

---

## Resolution of plan-reviewer findings

The plan-reviewer pass on this plan returned **2 CRITICAL / 4 IMPORTANT
/ 5 NICE-TO-HAVE / 1 Unverified / 1 Question for Author** (13 findings).
Every finding is addressed with a disposition and evidence below. The
full review report is at
`docs/plans/reviews/2026-05-16-music-oscilloscope.md`.

### CRITICAL

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| C1 | `renderer.render({container, target, clear})` single-object form uses `target` as the source container, not destination texture; trail would render to screen with no error | **Fixed in Task 7 Step 1.** | Plan now uses the two-argument form `renderer.render(source, { renderTexture: destination, clear: false })`, with a long explanatory note about why and a verification microstep using `pixi.app.renderer.extract.canvas(pixi.trail)` to confirm the trail texture is actually receiving content. |
| C2 | `async init()` without await means failures become unhandled promise rejections, silently breaking the page | **Fixed in Task 5 Step 1.** | The `init()` body is wrapped in a try/catch that surfaces failures via `setStatus()` and rethrows for DevTools visibility. `setStatus` was moved to Task 1 scaffolding so it's available even if Pixi init throws on the very first turn. |

### IMPORTANT

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| I1 | `pixi.fade` / `pixi.current` not on stage contradicts spec scene graph | **Fixed in Task 5 Step 1.** | Added a multi-line comment explaining the deliberate deviation from the spec's illustrative scene graph, and warning future implementers not to "fix" it by adding `current` to stage (which would double-draw). |
| I2 | Third `findZeroCrossing` test name was misleading | **Fixed in Task 3 Step 1.** | Renamed to "findZeroCrossing returns the negative-sample index when buf[i+1] is exactly 0 (zero-crossing to silence)". |
| I3 | Task 14's `setStatus` call from inside `init()` depended on Task 6 ordering | **Fixed in Tasks 1 and 14.** | `setStatus` moved to Task 1 scaffolding (defined before any other code). Task 14 step 1 references it inside the try block and notes that scaffolding has already defined it. |
| I4 | Tasks 12 and 15 edit anchors ("just before the Escape line") were ambiguous for subagent execution | **Fixed in Tasks 12 and 15.** | Both edits now quote the exact anchor line `if (e.key === "Escape") stopCapture();` and state "Immediately before that line, insert"; the post-edit handler structure is also stated. |

### NICE-TO-HAVE

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| N1 | Task 2's expected-failure description included an unreachable "Cannot find module" branch | **Fixed in Task 2 Step 2.** | Description simplified to the single reachable failure: `TypeError: freqToX is not a function`, with explanation. |
| N2 | `stopCapture` should explicitly note rAF tick drains harmlessly | **Fixed in Task 6 Step 1.** | Inline comment added to `stopCapture` explaining why no `cancelAnimationFrame` is needed. |
| N3 | Spectrum ribbon stroke traces baseline edges — could look cluttered with CRT glow | **Acknowledged with explicit comment in Task 9 Step 1.** | Added a comment stating the baseline stroke is intentional framing, and documenting the split-pass workaround if a future implementer finds it cluttered under glow. Not changed — the reviewer flagged it as cosmetic with "no fix required unless the implementer notices". |
| N4 | Two keydown listeners in Task 15 could be misread as redundant | **Fixed in Task 15 Step 2.** | Comment added explaining why the second listener is intentional (markActive must fire on keys the main handler ignores). |
| N5 | Commit message hardcoded "Opus 4.7" — wrong if implementer is running another model | **Fixed in Task 18 Step 2.** | Co-author line now uses the placeholder `<CLAUDE-MODEL-NAME-AT-COMMIT-TIME>` and Task 18 step 2 includes an explicit instruction to replace it with the actual model name before running the commit. |

### Unverified Claim

| ID | Claim | Disposition | Evidence |
|---|---|---|---|
| U1 | `PIXI.filters.GlowFilter` etc. are exposed by the pixi-filters@6 browser bundle | **Addressed in Task 5 Step 1.** | Added a `VERIFY BEFORE WRITING THIS BLOCK` instruction telling the implementer to run `Object.keys(PIXI.filters)` in DevTools and confirm the classes are present; documented the fallback if they're at `window.<FilterName>` directly. |

### Question for Author

| ID | Question | Disposition | Evidence |
|---|---|---|---|
| Q1 | Plan uses `window.resize` listener; spec says `ResizeObserver` | **Addressed in Task 5 Step 1.** | Inline comment explains the deviation: for a fixed-viewport (`position: fixed; inset: 0`) canvas the two are functionally equivalent; `ResizeObserver` would be the right choice if the canvas were sized to a non-viewport container element. |

