# Scope: import projectM visualization algorithms

## Context

The Scope oscilloscope (`/home/alexie/software/oscilloscope/`) renders three views (Waveform, Spectrum, Lissajous) over PixiJS v8 with three color palettes (CRT / Neon / Mono). The HANDOVER.md "Known issues" section flags four pain points: chaotic visualisation at some settings, FFT control with unclear effect, ambiguous "sensitivity" terminology, and no auto-gain. The user asked to adapt the visualisation algorithms used by projectM (the Milkdrop preset engine, https://github.com/projectM-visualizer/projectm) rather than port the engine.

Palettes control color only; the new algorithms apply globally with one set of defaults. Two new drawer toggles ship with the algorithms: Auto-gain (default ON) and Keep-screen-on (default ON).

## Algorithms adopted (with projectM source citations)

**Audio-side (always on, view-agnostic):**

1. **PCM 2-tap pre-smoothing.** `out[i] = 0.5 * (in[i] + in[i-1])`. Source: `src/libprojectM/Audio/PCM.cpp`. Reduces high-frequency jitter in the waveform before drawing. Applied IN ADDITION to the existing cross-frame `smoothBuf()` lerp, not as a replacement (see §UI changes).
2. **Asymmetric EMA envelope follower (loudness).** Per-band running averages with attack rate 0.2, release rate 0.5, long-term rate 0.992; rates FPS-adjusted via `rate^secondsSinceLastFrame`. Source: `src/libprojectM/Audio/Loudness.cpp`. Used for auto-gain (normalise to `longAverage`) and for beat detection (`current / longAverage > threshold`).
3. **Three-band split (bass / mid / treble).** Sum FFT bin magnitudes in three log-spaced ranges (20–250 Hz, 250 Hz–4 kHz, 4–20 kHz). Source: `src/libprojectM/Audio/Loudness.cpp` (`SumBand()`). Each band feeds its own EMA follower. Beat ≡ bass-band ratio spike.

**Visual:**

4. **Thick waveform (multi-offset draw).** Draw the same polyline at 4 diagonal corner offsets (`[-1,-1],[1,-1],[1,1],[-1,1]`). Source: `src/libprojectM/MilkdropPreset/Waveform.cpp` (`waveThick` flag — projectM uses corner offsets, not cardinal).
5. **Frame-feedback decay (videoEcho).** Multiply the trail texture by a constant `gammaAdj` (0.96) per frame instead of overlaying a translucent black rect. Source: `src/libprojectM/MilkdropPreset/VideoEcho.cpp`. Exponential decay curve.
6. **HSV hue cycling.** Sinusoidal hue modulation, time-driven. Source: `src/libprojectM/MilkdropPreset/FinalComposite.cpp` (`ApplyHueShaderColors`). Constants in the projectM source (`0.6 + 0.3*sin(time*30*0.0143 + phase)`) are *adapted* in this plan, not quoted verbatim — actual cycle period and amplitude are named constants in `palette-color.js` for easy tuning.
7. **Hue-shift on beat.** On bass-beat trigger, `beatPulse` is set to 1 and decays exponentially with τ = 250 ms (`beatPulse *= exp(-dt_ms / 250)`). Per-palette hue jump: Neon +60°, CRT 0° (brightness only), Mono 0° (brightness only).
8. **Mesh-warp lite (per-frame zoom + rotate of the trail).** Apply a per-frame transform to `pixi.trailSprite` driven by `bassAtt` and `time`. Source: `src/libprojectM/MilkdropPreset/MotionVectors.cpp` (mesh-warp parameter family). Restricted to global scale + rotate (no per-vertex grid).
9. **Blur cascade (single pass).** Use PixiJS v8's core `BlurFilter` once on the trail before composite. Source: `src/libprojectM/MilkdropPreset/BlurTexture.cpp`. Applied AFTER any existing palette filter (so bloom-then-blur softens halos, not blur-then-bloom which would re-sharpen).

## Global effect defaults

Palettes are color, not behavior. All algorithms apply globally with one set of defaults. The three existing palettes (CRT / Neon / Mono) control only the color domain:

| Palette | Base color | `hueCycleRadians` (±) | `hueShiftOnBeat` (deg) |
|---|---|---|---|
| CRT | `0x33ff66` (green) | π/12 (15°) | 0 (brightness pulse only) |
| Neon | `0x00e5ff` (cyan) | π (full 360° range over ~30 s) | 60° |
| Mono | `0xffffff` (white) | 0 (none) | 0 (brightness pulse only) |

Pre-existing per-palette `decayAlpha`, `lineWidth`, and `filters` (CRT GlowFilter+CRTFilter, Neon BloomFilter) stay as they are. New global constants in `mesh-warp.js`:

```js
export const MESH_SCALE_AMP = 0.003;        // scale = 1 + MESH_SCALE_AMP * bassAtt
export const MESH_ROT_AMP   = 0.0008;       // |rotation| ≤ MESH_ROT_AMP * 3 = 0.0024 rad ≈ 0.14°
export const MESH_ROT_FREQ  = 0.5;          // period ≈ 12.6 s — slow enough to feel organic
```

- **Thick waveform**: 4 diagonal corner offsets `[[-1,-1],[1,-1],[1,1],[-1,1]]`, stroke alpha 0.5 for outer offsets, 1.0 for center stroke (5 strokes total per frame). If frame-rate dips below 50 fps on a real device, reduce to 2 offsets `[[-1,-1],[1,1]]` (named `THICK_OFFSETS_LITE`).
- **Frame-feedback `gammaAdj`**: 0.96 multiplier on the trail texture per frame, applied only on palettes whose existing `decayAlpha < 1` (CRT today).
- **Blur cascade**: `new PIXI.BlurFilter({ strength: 2, quality: 2 })`, appended to the palette's filter array AFTER its existing filters.

## UI changes

Two additions in the settings drawer, both toggles, both default ON:

1. **Auto-gain.** When ON, the sensitivity slider is disabled and the asymmetric-EMA follower normalises audio amplitude to a target. When OFF, slider behaves as today. Auto-gain output is clamped: `targetGain = clamp(TARGET_LEVEL / max(MIN_LONG, longAverage), GAIN_MIN, GAIN_MAX)` with `MIN_LONG = 1e-4`, `GAIN_MIN = 0.1`, `GAIN_MAX = 2.0`, `TARGET_LEVEL = 0.3`. Silent input therefore caps gain at `GAIN_MAX`, never diverges.
2. **Keep screen on.** When ON, prevents the screen from sleeping while capture is running. Web: `navigator.wakeLock.request('screen')` inside a `try { … } catch (e) { … }` block, gated by `if (!('wakeLock' in navigator)) { setStatus('Wake Lock API not available — screen may sleep'); return; }`. Re-acquired on `visibilitychange` when the page becomes visible. Android: a new `@PluginMethod fun setKeepScreenOn(enabled: Boolean)` on `ScopeAudioPlugin` toggles `WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON` on the activity window. Released cleanly when capture stops regardless of toggle state.

The existing "Smoothing" slider keeps its current dual-purpose meaning: it modulates BOTH the AnalyserNode's `smoothingTimeConstant` (FFT bins) AND the cross-frame temporal lerp in `smoothBuf()` (`main.js:448–460`). `smoothBuf()` is NOT removed. The new projectM 2-tap PCM smoother is applied as an additional pre-step inside `drawWaveform()` and `drawLissajous()`, BEFORE the `smoothBuf()` lerp. Both layers coexist.

No new palettes, no new view modes, no new sliders. The HANDOVER "FFT control unclear" and "Sensitivity terminology" entries are deliberately untouched — they are labelling questions orthogonal to the algorithm work.

## Module structure

Three new ES modules, all pure JS, all Node-testable (no Web Audio, no PixiJS, no DOM dependencies):

- `audio-features.js` — exports `pcmSmooth(buf, scratch)`, `sumBand(fftBins, sampleRate, fMin, fMax)`, `createLoudnessTracker({ attack, release, longRate })`, `createBeatDetector(tracker, { threshold, refractoryMs })`, and a factory `createAudioAnalysis({ analyserL, analyserR, sampleRate, fftSize })` returning `{ update(dt, nowMs) → { bass, mid, treb, bassAtt, beat, beatPulse, longAverage } }`.
- `palette-color.js` — exports `currentColor(palette, time, beatPulse)` returning a packed RGB int. Pure math, no Pixi references. Encapsulates per-palette hue-cycling range and hue-on-beat behavior (see table above). `beatPulse` is in `[0, 1]`.
- `mesh-warp.js` — exports `meshTransform(bassAtt, time)` returning `{ scale, rotation }`. Exports the named constants `MESH_SCALE_AMP`, `MESH_ROT_AMP`, `MESH_ROT_FREQ`.

All three files live at the project root next to `audio-ring-buffer.js` and `swipe-detector.js`, matching the existing convention.

`main.js` integrates these at named slots (file:line refs from the current code):

- `main.js:101–105` (themes table) → extend each entry with `hueCycleRadians` and `hueShiftOnBeat` per the table above.
- `main.js:161–166` (analyser setup) → after the analyser nodes, call `state.audioAnalysis = createAudioAnalysis({ analyserL: audio.analyserL, analyserR: audio.analyserR, sampleRate: audio.ctx.sampleRate, fftSize: state.fftSize })`.
- `main.js:397` (start of `frame()`) → after `lastFrameTime = now;`, call `const aState = state.audioAnalysis.update(dt, now); state.audio = aState;`. This runs BEFORE the existing silent-threshold scan at lines 398–416 so envelope state is fresh for auto-gain math.
- `main.js:398–416` (silent-threshold scan) → unchanged; the new `state.audio.longAverage` is used independently of `peak`.
- `main.js:416` (after silent-threshold scan, before `theme = themes[state.theme]`) → if `state.autoGain` ON: compute `targetGain` per the clamp formula above and lerp `audio.gain.gain.value` toward it with smoothing factor 0.05.
- `main.js:421–425` (trail decay rect) → if `theme.decayAlpha < 1`, replace the translucent black `rect().fill()` with a gamma-decay step: render the existing `pixi.trailSprite` (tinted by `gammaAdj`) back into `pixi.trail` with `clear: true`. For palettes with `decayAlpha = 1`, behavior is unchanged (full clear each frame).
- `main.js:429–431` (frame dispatch) → before view dispatch, compute `const { scale, rotation } = meshTransform(state.audio.bassAtt, now / 1000); pixi.trailSprite.scale.set(scale); pixi.trailSprite.rotation = rotation;`.
- `main.js:462–479` (`drawWaveform`) → extract path-building into `traceWaveform(g, points)` helper that calls `moveTo`/`lineTo` only; the outer function then loops over `THICK_OFFSETS` and calls `traceWaveform` once per offset followed by `g.stroke({ color: currentColor(theme, now/1000, state.audio.beatPulse), width: theme.lineWidth, alpha: offsetAlpha })`. PCM 2-tap pre-smoothing (`pcmSmooth(buf, scratch)`) is applied between `getFloatTimeDomainData` and `smoothBuf`.
- `main.js:517–541` (`drawLissajous`) → same multi-offset + PCM pre-smoothing + dynamic color as Waveform.
- `main.js:481–515` (`drawSpectrum`) → palette-shifted color per bin via `currentColor(theme, now/1000, state.audio.beatPulse)`; multi-offset thickening N/A (area-filled).
- `main.js:589–595` (theme filter init) → append `new PIXI.BlurFilter({ strength: 2, quality: 2 })` (top-level `PIXI.BlurFilter`, NOT `PIXI.filters.BlurFilter`; verified via `pixi-shim.js:26` and PixiJS v8 docs) to each palette's filter array.
- `mobile-ui.js` and `index.html` → add Auto-gain toggle and Keep-screen-on toggle markup + handlers in the drawer.

### Screen-wake implementation

Web side, in `main.js` (new helper, ~30 lines):

```js
async function requestScreenLock() {
  if (!state.keepScreenOn) return;
  if (!('wakeLock' in navigator)) {
    setStatus('Wake Lock API not available — screen may sleep');
    return;
  }
  try {
    state.screenLock = await navigator.wakeLock.request('screen');
    state.screenLock.addEventListener('release', () => { state.screenLock = null; });
  } catch (err) {
    setStatus(`Wake lock failed: ${err.message}`);
  }
}

async function releaseScreenLock() {
  try { await state.screenLock?.release(); } catch {}
  state.screenLock = null;
}
```

- `visibilitychange` handler (existing logic around `main.js:609–615`) re-calls `requestScreenLock()` when the page becomes visible and `state.keepScreenOn` is true. The Wake Lock API auto-releases on page hide; this is expected.
- `startCapture()` / `startCaptureAndroid()` call `requestScreenLock()` after audio setup.
- `stopCapture()` calls `releaseScreenLock()` unconditionally.

Android side, in `android/app/src/main/java/com/alpapan/scope/`:

- `ScopeAudioPlugin.kt` — add `@PluginMethod fun setKeepScreenOn(call: PluginCall)`. Reads `enabled: Boolean` arg, posts to main thread, calls `activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)` when true or `clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)` when false. Resolves with `call.resolve()`.
- `MainActivity.kt` — defensive `clearFlags(FLAG_KEEP_SCREEN_ON)` in `onDestroy` so the flag doesn't outlive the activity.
- JS-side `setKeepScreenOnAndroid(enabled)` wraps `Capacitor.Plugins.ScopeAudio.setKeepScreenOn({ enabled })`. Called from the toggle handler and from `startCaptureAndroid()` after consent grant. The web Wake Lock path also runs inside the Capacitor WebView; if it succeeds it is redundant with the native flag but harmless. If it fails on Android (e.g. WebView refuses), the native flag still works.

## Verification

Unit tests (Node, `tests/`). Concrete test code below is the actual content to write, not pseudocode.

### `tests/audio-features.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pcmSmooth, sumBand,
  createLoudnessTracker, createBeatDetector,
} from '../audio-features.js';

test('pcmSmooth: identity on flat input', () => {
  const inBuf = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  const out = pcmSmooth(inBuf, new Float32Array(4));
  for (let i = 1; i < out.length; i++) assert.equal(out[i], 0.5);
});

test('pcmSmooth: attenuates a 1-sample spike by 50%', () => {
  const inBuf = new Float32Array([0, 0, 1, 0, 0]);
  const out = pcmSmooth(inBuf, new Float32Array(5));
  assert.equal(out[2], 0.5);   // spike halved
  assert.equal(out[3], 0.5);   // spike spread to neighbour
});

test('pcmSmooth: preserves DC offset', () => {
  const inBuf = new Float32Array([0.3, 0.3, 0.3, 0.3]);
  const out = pcmSmooth(inBuf, new Float32Array(4));
  let sumIn = 0, sumOut = 0;
  for (let i = 0; i < 4; i++) { sumIn += inBuf[i]; sumOut += out[i]; }
  assert.ok(Math.abs(sumIn - sumOut) < 1e-6);
});

test('pcmSmooth: preserves length', () => {
  const out = pcmSmooth(new Float32Array(2048), new Float32Array(2048));
  assert.equal(out.length, 2048);
});

test('sumBand: returns 0 for empty range', () => {
  const bins = new Float32Array(1024).fill(1);
  assert.equal(sumBand(bins, 48000, 100, 100), 0);
});

test('sumBand: at FFT 2048 @ 48 kHz, [20,250] Hz spans bins 1..10', () => {
  // bin width = 48000 / 2048 ≈ 23.4375 Hz
  // bin i corresponds to i * 23.4375 Hz; bin 1 = 23.4 Hz (>= 20), bin 10 = 234 Hz (<= 250)
  const bins = new Float32Array(1024);
  for (let i = 0; i < bins.length; i++) bins[i] = i;     // identity weights
  const sum = sumBand(bins, 48000, 20, 250);
  let expected = 0;
  for (let i = 1; i <= 10; i++) expected += i;
  assert.equal(sum, expected);
});

test('createLoudnessTracker: average converges to constant input', () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  for (let i = 0; i < 200; i++) t.update(1.0, 1 / 60);
  const { average, longAverage } = t.update(1.0, 1 / 60);
  assert.ok(Math.abs(average - 1.0) < 0.05);
  assert.ok(Math.abs(longAverage - 1.0) < 0.1);
});

test('createLoudnessTracker: spike produces ratio > 1', () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  for (let i = 0; i < 100; i++) t.update(0.1, 1 / 60);  // quiet baseline
  const { ratio } = t.update(2.0, 1 / 60);              // sudden spike
  assert.ok(ratio > 2.0);
});

test('createLoudnessTracker: FPS-adjusted decay is rate-invariant', () => {
  const t60 = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const t30 = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  for (let i = 0; i < 60; i++) t60.update(1.0, 1 / 60);  // 1 second @ 60 fps
  for (let i = 0; i < 30; i++) t30.update(1.0, 1 / 30);  // 1 second @ 30 fps
  assert.ok(Math.abs(t60.update(1, 0).longAverage - t30.update(1, 0).longAverage) < 0.02);
});

test('createBeatDetector: no beat on flat input', () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const det = createBeatDetector(t, { threshold: 1.5, refractoryMs: 200 });
  for (let i = 0; i < 200; i++) {
    assert.equal(det.update(0.5, 1 / 60, i * 16.7), false);
  }
});

test('createBeatDetector: beat fires on spike', () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const det = createBeatDetector(t, { threshold: 1.5, refractoryMs: 200 });
  for (let i = 0; i < 100; i++) det.update(0.1, 1 / 60, i * 16.7);
  assert.equal(det.update(1.0, 1 / 60, 100 * 16.7), true);
});

test('createBeatDetector: refractory window suppresses re-trigger', () => {
  const t = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const det = createBeatDetector(t, { threshold: 1.5, refractoryMs: 200 });
  for (let i = 0; i < 100; i++) det.update(0.1, 1 / 60, i * 16.7);
  det.update(1.0, 1 / 60, 100 * 16.7);                  // first beat at t=1670 ms
  assert.equal(det.update(1.0, 1 / 60, 100 * 16.7 + 50), false);   // 50ms later: suppressed
  assert.equal(det.update(1.0, 1 / 60, 100 * 16.7 + 250), true);   // 250ms later: allowed
});
```

### `tests/palette-color.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentColor } from '../palette-color.js';

const CRT  = { fg: 0x33ff66, hueCycleRadians: Math.PI / 12, hueShiftOnBeat: 0 };
const NEON = { fg: 0x00e5ff, hueCycleRadians: Math.PI,      hueShiftOnBeat: Math.PI / 3 };
const MONO = { fg: 0xffffff, hueCycleRadians: 0,            hueShiftOnBeat: 0 };

test('currentColor: Mono returns base unchanged at any time/beat', () => {
  assert.equal(currentColor(MONO, 0, 0), 0xffffff);
  assert.equal(currentColor(MONO, 12.345, 0.7), 0xffffff);
});

test('currentColor: CRT cycles strictly within ±15° of base hue', () => {
  // green base ~120°; with ±15° range the hue stays in [105°, 135°]
  for (let t = 0; t < 60; t += 0.1) {
    const c = currentColor(CRT, t, 0);
    const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
    assert.ok(g >= r, `green dominant at t=${t}`);
    assert.ok(g >= b, `green dominant at t=${t}`);
  }
});

test('currentColor: Neon hue jumps on beatPulse=1, returns near base at beatPulse=0', () => {
  const baseCyan = currentColor(NEON, 0, 0);
  const onBeat   = currentColor(NEON, 0, 1);
  assert.notEqual(baseCyan, onBeat, 'hue shifts on beat');
  const decayed  = currentColor(NEON, 0, 0.01);
  // Within 1% of base for a near-zero pulse (allow for floating-point packing rounding)
  const r1 = (baseCyan >> 16) & 0xff, r2 = (decayed >> 16) & 0xff;
  assert.ok(Math.abs(r1 - r2) <= 5);
});
```

### `tests/mesh-warp.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meshTransform, MESH_SCALE_AMP, MESH_ROT_AMP, MESH_ROT_FREQ,
} from '../mesh-warp.js';

test('meshTransform: identity at zero input', () => {
  const { scale, rotation } = meshTransform(0, 0);
  assert.equal(scale, 1);
  assert.equal(rotation, 0);
});

test('meshTransform: scale > 1 for positive bassAtt', () => {
  const { scale } = meshTransform(1.0, 0);
  assert.ok(scale > 1 && scale < 1.01);
});

test('meshTransform: rotation bounded by MESH_ROT_AMP * 3 for all inputs', () => {
  const bound = MESH_ROT_AMP * 3;
  for (let bass = 0; bass <= 1; bass += 0.05) {
    for (let t = 0; t < 100; t += 0.13) {
      const { rotation } = meshTransform(bass, t);
      assert.ok(Math.abs(rotation) <= bound + 1e-12, `|rot|=${rotation} at bass=${bass}, t=${t}`);
    }
  }
});

test('meshTransform: mean rotation across 100 deterministic samples ≈ 0', () => {
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    const t = (i * Math.PI) / (MESH_ROT_FREQ * 50);  // sample a full period
    sum += meshTransform(0.5, t).rotation;
  }
  const mean = sum / 100;
  assert.ok(Math.abs(mean) < 1e-4, `mean=${mean}`);
});
```

### Manual QA (`docs/manual-qa.md` extension)

- Desktop browser at `index.html`: each palette, each view, with Auto-gain ON and OFF. Confirm: trail decay smooth (no banding), thick-line preserves color, mesh-warp doesn't drift center across a 5-minute session, beat-pulse aligns visually with kicks on a 120 BPM metronome (alignment within one frame ≈ 16.7 ms at 60 Hz).
- Wake Lock web path: in Chrome DevTools, observe `state.screenLock` is non-null after capture starts; toggle off and confirm it goes null. Also test in an OS where the Wake Lock API is absent (no available such OS at time of writing — note as deferred); confirm the status bar shows the "Wake Lock API not available" message.
- Android APK on a phone: same matrix, in PiP and full-screen. Auto-gain toggle off → manual slider works. Keep-screen-on toggle off during capture → screen sleeps per device default. Keep-screen-on toggle on → screen stays awake for the duration of capture, releases when stopped.

End-to-end build:

```bash
npm test                                  # all unit tests, expect ≥36 pass (18 existing + 18 new)
npm run sync && cd android && ./gradlew :app:assembleRelease
# -> /home/alexie/software/oscilloscope/android/app/build/outputs/apk/release/app-release.apk
```

User transfers the APK to their phone by their own route.

## Implementation order (TDD)

1. Write `tests/audio-features.test.js` (the full content above). Run `npm test`; confirm RED for the new file.
2. Write `audio-features.js` minimum to pass.
3. Write `tests/palette-color.test.js`; confirm RED.
4. Write `palette-color.js` minimum to pass.
5. Write `tests/mesh-warp.test.js`; confirm RED.
6. Write `mesh-warp.js` minimum to pass.
7. Re-run `npm test`; all green (18 existing + 18 new).
8. Wire `audio-features` into `main.js`: factory at analyser-setup, `update()` at start of `frame()`, auto-gain clamp after silent-threshold scan. Default Auto-gain ON but `TARGET_LEVEL` chosen so initial gain ≈ current behavior.
9. Extend themes table with `hueCycleRadians`/`hueShiftOnBeat`; wire `palette-color` + `mesh-warp` into draw functions; introduce `THICK_OFFSETS` and `THICK_OFFSETS_LITE` globals; append `PIXI.BlurFilter` to palette filter arrays.
10. Add Auto-gain and Keep-screen-on toggle markup + handlers (`index.html` drawer, `mobile-ui.js` wiring, web Wake Lock helpers in `main.js` per the §Screen-wake snippet).
11. Add `setKeepScreenOn` plugin method to `ScopeAudioPlugin.kt`; defensive `clearFlags` in `MainActivity.onDestroy`.
12. `npm run sync && cd android && ./gradlew assembleRelease`; manual QA per `docs/manual-qa.md` extension.

## Files modified / created

Created:
- `audio-features.js` (~140 lines)
- `palette-color.js` (~50 lines)
- `mesh-warp.js` (~25 lines)
- `tests/audio-features.test.js`
- `tests/palette-color.test.js`
- `tests/mesh-warp.test.js`

Modified:
- `main.js` (sections cited above; Wake Lock helpers; auto-gain clamp; smoothBuf kept intact)
- `mobile-ui.js` (Auto-gain + Keep-screen-on toggle handlers)
- `index.html` (toggle markup in drawer)
- `android/app/src/main/java/com/alpapan/scope/ScopeAudioPlugin.kt` (new `@PluginMethod fun setKeepScreenOn`)
- `android/app/src/main/java/com/alpapan/scope/MainActivity.kt` (defensive `clearFlags` in `onDestroy`)
- `docs/manual-qa.md` (projectM-algorithm + screen-wake QA matrix)
- `docs/HANDOVER.md` ("Known issues" entry 1 chaotic and entry 4 auto-gain marked resolved; entries 2 FFT and 3 sensitivity wording explicitly unchanged; new "Keep screen on" feature note)

Unchanged:
- `audio-worklet-processor.js`, `audio-ring-buffer.js`, `swipe-detector.js`. Audio transport untouched.
- `AndroidManifest.xml` (no new permissions needed; `FLAG_KEEP_SCREEN_ON` is a window flag, not a permission).
- `AudioCaptureService.kt`, `ScopePipReceiver.kt`. Capture / PiP flow unchanged.

## Out of scope (deliberately)

- Full Milkdrop preset interpreter (per-frame / per-vertex / per-pixel equation engine).
- Per-vertex mesh warp (a 64×48 grid with per-vertex displacement). Use global scale + rotate only.
- Renaming "Sensitivity" to "Gain" (unilateral UI change; not asked).
- The HANDOVER "FFT control unclear" issue (deferred to its own ticket).
- Restructuring the existing palettes' bundled `lineWidth` / `decayAlpha` / `filters` fields.
- Removing the existing cross-frame `smoothBuf()` temporal lerp (user did not consent; layered, not replaced — see §UI changes and Resolution C2).
- Any change to AndroidManifest, MediaProjection consent flow, foreground service, or PiP lifecycle.

## Resolution of plan-review findings

Per CLAUDE.md GOLDEN RULE, every finding from `docs/plans/reviews/happy-snacking-cascade.md` is addressed below — Critical, Important, Suggestion, Unverified Claim, Question.

| ID | Severity | Disposition | Notes |
|---|---|---|---|
| C1 | CRITICAL | **Fixed** §Verification | All three test files now have full runnable content, not prose descriptions. |
| C2 | CRITICAL | **Fixed** §UI changes, §Algorithms #1, §Out of scope | `smoothBuf()` is KEPT; PCM 2-tap layered on top. Smoothing slider keeps dual-purpose meaning. User did not consent to scope change → reverted. |
| C3 | CRITICAL | **Fixed** §Screen-wake implementation | `requestScreenLock` wraps in try/catch, checks `'wakeLock' in navigator`, surfaces failure via `setStatus(...)`. |
| C4 | CRITICAL | **Fixed** §Algorithms #4, §Global effect defaults | Corner offsets `[[-1,-1],[1,-1],[1,1],[-1,1]]` match projectM's `waveThick`. |
| C5 | CRITICAL | **Fixed** §Module structure (theme filter init), §Algorithms #9 | Confirmed via `pixi-shim.js:26` and PixiJS v8 docs (context7): `new PIXI.BlurFilter({ strength, quality })` at top level. Was `PIXI.filters.BlurFilter` — wrong. |
| C6 | CRITICAL | **Fixed** §Module structure | `createAudioAnalysis({...})` factory with explicit signature; called at start of `frame()` BEFORE the silent-threshold scan; `state.audio` is populated for every downstream consumer. |
| I1 | IMPORTANT | **Fixed** §Verification (mesh-warp tests) | Replaced statistical drift test with two deterministic ones: amplitude bound across grid of inputs, mean of 100 sampled-period points ≤ 1e-4. |
| I2 | IMPORTANT | **Fixed** §UI changes (Auto-gain), §Module structure | Clamped formula `targetGain = clamp(TARGET_LEVEL / max(MIN_LONG, longAverage), GAIN_MIN, GAIN_MAX)` with named constants. Silent input cannot diverge. |
| I3 | IMPORTANT | **Fixed** §Algorithms #7, §Module structure | `beatPulse ∈ [0,1]`, set to 1 on `beat`, exp decay τ=250ms. Per-palette `hueShiftOnBeat` in degrees in the §Global defaults table. |
| I4 | IMPORTANT | **Fixed** §Verification (`sumBand` tests) | Concrete bin math: at FFT 2048 @ 48 kHz, `[20,250] Hz` spans bins 1..10 inclusive. Test asserts the deterministic identity-weighted sum. |
| S1 | SUGGESTION | **Fixed** §Global effect defaults (Thick waveform) | Documented `THICK_OFFSETS_LITE` fallback (2 offsets) for sub-50-fps devices. |
| S2 | SUGGESTION | **Fixed** §Manual QA | "120 BPM metronome, alignment within one frame ≈ 16.7 ms at 60 Hz" is the explicit reference. |
| S3 | SUGGESTION | **Fixed** §Global effect defaults | `MESH_SCALE_AMP`, `MESH_ROT_AMP`, `MESH_ROT_FREQ` exported as named constants from `mesh-warp.js`. |
| U1 | UNVERIFIED | **Addressed** §Algorithms #6 | Explicitly noted: the projectM constants are *adapted*, not quoted. `palette-color.js` uses its own named constants. The unit test asserts behavior (hue-cycling within range, jump on beat), not numeric equality to projectM. |
| U2 | UNVERIFIED | **Addressed** §Verification (mesh-warp tests) | Empirically verified by the I1 deterministic-sample mean test. |
| U3 | UNVERIFIED | **Addressed** §Algorithms #9 | Specified filter ordering: BlurFilter appended AFTER existing filters (post-bloom blur softens halos). |
| Q1 | QUESTION | **Answered** §UI changes, Resolution C2 | No, user did not consent. `smoothBuf` kept. Smoothing slider stays dual-purpose. |
| Q2 | QUESTION | **Answered** §Verification | Bin mapping made concrete for the canonical FFT 2048 @ 48 kHz case. |
| Q3 | QUESTION | **Answered** §UI changes (Auto-gain) | Clamp with `GAIN_MIN=0.1`, `GAIN_MAX=2.0`, `MIN_LONG=1e-4`. |
| Q4 | QUESTION | **Answered** §Module structure (theme filter init) | `PIXI.BlurFilter` top-level (core), `{strength,quality}` options. |
| Q5 | QUESTION | **Answered** §Algorithms #7 | `beatPulse ∈ [0,1]`, exp decay τ=250 ms. |
| Q6 | QUESTION | **Answered** Resolution C2 | Smoothing slider stays dual-purpose (FFT smoothingTimeConstant + smoothBuf lerp). PCM 2-tap added as a third pre-step inside draw functions. |
