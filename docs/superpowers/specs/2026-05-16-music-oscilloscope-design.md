# Scope — Music Oscilloscope Design

**Status:** Brainstormed; plan-reviewer pass complete (2 CRITICAL,
4 IMPORTANT, 3 NICE-TO-HAVE, 2 Unverified, 2 Questions — all
addressed in §14); awaiting user review of this spec.
**Date:** 2026-05-16
**Project root:** `~/my_work/oscilloscope/`

## 1. Summary

Scope is a single-page web visualiser that renders music as a real-time
oscilloscope. The user shares a Spotify Web Player or YouTube tab via the
Chromium `getDisplayMedia({audio: true})` API; Scope captures the tab's
audio stream and renders it through one of three views: time-domain
waveform, frequency spectrum, or stereo Lissajous. Three visual themes
(retro CRT phosphor, neon glow, minimal mono) are selectable from a
dropdown. Rendering uses PixiJS in 2D mode with `pixi-filters` for
post-processing (Glow, Bloom, CRT). The whole app is a flat
`index.html` + `main.js` + `style.css`, no build step.

## 2. Goals and non-goals

### Goals
- Visualise audio from a streaming-service tab (Spotify, YouTube) without
  needing to download files or install an OS-level audio loopback driver.
- Three distinct, useful views: waveform (per-sample), spectrum (FFT),
  Lissajous (stereo vectorscope).
- Three switchable themes with meaningfully different visual character.
- Zero install or build for the developer; opening `index.html` works.
- Smooth 60 fps rendering at `fftSize` up to 32768.

### Non-goals
- Mobile support. Mobile Chromium does not implement audio capture in
  `getDisplayMedia`; designing for mobile would design for an audience
  that cannot use the feature.
- Firefox or Safari support. Neither implements audio capture in
  `getDisplayMedia` as of 2026-05-16. Scope detects and shows an
  explanatory message.
- Audio output. Scope never connects its audio graph to
  `AudioContext.destination`; the user already hears the audio from the
  source tab and re-outputting would cause feedback.
- File upload, microphone input, streaming URL input. Tab-share is the
  only input path.
- Settings persistence across reloads. A future `localStorage` line is
  trivial but not in scope.
- Visual regression tests. Manual QA checklist only.

## 3. Architecture overview

Flat single-file project, three top-level files plus a `docs/` tree:

```
~/my_work/oscilloscope/
├── index.html          ← DOM shell, controls panel, two CDN <script> tags
├── main.js             ← entire app: state, audio graph, render loop, draw fns, events
├── style.css           ← theme CSS variables, controls panel layout, fade behaviour
├── docs/
│   ├── superpowers/specs/2026-05-16-music-oscilloscope-design.md   (this file)
│   ├── plans/          (implementation plan goes here next)
│   └── manual-qa.md    (manual test checklist)
└── README.md
```

Dependencies loaded from CDN, pinned to majors:
- `pixi.js@8` — WebGL-backed 2D scene graph
- `pixi-filters@6` — GlowFilter, BloomFilter, CRTFilter

CDN script tags in `index.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pixi-filters@6/dist/browser/pixi-filters.min.js"></script>
```

`pixi-filters@6` ships a single combined browser bundle at
`dist/browser/pixi-filters.min.js` which exposes all filter classes
(`GlowFilter`, `BloomFilter`, `CRTFilter`, etc.) on the `PIXI.filters`
global. The per-filter sub-path imports (`pixi-filters/bloom` etc.)
are for tree-shaking bundlers and are not needed in script-tag mode.
The implementer must verify both URLs resolve to the expected versions
before writing the first draw call; jsdelivr's `@8` and `@6` tags
follow semver and may roll forward to new minors/patches but never
across majors.

No `package.json`, no `node_modules`, no bundler.

## 4. Audio pipeline

On user click of **Start capture**:

```
navigator.mediaDevices.getDisplayMedia({video: true, audio: true})
        │       (Chrome requires video:true to allow audio:true)
        ▼
MediaStream         ← video track stopped immediately, never displayed
        │
        ▼
new AudioContext()  ← resumed if suspended (autoplay policy)
        │
        ▼
ctx.createMediaStreamSource(stream)
        │
        ▼
GainNode            ← driven by Sensitivity slider, range 0.1–4.0
        │
        ▼
ChannelSplitterNode (2 outputs)
        ├──► AnalyserNode (left channel)
        └──► AnalyserNode (right channel)
                            ↑
              fftSize and smoothingTimeConstant shared,
              driven by Advanced controls.
```

The graph is built once at capture start and never torn down on view or
theme switches. The analysers' internal smoothing state stays continuous.

**Stopping the video track is mandatory.** Immediately after capture
starts, call:

```js
stream.getVideoTracks().forEach(track => track.stop());
```

Chrome's `getDisplayMedia` API requires `video: true` to allow `audio:
true`, so a video track is always returned. We never use it, and leaving
it live keeps Chromium's screen-sharing indicator (red border, top-bar
badge) active — confusing because nothing visual is being shared. The
visualiser's own canvas is rendered locally, not through the captured
stream. Calling `.stop()` on each video track releases the indicator
while leaving the audio track running.

We also **do not** connect anything to `ctx.destination`. The user is
already hearing the audio from the source tab; re-outputting through
Web Audio would cause feedback or doubled audio.

Per frame, the active view reads:
- Waveform: `analyserL.getFloatTimeDomainData(bufL)`
- Spectrum: `analyserL.getFloatFrequencyData(bufFreq)`
- Lissajous: both `getFloatTimeDomainData` reads

Float (not Byte) arrays — better fidelity, same cost.

**Channel detection.** After capture starts, read
`audioTrack.getSettings().channelCount` on the raw audio track (before the
splitter). If the value is `1`, the Lissajous tab is greyed with a
tooltip; waveform and spectrum still work.

**Caveat — reliability of `channelCount` for tab-share streams.** For
microphone inputs `getSettings().channelCount` is reliable. For
`getDisplayMedia` audio tracks, Chromium's implementation may report
`channelCount: 1` even for a stereo source if the OS audio routing or
WASAPI/PulseAudio path mixed the signal down before the browser
received it. There is no MDN-documented guarantee that the value
reflects the original tab's channel count. Treat `channelCount === 1`
as authoritative (grey the tab); for `channelCount >= 2`, render
Lissajous but expect that a near-mono source will produce a near-vertical
line — which is the correct rendering for a mono signal under the
rotated convention (§6c), so no further handling is needed.

## 5. Render pipeline (PixiJS)

Single `PIXI.Application` filling the viewport, initialised with
`background: 0x000000` and `antialias: true`.

State of the world:

```js
const state = {
  view: "waveform",    // "waveform" | "spectrum" | "lissajous"
  theme: "crt",        // "crt" | "neon" | "mono"
  sensitivity: 1.0,    // mirrors GainNode.gain
  fftSize: 2048,       // mirrors both AnalyserNodes
  smoothing: 0.6,      // mirrors both AnalyserNodes
  running: false,
  channels: 2,         // detected at capture start
};

const themes = {
  crt:  { fg: 0x33ff66, fgCss: "#33ff66", decayAlpha: 0.12, lineWidth: 1.5,
          filters: [new GlowFilter({distance:8, outerStrength:1.5}),
                    new CRTFilter({curvature:1, lineWidth:1, vignetting:0.3})] },
  neon: { fg: 0x00e5ff, fgCss: "#00e5ff", decayAlpha: 1.0,  lineWidth: 2.0,
          filters: [new BloomFilter({strength: {x: 8, y: 8}})] },
  mono: { fg: 0xffffff, fgCss: "#ffffff", decayAlpha: 1.0,  lineWidth: 1.0, filters: [] },
};
```

Each theme carries both `fg` (Pixi number form, used by `Graphics.stroke()`)
and `fgCss` (CSS string form, used to update the `--fg` custom property).
```

### Scene graph

```
app.stage
├── trailSprite     ← PIXI.Sprite of a RenderTexture (the persistence layer)
└── current         ← PIXI.Graphics (this frame's fresh trace)
```

### Per-frame loop

1. Read `theme.decayAlpha`. If `< 1.0`, render a translucent black
   rectangle into `trail` (phosphor decay). If `= 1.0`, clear `trail`.
2. Clear `current`.
3. Dispatch on `state.view` → `drawWaveform`, `drawSpectrum`, or
   `drawLissajous` (see Section 6).
4. Render `current` into `trail` using PixiJS v8's
   `renderer.render(options)` form with the off-screen RenderTexture as
   the destination:

   ```js
   app.renderer.render({ container: current, target: trail, clear: false });
   ```

   `target` (the v8 field name for the destination RenderTexture; older
   examples and the v7 three-argument form `render(container, renderTexture,
   clear)` are removed in v8) must be the RenderTexture, not the screen.
   `clear: false` is essential — clearing here would erase the trail.
   The implementer must verify the exact field name (`target` vs
   `renderTexture`) against the installed PixiJS version's type
   definitions before the first run; the v8 API has churned across
   minor versions. If `target` is rejected, fall back to `renderTexture`.
   The trail texture now contains old strokes (faded by step 1) plus
   the new trace.
5. Apply `theme.filters` to `trailSprite`. Filters are set once on theme
   change; Pixi re-applies them automatically each frame.
6. Pixi presents the frame.

This pattern handles both decay themes (CRT) and clean themes (neon, mono)
with one code path; `decayAlpha` is the only switch.

### Resize handling

`ResizeObserver` on `document.body`: re-create `trail` `RenderTexture` at
the new dimensions. Pixi's `resizeTo: window` takes care of the canvas.

### HiDPI

PixiJS handles `devicePixelRatio` automatically via its `resolution`
property; we set `resolution: window.devicePixelRatio` at init.

## 6. The three views

### 6a. Waveform (time-domain)

- Read: `analyserL.getFloatTimeDomainData(buf)` — `fftSize` samples in `[-1, +1]`.
- Trigger: find first index `i` where `buf[i] < 0 && buf[i+1] >= 0`
  (zero-crossing going positive). Draw from `i` onward to keep the trace
  stable instead of scrolling.
- Plot: a polyline where point `i` has
  `x = i / (buf.length - 1) * width` and
  `y = height/2 - buf[i] * (height/2) * 0.9`.
  The `0.9` keeps a full-amplitude signal from touching the canvas edges.
- Stroke: PixiJS v8 requires an explicit `stroke()` call after the
  `moveTo`/`lineTo` path to actually render the line (the v7 `lineStyle`
  + auto-stroke pattern is gone). The call form is:

  ```js
  current.stroke({ color: theme.fg, width: theme.lineWidth });
  ```

  The same terminating `stroke({color, width})` call pattern applies to
  the spectrum ribbon (§6b) and the Lissajous polyline (§6c).

### 6b. Spectrum (frequency-domain)

- Read: `analyserL.getFloatFrequencyData(buf)` — `fftSize/2` bins in dB,
  typical range `[-100, -30]`.
- Normalise: `mag = clamp((buf[i] - (-100)) / 70, 0, 1)`.
- Frequency mapping: bin `i` represents `freq = i * sampleRate / fftSize`.
  Read `sampleRate` from `ctx.sampleRate` at capture-start; **do not
  hardcode**. Chromium typically delivers tab-share streams at 44100 Hz
  or 48000 Hz depending on the OS audio subsystem, and hardcoding the
  wrong value would miscalibrate the frequency axis by ~9%.
- **X axis is logarithmic** (human hearing is log-frequency): `x =
  (log(freq) - log(20)) / (log(20000) - log(20)) * width`. Bins below
  20 Hz and above 20 kHz are dropped.
- Render as a filled ribbon (filled area under a smoothed curve), not
  discrete bars. Ribbon reads better with the bloom filter.
- Colour: `theme.fg`. Bloom filter does the rest.

### 6c. Lissajous (stereo vectorscope)

- Read both: `analyserL.getFloatTimeDomainData(bufL)` and
  `analyserR.getFloatTimeDomainData(bufR)`.
- Rotated convention (45° rotation so a mono signal L = R renders as
  a vertical line, matching traditional audio vectorscopes):

  ```
  x_rot   = (bufL[i] - bufR[i]) * radius / sqrt(2)
  y_rot   = (bufL[i] + bufR[i]) * radius / sqrt(2)
  x_canvas = width/2 + x_rot
  y_canvas = height/2 - y_rot           // canvas y increases downward; flip
  ```

  where `radius = min(width, height) * 0.4`. The explicit
  `height/2 - y_rot` flips the rotated y-axis so positive amplitudes
  rise upward on screen, matching the hardware-vectorscope visual
  convention rather than the canvas coordinate convention.
- Connect successive samples with thin lines (not points) for the
  continuous curve look.
- Mono guard: if `state.channels === 1`, the Lissajous tab is greyed
  with tooltip "Source is mono — no stereo to plot." User can still
  switch to it but it's marked disabled.

## 7. UI shell

### DOM

```html
<body>
  <canvas id="stage"></canvas>          <!-- PixiJS attaches here -->
  <div id="controls">
    <button id="capture">Start capture</button>
    <select id="view">      <!-- waveform / spectrum / lissajous --></select>
    <select id="theme">     <!-- crt / neon / mono --></select>
    <label>Sensitivity <input type="range" id="gain" min="0.1" max="4" step="0.1"></label>
    <details><summary>Advanced</summary>
      <label>FFT size <select id="fft">      <!-- 256 ... 32768 --></select></label>
      <label>Smoothing <input type="range" id="smooth" min="0" max="0.95" step="0.05"></label>
    </details>
  </div>
  <div id="status"></div>
</body>
```

### Behaviour

- **First load:** big centred "Start capture" button; controls panel hidden.
  Status text below: "Click Start, then share the Spotify or YouTube tab
  with audio enabled."
- **After capture starts:** controls panel pinned top-left. Stays visible
  while mouse is within 100 px of the top edge OR within 3 seconds of last
  interaction. Fades to 0.15 opacity otherwise.
- **Hotkeys:**
  - `1`/`2`/`3` — switch view
  - `T` — cycle theme
  - `F` — toggle browser fullscreen
  - `Esc` — stop capture, return to first-load state

### Theme application

CSS custom properties on `:root`:

```css
:root { --bg: #000; --fg: #33ff66; --panel-bg: rgba(0,0,0,0.5); }
```

`applyState()` calls `document.documentElement.style.setProperty('--fg', themes[state.theme].fgCss)`.
Pixi filters and CSS variables update together so the controls panel
matches the active visualiser theme.

### Layout

- `<canvas>`: `position: fixed; inset: 0`.
- `#controls`: `position: fixed; top: 12px; left: 12px`, overlaid.
- No mobile breakpoint.

## 8. State and controls

Single source of truth: the `state` object (Section 5). Three functions
own writes:

- `startCapture()` — calls `getDisplayMedia`, builds the audio graph,
  detects channel count, sets `state.running = true`, kicks the rAF loop,
  calls `applyState()`.
- `stopCapture()` — stops all stream tracks, closes the AudioContext,
  sets `state.running = false`, hides controls behind the start screen.
  **Idempotent**: safe to call when `state.running` is already `false`
  (no-op early return on entry). This matters because `Escape` is the
  only key the global handler lets through when not running, and a
  repeat `Escape` would otherwise call into `stopCapture` against a
  null AudioContext.
- `applyState()` — single sync function: pushes `state.sensitivity` to
  `audio.gain.gain.value`; pushes `state.fftSize` and `state.smoothing`
  to both analysers; updates `trailSprite.filters`; updates CSS
  `--fg`; toggles disabled-class on the Lissajous tab if mono.

Event wiring (one place at startup):

```js
document.getElementById("capture").onclick = startCapture;
document.getElementById("view").onchange   = e => { state.view  = e.target.value; applyState(); };
document.getElementById("theme").onchange  = e => { state.theme = e.target.value; applyState(); };
document.getElementById("gain").oninput    = e => { state.sensitivity = +e.target.value; applyState(); };
document.getElementById("fft").onchange    = e => { state.fftSize = +e.target.value; applyState(); };
document.getElementById("smooth").oninput  = e => { state.smoothing = +e.target.value; applyState(); };

document.addEventListener("keydown", e => {
  if (!state.running && e.key !== "Escape") return;
  if (e.key === "1") setView("waveform");
  if (e.key === "2") setView("spectrum");
  if (e.key === "3") setView("lissajous");
  if (e.key === "t" || e.key === "T") cycleTheme();
  if (e.key === "f" || e.key === "F") toggleFullscreen();
  if (e.key === "Escape") stopCapture();
});
```

Hotkeys mutate `state` and sync the dropdowns by writing to their
`value`, so the controls panel always reflects what's active.

## 9. Errors and edge cases

| Condition | Detection | User-facing message |
|---|---|---|
| Non-Chromium browser | `!navigator.mediaDevices?.getDisplayMedia` at load | "This visualiser needs Chrome, Edge, or Brave. Firefox cannot capture tab audio." |
| User denied permission | `getDisplayMedia` throws `NotAllowedError` | "Capture cancelled. Click Start again to try once more." |
| Shared without ticking "Share tab audio" | `stream.getAudioTracks().length === 0` | "No audio in the shared stream. Re-share the tab and tick 'Share tab audio'." |
| Shared a window/screen instead of a tab | Same as above | Same message; window/screen sharing in Chromium does not include audio. |
| Tab is silent | Time-domain samples near zero for >3 s | Inline hint: "No signal detected. Is the source playing?" Non-blocking. |
| User stops sharing from browser bar | `track.onended` | Status: "Sharing ended." Call `stopCapture()`. |
| Mono source | `audioTrack.getSettings().channelCount === 1` | Lissajous tab greyed with tooltip. |
| AudioContext suspended | `ctx.state === "suspended"` | Call `ctx.resume()` inside the Start click handler. |
| Window resize | `ResizeObserver` on `body` | Re-create `trail` RenderTexture. |
| Tab backgrounded | (no special handling) | Pixi ticker keeps running at lower priority; fine. |

### Explicitly out of scope

- No reconnection logic when stream ends; user clicks Start again.
- No format detection or transcoding; AudioContext handles native sample rate.
- No `localStorage` persistence.

## 10. Testing

### Automated (small set)

Pure helper functions only. Run via `node --test` (no test framework
needed for this scope):

- `freqToX(freq, width)` — bin 20 Hz → x ≈ 0; 20 kHz → x ≈ width;
  midpoint at log scale (632 Hz at half-width).
- `findZeroCrossing(buf)` — returns first index where
  `buf[i] < 0 && buf[i+1] >= 0`; returns 0 if none.

To keep these testable in plain Node, the helpers are defined as top-level
named functions in `main.js` and exported when running under Node
(`if (typeof module !== "undefined") module.exports = { freqToX, findZeroCrossing };`).
In the browser they're plain globals.

No DOM tests, no canvas snapshot tests, no Playwright. No mocks of our
own code; `applyState`, `startCapture`, `stopCapture` are verified by
manual QA only (they wire live browser APIs that mocks would
counterfeit, not exercise).

### Manual QA — `docs/manual-qa.md`

A checklist the dev runs by hand before claiming a release works:

1. Start capture → share Spotify Web Player tab with audio → all three views render.
2. Switch view via dropdown and via hotkey `1`/`2`/`3`. Same result either way.
3. Cycle themes; verify CRT phosphor decay, neon bloom, mono crisp line.
4. Crank sensitivity to 4.0 on quiet input; verify amplification visible without clipping canvas edges.
5. Set fftSize to 32768; spectrum view shows finer bins; waveform view shows slower refresh.
6. Share a window instead of a tab → status shows "No audio in the shared stream".
7. Use Firefox → "needs Chromium" message on load.
8. Resize window mid-capture → canvas re-fits, no trail-texture artefact.
9. Press `Esc` → returns to start screen cleanly; can start again.

## 11. Dev workflow

```bash
cd ~/my_work/oscilloscope
# edit index.html / main.js / style.css
python3 -m http.server 8000
# open http://localhost:8000 in Chrome/Edge/Brave
```

`getDisplayMedia` requires a secure context. `localhost` qualifies;
`https://` qualifies. **Opening `index.html` directly via `file://` does
not work** — Chromium's `getDisplayMedia` implementation rejects
`file://` origins with `SecurityError: getDisplayMedia must be called
from a secure origin`. Always run the page over `http://localhost:<port>`
during development, even for one-off tests.

Deployment: copy the three files to any static host (GitHub Pages,
Netlify, plain webserver) that serves over HTTPS or `localhost`. No
build step.

## 12. Open questions

None at spec-write time. All design decisions are settled:

- Platform, audio source, views, layout, themes, controls, stack,
  location, name, renderer, file structure.
- Tradeoffs around mobile, Firefox, persistence, reconnection have all
  been resolved as non-goals.

## 13. Next step

Once this spec is approved by the user, the `writing-plans` skill will
turn it into an implementation plan that breaks the work into ordered,
testable steps.

## 14. Resolution of plan-reviewer findings

The plan-reviewer pass returned **2 CRITICAL / 4 IMPORTANT / 3
NICE-TO-HAVE / 2 Unverified / 2 Questions for Author** (13 findings).
Per project rule, every finding is addressed with a disposition and
evidence. The full review report is at
`docs/plans/reviews/2026-05-16-music-oscilloscope-design.md`.

### CRITICAL

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| C1 | `renderer.render()` v8 API uses object form with `target` (or `renderTexture`); spec lacked explicit call form | **Fixed in §5 step 4.** | Spec now shows `app.renderer.render({ container: current, target: trail, clear: false })` and documents the field-name caveat between `target` and `renderTexture`. |
| C2 | `BloomFilter({strength: 8})` is wrong; pixi-filters v6 requires `{x, y}` | **Fixed in §5 themes.** | `new BloomFilter({strength: {x: 8, y: 8}})`. |

### IMPORTANT

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| I1 | Video track must be explicitly `.stop()`-ed, not just "never displayed" | **Fixed in §4.** | New paragraph "Stopping the video track is mandatory" with explicit call form and reason (sharing indicator). |
| I2 | `audioTrack.getSettings().channelCount` unreliable for `getDisplayMedia` streams | **Fixed in §4.** | New caveat paragraph explaining the OS-routing failure mode; the spec keeps the `=== 1` gating but acknowledges `>= 2` may still be near-mono and that the rotated Lissajous formula renders that correctly. |
| I3 | `file://` does NOT qualify as a secure context for `getDisplayMedia` | **Fixed in §11.** | Removed the `file://` fallback claim; dev workflow now states `file://` is rejected and mandates `localhost`. |
| I4 | `stopCapture()` must be idempotent because the keydown guard lets `Escape` through when not running | **Fixed in §8.** | Description of `stopCapture()` now states "Idempotent: safe to call when `state.running` is already `false`". |

### NICE-TO-HAVE

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| N1 | Lissajous formula didn't state canvas-y inversion; rendered shapes would be y-flipped vs hardware vectorscope | **Fixed in §6c.** | Added `y_canvas = height/2 - y_rot` and explanation; flip aligns with hardware-vectorscope convention. |
| N2 | `sampleRate` source unstated; could be hardcoded by mistake | **Fixed in §6b.** | Mandates `ctx.sampleRate`; cites the 44100/48000 typical range and the miscalibration risk. |
| N3 | PixiJS v8 `Graphics` needs explicit `.stroke({color, width})` terminator; v7's auto-stroke is gone | **Fixed in §6a.** | Added explicit `stroke()` call form; notes the same pattern applies to §6b and §6c. |

### Unverified Claims

| ID | Claim | Disposition | Evidence |
|---|---|---|---|
| U1 | "sampleRate typically 44100 or 48000" — no primary source | **Acknowledged as hint, not normative.** | The N2 fix mandates reading `ctx.sampleRate` at runtime, so the typical-range hint is informational only and any deviation is handled by the runtime read. |
| U2 | `ChannelSplitterNode` outputs' channel-count semantics | **Rejected as not applicable.** | The spec reads `channelCount` from the raw `audioTrack`, **before** any splitter; the splitter's downstream channel semantics are irrelevant to this read. The I2 fix made this read-site explicit. |

### Questions for Author

| ID | Question | Disposition | Evidence |
|---|---|---|---|
| Q1 | CDN URL and bundle for `pixi-filters@6`? | **Answered in §3.** | Both `<script>` tags now spelled out with full jsdelivr URLs; bundle path is `dist/browser/pixi-filters.min.js` (combined bundle that exposes all filter classes). |
| Q2 | `new GlowFilter(...)` vs bare `GlowFilter(...)`? | **Answered in §5 themes.** | All three filter constructors now use `new`. |

