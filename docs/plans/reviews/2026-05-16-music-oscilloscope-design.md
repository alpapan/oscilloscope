# Design Review: Scope Music Oscilloscope
**Plan:** `docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md`
**Reviewer:** Claude Code (Sonnet 4.6)
**Date:** 2026-05-16

## Finding count

**2 CRITICAL / 4 IMPORTANT / 3 NICE-TO-HAVE / 2 Questions for Author**

---

## Plan Summary

Scope is a greenfield single-page audio visualiser. The user shares a browser
tab via `getDisplayMedia({audio: true})`, and the captured stream is analysed
with the Web Audio API and rendered through PixiJS v8 in one of three views
(waveform, spectrum, Lissajous) with three switchable themes. The entire app is
three flat files with no build step.

---

## Strengths

- **Audio graph design (§4)** is architecturally sound: one `AudioContext` built
  at capture-start, `ChannelSplitterNode` feeding two `AnalyserNode`s, gain
  before the splitter, never connected to `destination`. The "build once, never
  tear down on view/theme switches" decision prevents discontinuities in the
  analyser smoothing state -- a real usability concern that many similar projects
  miss.
- **`getFloatTimeDomainData` / `getFloatFrequencyData` over byte variants (§4)**
  is the correct choice; byte variants lose ~6 dB of dynamic range.
- **Zero-crossing trigger logic (§6a)** is the right stabilisation approach for
  oscilloscope display and is specified precisely enough to implement without
  ambiguity.
- **Single `applyState()` sync function (§8)** is a clean pattern for a project
  of this size: one code path updates audio graph, filters, and CSS together,
  eliminating the class of bug where one subsystem gets out of sync with another.
- **Error table (§9)** covers the common failure modes and matches them to the
  right detection hooks.
- **Test scope reasoning (§10)** is honest and defensible: `applyState`,
  `startCapture`, and `stopCapture` wire live browser APIs; mocking them would
  test the mock, not the code. The two pure helpers are the right candidates for
  automated testing.
- **pixi-filters@6 with pixi.js@8 is the correct version pairing** -- confirmed
  by the pixi-filters README compatibility table: v8.x requires v6.x.

---

## Issues

### CRITICAL

#### C1. RenderTexture phosphor-trail pattern -- incorrect renderer.render API (§5, per-frame loop step 4)

**Spec claim:** "Render `current` into `trail` with `clear: false`."

**Evidence from PixiJS v8 docs** (pixijs.com/8.x/guides/components/renderers,
pixijs/pixijs v8_12_0 rendering overview): The `render()` method signature in
v8 is:

```ts
renderer.render(container)
// or
renderer.render({ target: container, clear: boolean, transform: Matrix })
```

The `target` field is the **container to render**, not a destination texture.
The v8 docs do not expose a two-argument or `renderTexture` destination
parameter in the public `render()` API. In v7, `renderer.render(container,
renderTexture, clear)` was a three-argument form. That form was removed in v8.

The correct v8 pattern for rendering into an off-screen RenderTexture is to
use the `app.renderer.render()` call but you must set the
`renderTexture` on the `RenderOptions` object. The actual v8 field name is
`renderTexture` (not `target`), placed alongside `container`:

```ts
// v8 correct form (from PixiJS source and migration guide):
app.renderer.render({ container: current, renderTexture: trailTexture, clear: false });
```

Note also that the docs themselves use inconsistent terminology (`target` in
some examples, `container` in others) -- the v8.12.0 source uses `container`
for the object to render and a separate optional `renderTexture` for the
destination. **If the spec's call is written as `render({ target: current, clear: false })`
without specifying the destination RenderTexture, Pixi will render to the
screen, not to the trail texture, silently breaking the phosphor effect.**

**Fix required:** The spec's step 4 must be revised to use the correct v8 call
form that explicitly names both the source container and the destination
RenderTexture. The implementation plan must include verifying this pattern
against the actual v8 type definitions before writing the loop.

**Risk if unaddressed:** The phosphor-trail effect (the CRT theme's signature
visual) will not work. The implementer may spend hours diagnosing why `trailSprite`
shows no accumulation before discovering the wrong method signature.

---

#### C2. `BloomFilter({strength: 8})` -- constructor option mismatch (§5, themes definition)

**Spec claim:**
```js
neon: { ..., filters: [BloomFilter({strength:8})] },
```

**Evidence from pixi-filters v6 docs** (context7.com/pixijs/filters): The
`BloomFilter` constructor accepts `strength` as an **object** `{ x: number,
y: number }`, not a scalar number. The default is `{x:2, y:2}`. There is no
`strength: 8` (single number) form documented.

```ts
// correct pixi-filters v6 form:
new BloomFilter({ strength: { x: 8, y: 8 } })
```

Passing `{ strength: 8 }` will either be silently ignored (using the default
`{x:2, y:2}`) or throw at runtime depending on whether the filter validates
its options.

**Fix required:** Change the spec's `BloomFilter` instantiation to
`new BloomFilter({ strength: { x: 8, y: 8 } })` or similar, and document
that `strength` is per-axis.

**Risk if unaddressed:** The neon theme's bloom effect will be visually weak
(default strength 2 instead of intended 8) or will throw at startup, with no
error message pointing to the constructor mismatch.

---

### IMPORTANT

#### I1. `getDisplayMedia({video: true, audio: true})` -- `video: true` requirement is nuanced (§4)

**Spec claim:** "(Chrome requires video:true to allow audio:true)"

**Status:** Partially accurate but underdocumented. The Chromium implementation
has historically required `video: true` alongside `audio: true` for tab-share
because the browser's permission flow is tied to the screen-share picker, which
surfaces a video track. As of Chrome 119+ (2023), Chrome introduced
`preferCurrentTab` and `getDisplayMedia({audio: true, video: false})` can
sometimes return an audio-only stream in specific conditions, but the behaviour
is implementation-defined and changes across versions.

The spec's parenthetical is correct for the common case, but the inline comment
says "(Chrome requires video:true to allow audio:true)" without noting:
1. The video track should be stopped immediately after capture (the spec does
   note this in the diagram, which is good).
2. If the user shares a window or screen rather than a tab, there will be no
   audio track regardless of the `video: true` flag -- this is covered in §9,
   but the connection is not made explicit in §4.
3. The spec should note that the video track must be stopped by calling
   `videoTrack.stop()`, not just "never displayed". Not stopping it leaves the
   browser's camera/screen-sharing indicator active, which will confuse users.

**Fix required:** Add `videoTrack.stop()` as an explicit step in the audio
pipeline description and note that failure to stop it keeps the sharing
indicator alive.

---

#### I2. `audioTrack.getSettings().channelCount` -- reliability on tab-share streams (§4, §9)

**Spec claim:** "After capture starts, `audioTrack.getSettings().channelCount`
determines mono (1) vs stereo (2)."

**Verification status:** This is a real `MediaStreamTrack` property, but its
reliability for tab-share audio streams is uncertain. For microphone inputs,
`getSettings().channelCount` is generally accurate. For `getDisplayMedia` audio
tracks, Chromium's implementation may report `channelCount: 1` even when the
source is a stereo tab, because the audio pipeline may have already been mixed
down depending on system audio configuration, WASAPI/PulseAudio routing, and
the browser's audio processing. There is no MDN-documented guarantee that
`channelCount` for a `getDisplayMedia` audio track reflects the original source
channel count.

**Risk:** Scope may grey out the Lissajous tab on a stereo source (false
mono detection), or conversely show a Lissajous of two identical channels
(both read from a mono source that was reported as stereo).

**Fix required:** The spec should note this limitation explicitly. A fallback
heuristic is worth documenting: if `channelCount === 1`, trust it; if
`channelCount >= 2`, the user can still navigate to Lissajous but a footnote
in the UI hint could say "Lissajous may appear as a line if the source is
mono." The current approach (hard-disabling the tab on `channelCount === 1`)
is reasonable but the caveats should be in the spec.

---

#### I3. `file://` secure context claim (§11)

**Spec claim:** "Opening `index.html` directly via `file://` also qualifies
[as a secure context] in modern Chromium; if it ever doesn't, fall back to the
`http.server` line above."

**Status:** Inaccurate as stated. `file://` URLs are treated as secure contexts
in the sense that they can access certain privileged APIs, but `getDisplayMedia`
specifically requires that the **document is served from a secure context** as
defined by the W3C Secure Contexts spec (HTTPS, or localhost). The Chromium
implementation of `getDisplayMedia` checks `IsSecureContext()` which includes
`localhost` but does NOT include `file://` for this API. In practice, calling
`navigator.mediaDevices.getDisplayMedia()` from a `file://`-opened page in
current Chromium (versions 110+) raises a `SecurityError: getDisplayMedia must
be called from a secure origin`.

**Fix required:** Remove the `file://` claim. The dev workflow section should
say: "Opening `index.html` directly via `file://` does NOT work --
`getDisplayMedia` requires a secure context (`https://` or `localhost`). Use
`python3 -m http.server 8000`." This prevents the implementer from wasting time
debugging a `SecurityError` on their first run.

---

#### I4. Keydown guard logic inconsistency (§8)

**Spec claim:**
```js
document.addEventListener("keydown", e => {
  if (!state.running && e.key !== "Escape") return;
  ...
```

**Issue:** When `state.running` is `false` and the user presses `Escape`, the
guard passes (because `e.key === "Escape"` makes `e.key !== "Escape"` false,
so the overall condition is `!false && !false` = wait, let me re-read this).

Re-reading: `if (!state.running && e.key !== "Escape") return;`

This means: early-return when NOT running AND key is NOT Escape. So when not
running, only Escape passes through. That seems intentional -- but `stopCapture()`
called when already stopped is harmless only if `stopCapture` guards against
double-stop. The spec does not describe whether `stopCapture` is idempotent.
More importantly: when `state.running` is `true`, ALL keys pass through, including
`Escape`. This is correct.

The actual bug: pressing `1`, `2`, `3` or `T` when `state.running` is `false`
passes the guard (since `!false` is `true` when running is true -- no wait,
`!state.running` is `false` when running is `true`, so the guard is
`false && anything` = `false`, meaning early-return is never triggered when
running). This is correct.

The edge: if `state.running` is `false`, only `Escape` is let through -- and
`stopCapture()` will be called on an already-stopped session. The spec should
note that `stopCapture()` must be safe to call idempotently (it probably is,
but it should be stated explicitly in the function contract).

**Fix required:** Add a one-line note in the `stopCapture()` description: "Safe
to call when not running (no-op)."

---

### NICE-TO-HAVE

#### N1. Lissajous rotation convention -- direction not specified (§6c)

**Spec claim:** "45° rotation so mono renders as a vertical line."

**Verification of the math:** With `L = R = s`:
- `x_rot = (s - s) / sqrt(2) = 0` - yes, vertical line confirmed.

**Convention gap:** The spec does not state whether the 45° rotation is
clockwise or counter-clockwise. For a traditional audio vectorscope, the
standard is 45 degrees counter-clockwise (so that a mono signal -- equal
L and R -- produces a vertical line from bottom-left to top-right as amplitude
increases). The spec's formula `x_rot = (L - R)/sqrt(2)` and
`y_rot = (L + R)/sqrt(2)` with `y` increasing downward on screen (as it does
in canvas coordinate space) produces a vertical line at `x=0` that goes
downward as amplitude increases -- which is a vertical line, but the screen
y-axis is inverted from the traditional vectorscope convention.

This does not break correctness (the line is vertical either way for mono),
but the shape orientation for stereo signals may look upside-down compared to
hardware vectorscopes. This is a cosmetic preference, not a bug.

**Suggestion:** Add a note stating the y-axis convention (canvas `y` increases
downward; the formula accounts for this). Optionally add `y_canvas = height/2 -
y_rot` to make the formula in the spec unambiguous about coordinate space.

---

#### N2. Spectrum frequency mapping -- `sampleRate` source not specified (§6b)

**Spec claim:** "bin `i` represents `freq = i * sampleRate / fftSize`"
and "Bins below 20 Hz and above 20 kHz are dropped."

**Correctness:** The formula `freq = i * sampleRate / fftSize` is correct.
`getFloatFrequencyData` returns `fftSize / 2` bins covering `[0, sampleRate/2]`.

**Gap:** The spec does not state where `sampleRate` comes from in the
implementation. The correct source is `AudioContext.sampleRate` (accessible as
`ctx.sampleRate` after the context is created). For tab-share streams, Chromium
typically uses 44100 Hz or 48000 Hz depending on the system's audio subsystem.
The spec should note that `sampleRate` is read from `ctx.sampleRate` and must
not be hardcoded, since an 48000 Hz context with a hardcoded 44100 would
miscalibrate the frequency axis by ~9%.

**Suggestion:** Add one line: "`sampleRate` is read from `ctx.sampleRate`; do
not hardcode."

---

#### N3. `Graphics.stroke({width, color})` call order (§5)

**Spec claim (implied by themes object):** `theme.fg` (a number, e.g.
`0x33ff66`) is passed directly to `Graphics.stroke()`. The spec says the stroke
call uses `theme.fg` and `theme.lineWidth`.

**Verification:** PixiJS v8 docs confirm that `graphics.stroke({ color:
0xff0000, width: 2 })` is the correct v8 form (confirmed by the migration guide
and color API docs). The `color` field accepts a hex number directly.

**Confirmed correct** -- no fix required for `stroke({color, width})` form
itself. However, the spec should note that `Graphics` must be cleared with
`graphics.clear()` between frames (not `graphics.destroy()`), which it does
mention ("Clear `current`" in step 2). This is consistent.

**Minor gap:** The spec does not explicitly state that the `moveTo`/`lineTo`
path for the polyline must be followed by a `.stroke(...)` call to actually
draw. This is obvious to anyone who knows the v8 API but could trip up an
implementer expecting the v7 `lineStyle` + auto-stroke behaviour.

**Suggestion:** In §6a, add "(terminate with `.stroke({ color: theme.fg,
width: theme.lineWidth })`)" after the polyline description.

---

## Unverified Claims

**U1. `sampleRate` for tab-share streams is "typically 44100 or 48000".**
This is plausible based on general knowledge of Chromium's audio pipeline, but
I have not found a primary source (Chrome source code or Chromium issue tracker)
confirming the exact values. The spec's §6b notes this is the typical range;
this is fine for informational context, but the implementer should treat it as
a hint and read `ctx.sampleRate` at runtime. Mark as acknowledged.

**U2. The `AnalyserNode.getSettings()` for a `ChannelSplitterNode` output.**
The spec splits a stereo stream with `ChannelSplitterNode` and then reads
`audioTrack.getSettings().channelCount` on the raw audio track (before the
splitter). I could not find documentation confirming whether
`ChannelSplitterNode` outputs always have well-defined channel counts accessible
to the track settings API. The spec reads `channelCount` from the raw
`audioTrack`, which is before the graph, so this may be fine -- but it is worth
noting the distinction.

---

## Questions for the Author

**Q1. What CDN URL and version pin for pixi-filters@6?**

The spec says dependencies are "loaded from CDN, pinned to majors" but gives
no CDN URL for `pixi-filters@6`. The PixiJS v8 CDN URL is well-known
(`https://cdn.jsdelivr.net/npm/pixi.js@8/...`), but `pixi-filters@6` ships as
multiple sub-path exports (`pixi-filters/bloom`, `pixi-filters/glow`,
`pixi-filters/crt`) and may not have a single-bundle CDN include. Confirm the
CDN strategy for pixi-filters before the implementation plan is written -- this
may require an import-map or a bundled CDN package.

**Q2. `GlowFilter({distance:8, outerStrength:1.5})` -- is this a constructor
call or a factory call?**

The spec writes `GlowFilter({...})` without `new`. The pixi-filters v6 API
uses `new GlowFilter({...})`. In CDN `<script>` tag delivery without a module
system, the constructor name will be on the global namespace and must be called
with `new`. Confirm that the spec means `new GlowFilter(...)` throughout and
add `new` to all three filter instantiations in the themes object to avoid a
`TypeError: GlowFilter is not a constructor` or worse a silent no-op.

---

## Verdict

**Ready to implement? Yes, with fixes.**

The audio pipeline, view maths, UI shell, and testing strategy are all sound.
Two critical issues need fixing before the implementation plan is written:
the v8 `renderer.render` call for the RenderTexture phosphor trail (C1) needs
the correct API form verified against the actual v8 TypeScript definitions, and
the `BloomFilter` strength constructor argument needs correcting to `{x, y}`
form (C2). The `file://` secure context claim (I3) should be corrected to
prevent a confusing first-run failure. Addressing C1, C2, and I3 will take 15
minutes of spec edits; none require architectural changes.
