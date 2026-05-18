# Plan review: happy-snacking-cascade.md

Reviewer: `plan-reviewer` subagent (Opus). Date: 2026-05-18.

**Verdict:** Yes with fixes.

**Finding counts:** 6 CRITICAL, 4 IMPORTANT, 3 SUGGESTION, 3 UNVERIFIED CLAIM, 6 QUESTION FOR AUTHOR.

---

## Strengths

1. File:line references are accurate. Every cited location (themes table at 101-105, analyser setup at 161-166, silent threshold at 398-416, trail decay at 421-425, frame dispatch at 429-431, smoothBuf at 448-460, drawWaveform at 462-479, drawLissajous at 517-541, filter init at 589-595, visibilitychange at 609-615) matches actual code exactly.
2. Android plugin pattern is correct. Proposed `@PluginMethod fun setKeepScreenOn(call: PluginCall)` follows the pattern used by `startCapture` / `stopCapture` in ScopeAudioPlugin.kt (lines 31-32, 80-81).
3. PixiJS v8 API usage verified. Code already uses `pixi.app.renderer.render(..., { renderTexture: pixi.trail, clear: false })` at lines 425, 434.
4. Module structure is sound — three pure-JS, Node-testable modules at project root.
5. Algorithm citations check out for the PCM 2-tap formula.
6. Platform assumptions safe — `FLAG_KEEP_SCREEN_ON` needs no manifest permission.

---

## Critical Issues (Must Fix)

### C1. Missing TDD test code

**Location:** Plan §Verification.

The plan describes test cases in English ("identity on flat input, attenuates a 1-sample spike") but provides zero runnable code. TDD's RED step cannot be performed from a prose description.

**Fix required:** Provide actual `test(...)` blocks with assertions for every test case in all three new test files.

### C2. Unilateral removal of cross-frame smoothing

**Location:** Plan §UI changes, §Module structure (`smoothBuf` deletion).

The plan removes `smoothBuf()` (`main.js:448–460`) and silently shifts the Smoothing slider's meaning from "affects all views" to "affects Spectrum FFT only". HANDOVER.md:124 explicitly documents the current behavior. The user did not consent to this scope change. Per memory rule `no_unilateral_ui_decisions`, this is a violation.

**Fix required:** Either confirm with user, or keep `smoothBuf` and apply PCM smoothing in addition (two layers can coexist).

### C3. Wake Lock API availability on Android WebView is unverified

**Location:** Plan §Screen-wake implementation.

The plan assumes `navigator.wakeLock.request('screen')` works inside a Capacitor 7 Android WebView. No fallback or error handling specified.

**Fix required:** Add try/catch + capability check (`if (!navigator.wakeLock) ...`), surface failure to user, document in manual QA that the web path is checked separately from the native path.

### C4. `THICK_OFFSETS` geometry mismatch with projectM

**Location:** Plan §Module structure, line citing `[[0,0],[1,0],[0,1],[-1,0],[0,-1]]`.

projectM's `waveThick` draws 4 corner offsets (top-left, top-right, bottom-right, bottom-left — diagonals). The plan proposes axis-aligned cardinal offsets (center, right, down, left). Visual result differs.

**Fix required:** Use corner offsets `[[-1,-1],[1,-1],[1,1],[-1,1]]` to match projectM, OR document the deliberate stylistic departure with a one-line rationale.

### C5. BlurFilter availability and constructor syntax unverified

**Location:** Plan §Module structure (`new PIXI.filters.BlurFilter({ strength: 2 })`).

`index.html:118` imports `GlowFilter, BloomFilter, CRTFilter` from pixi-filters@6, not `BlurFilter`. `pixi-shim.js:26` exports `BlurFilter` from `window.PIXI` (PixiJS core). v8 constructor syntax for `BlurFilter` may not accept `{ strength: 2 }`.

**Fix required:** Verify against PixiJS v8 docs whether `BlurFilter` is in core (pixi-shim path works) or needs the pixi-filters import. Confirm constructor option name (`strength` vs `blur` vs positional).

### C6. Audio feature update integration is vague

**Location:** Plan §Module structure (frame dispatch wiring).

Plan says "call `audio-features.update()` once per frame" but does not specify the function signature, the analyser-node ownership, or the ordering relative to the existing silent-threshold scan (`main.js:398–416`).

**Fix required:** Define a factory `createAudioAnalysis({ analyserL, analyserR, sampleRate })` returning `{ update(dt, nowMs) → { bass, mid, treb, bassAtt, beat, beatPulse } }`. Specify ordering: call BEFORE the silent-threshold block at line 398 so the envelope state is current when auto-gain math runs.

---

## Important Issues (Should Fix)

### I1. `meshTransform` bounded-drift test not practical in Node

**Location:** Plan §Verification (mesh-warp test spec).

"Long time window converges to 0" is statistical, slow, and flaky as a unit test.

**Fix required:** Replace with two concrete tests: (a) `|rotation| ≤ 0.0024` for any input sample; (b) mean rotation across 100 deterministic samples is within ±1e-4 of zero.

### I2. Auto-gain conflict with silent-threshold scan; gain explosion at silence

**Location:** Plan §Module structure (line 66 wiring), §Algorithms (auto-gain math).

If `longAverage ≈ 0` at silence, `targetLevel / longAverage` diverges. No guard specified.

**Fix required:** Clamp: `targetGain = clamp(targetLevel / max(MIN_LONG, longAverage), GAIN_MIN, GAIN_MAX)` with `MIN_LONG = 1e-4`, `GAIN_MIN = 0.1`, `GAIN_MAX = 2.0`. Add a test for the silent-input path.

### I3. Hue-on-beat and `beatPulse` lifecycle undefined

**Location:** Plan §Algorithms (algorithm 7), §Global effect defaults (palette table).

`beatPulse` is mentioned in tests and wiring but its type, range, and decay law are not specified.

**Fix required:** Define `beatPulse` ∈ [0, 1], set to 1 on `beat=true`, exponentially decays with τ = 250 ms (`beatPulse *= exp(-dt_ms / 250)`). Specify exact hue jump per palette: Neon = +60°, CRT = 0° (brightness pulse only), Mono = 0° (brightness pulse only).

### I4. `sumBand` test lacks concrete FFT parameters

**Location:** Plan §Verification (`sumBand` test).

"Known sample rate + FFT size" is vague. Wrong bin indices break the beat detector.

**Fix required:** Specify: at FFT 2048 @ 48 kHz, `sumBand(bins, 48000, 20, 250)` sums bin indices ⌈20·2048/48000⌉=1 through ⌊250·2048/48000⌋=10 (inclusive); test asserts the sum equals the deterministic sum of those indices when bins are seeded with a known pattern.

---

## Suggestions

### S1. Multi-offset waveform draw performance on low-end devices

Plan draws 4 offsets × ~2048 points/frame = ~8192 line segments. Likely fine on modern hardware; add a note that the offset count is tunable down to 2 if frame-rate dips appear on older phones.

### S2. Manual QA latency measurement is unspecified

"Beat-pulse fires within ~50 ms of perceived kick" — pick a measurable reference: a 120 BPM metronome, observe hue jump aligns within one frame (≤16.7 ms at 60 Hz).

### S3. Mesh-warp amplitude/frequency constants are unmotivated

`0.0008 * sin(time * 0.5) * (1 + 2 * bassAtt)` — document the rationale for `0.0008` (max ±0.0024 rad ≈ ±0.14°) and `0.5` (period ≈ 12.6 s) or expose them as named constants for easy tuning post-implementation.

---

## Unverified Claims

### U1. projectM hue-cycling constants

Plan cites `r = 0.6 + 0.3*sin(t*30*0.0143 + phase_r)` from `FinalComposite.cpp`. The constants 30 and 0.0143 are unverified; subagent A reported them but the reviewer did not independently confirm. Implementation should grep the source before hard-coding these numbers.

### U2. Mesh-warp long-session bounds claim

Plan asserts "rotation oscillates around 0; scale returns to 1 when audio is silent" — true by construction of the formula but not formally proven; rely on the unit test for empirical verification.

### U3. BlurFilter behavior under Neon's existing BloomFilter

Plan stacks BlurFilter on top of BloomFilter for Neon. Filter ordering matters — bloom-then-blur and blur-then-bloom produce different results. Visual outcome is unverified.

---

## Questions for the Author

1. **User consent for Smoothing slider scope change?** (Linked to C2.) Confirm explicit user approval, or keep the cross-frame lerp.
2. **Exact FFT-bin to frequency-band mapping?** (Linked to I4.)
3. **Auto-gain bounds and silent-input behavior?** (Linked to I2.)
4. **BlurFilter location and constructor syntax?** (Linked to C5.)
5. **`beatPulse` definition and decay law?** (Linked to I3.)
6. **Smoothing slider future** — single-purpose (FFT-only) or kept dual-purpose?

---

## Verdict and Reasoning

Architecturally sound. File references accurate. Module structure correct. Android plugin pattern matches the existing project convention. Six critical issues must be resolved before implementation begins; four important issues should be resolved; three suggestions and three unverified claims tracked.

Ready for implementation once the six critical fixes land in the plan.
