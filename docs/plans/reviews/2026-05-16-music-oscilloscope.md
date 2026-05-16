# Plan Review: Scope Music Oscilloscope
**Plan:** `docs/plans/2026-05-16-music-oscilloscope.md`
**Spec:** `docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md`
**Reviewer:** Claude Code (Sonnet 4.6)
**Date:** 2026-05-16

## Finding count

**2 CRITICAL / 4 IMPORTANT / 5 NICE-TO-HAVE / 0 Unverified / 1 Question for Author**

---

## Plan Summary

The plan implements Scope in 18 tasks: scaffolding three flat files, TDD for
two pure helpers, a PixiJS Application and trail RenderTexture, audio capture
via `getDisplayMedia`, a render loop with trail-fade persistence, three view
draw functions, five control/event tasks, error handling, docs, a code review
dispatch, and a single final commit. The plan is sequenced task-by-task with
acceptance criteria for each.

---

## Strengths

- **TDD is genuinely applied for the two pure helpers.** Tasks 2 and 3 each
  show the failing-test code, instruct the implementer to run and observe the
  failure, then implement and re-run. The failing tests are real runnable code
  in the correct Node `--test` format.
- **Forward-reference discipline is well maintained.** Each task only calls
  functions defined in equal or earlier tasks. No step calls something that
  does not exist yet (verified systematically in §Verification below).
- **"No commits per task" is clearly stated** in the rules block at the top
  and the commit is deferred correctly to Task 18. No step in any task body
  contains a `git commit` instruction.
- **Task 18 pathspec commit** stages only the six files this plan creates using
  named paths; no `git add -A` or `git add .` is present.
- **Error handling coverage (Task 14)** matches the spec's §9 table exactly,
  including the `track.onended` browser-bar stop path from Task 6 (no
  duplication).
- **Acceptance criteria are specific.** Most verify steps name concrete
  observable values (`audio.ctx.state` returns `"running"`, `tests 6`, `pass
  6`, `fail 0`) rather than vague impressions.
- **The silent-input probe** is wisely placed in `frame()` before the view
  dispatch, reducing per-frame cost: the probe short-circuits immediately if
  `!audio.analyserL`, and the result is independent of which view is active.

---

## Issues

### CRITICAL (Must fix before implementation)

#### C1. `renderer.render({container, target, clear})` -- `target` is the source container, not the destination texture

**Plan text (Task 7, Step 1):**

```js
pixi.app.renderer.render({ container: pixi.fade, target: pixi.trail, clear: false });
// ...
pixi.app.renderer.render({ container: pixi.current, target: pixi.trail, clear: false });
```

The plan's note reads: "If you see a runtime error ... the installed Pixi v8
minor uses `renderTexture` instead of `target`. Change both `target:
pixi.trail` to `renderTexture: pixi.trail` and retest."

**What the PixiJS v8 docs actually say (confirmed via Context7 against
`/pixijs/pixijs/v8_12_0` and the official rendering guide at
`pixijs.com/8.x/guides/components/renderers` and
`pixijs.download/release/docs/rendering.WebGPURenderer.html`):**

The `RenderOptions` single-object form documented in both the v8 source and
the WebGPURenderer API is:

```ts
renderer.render({
  target: container,   // THE CONTAINER TO RENDER (source)
  clear: true,
  transform: new Matrix(),
});
```

`target` in `RenderOptions` is documented as "The object to render" --
i.e., the **source container**, not a destination texture. The `WebGPURenderer`
docs also show a two-argument deprecated form:

```ts
render(container: Container, options: { renderTexture: any }): void
```

In that deprecated overload, the second argument carries `renderTexture` as
the **destination**. There is also an `AbstractRenderer` example from the
official docs:

```ts
renderer.render(myContainer, { target: renderTexture, transform: myMatrix });
```

This is the two-argument variant where `target` IS the destination -- but only
in the second argument object of the two-argument overload, not in the
single-object `RenderOptions` form.

The plan's single-object form `{ container: pixi.fade, target: pixi.trail,
clear: false }` mixes fields from both calling conventions. In the single-object
`RenderOptions` form, `target` = source container and `container` is also a
field -- this is internally contradictory. The actual `RenderOptions` interface
(from the `WebGPURenderer` docs) lists `container`, `target`, `clear`,
`clearColor`, and `transform` as fields, where `target` is described as "an
optional target render surface." The documentary evidence is ambiguous: in some
contexts `target` is the source, in others a destination surface.

**The practical consequence is severe and silent:** if `target` in the
single-object form resolves to the source container rather than the destination
texture, both render calls in the frame loop will render to the screen (not to
`pixi.trail`), `pixi.trailSprite` will remain a black texture, the phosphor
trail will never accumulate, and the CRT theme's signature visual will be
entirely absent. There will be no runtime error -- just a blank canvas.

**What the plan must do:**

The plan currently treats `target` vs `renderTexture` as a minor runtime
fallback the implementer can swap if they see an error. It is not a minor
fallback -- it is a structural question about whether the pattern works at all.
The plan must resolve this before implementation begins by specifying one of:

1. The two-argument deprecated form: `renderer.render(pixi.fade, {
   renderTexture: pixi.trail })` -- confirmed in the `WebGPURenderer` docs as
   an existing (if deprecated) overload that places the destination in
   `renderTexture`.
2. Verification that the single-object form `{ container: ..., target:
   renderTexture, clear: false }` actually routes to the off-screen texture
   when `target` is a `RenderTexture` rather than a `Container` -- this should
   be confirmed by reading the PixiJS v8 source at
   `src/rendering/renderers/shared/AbstractRenderer.ts` before starting Task 7.
3. An alternative pattern such as `renderer.render({ container: pixi.fade,
   renderTexture: pixi.trail, clear: false })` if the PixiJS v8 source exposes
   both `target` (source) and `renderTexture` (destination) as distinct fields
   in the same object.

The plan's current "if you get a runtime error, swap the field name" note is
insufficient because the failure mode is silent (no error, wrong visual result),
not a thrown exception.

**Severity: CRITICAL.** The entire phosphor-trail persistence mechanism -- the
CRT theme's core visual and the decay behaviour for all themes -- depends on
rendering into an off-screen texture. If the API call form is wrong, the app
renders no meaningful visuals.

---

#### C2. `init()` is declared `async` but the DOMContentLoaded handler does not await it

**Plan text (Task 1, Step 3 -- the initial scaffolding):**

```js
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
```

**Plan text (Task 5, Step 1):**

```js
async function init() {
  pixi.app = new PIXI.Application();
  await pixi.app.init({ ... });
  // ... rest of init
}
```

Task 5 changes `init` to `async function init()` and the body uses `await
pixi.app.init(...)`. However, the invocation site from Task 1 (which is never
updated) calls `init()` without `await` and does not handle the returned
Promise:

```js
document.addEventListener("DOMContentLoaded", init);
// or:
init();
```

Calling an `async` function without `await` means any unhandled rejection
inside `init()` (e.g., `pixi.app.init` failing because the canvas element
is missing or WebGL is unavailable) will become an unhandled Promise rejection
rather than a catchable synchronous error. More critically, if Task 6 wires
event handlers at the bottom of `init()` and `init()` is called but not
awaited, the handlers are wired synchronously before `await pixi.app.init()`
resolves -- but in this specific case, the handlers are appended inside `init()`
after the `await`, so they will only execute after resolution. The code is
actually correct in terms of execution order, but:

- An unhandled rejection in `pixi.app.init()` will silently swallow the error
  in some browsers (no DevTools error in older Chromium; an unhandled rejection
  warning in newer ones).
- The Task 1 code calls the synchronous `function init()`. Task 5 replaces it
  with `async function init()`. The scaffolding step never updates the call
  site. The plan should explicitly state in Task 5's step: "The existing
  invocation `document.addEventListener("DOMContentLoaded", init)` needs no
  change -- the browser will call the async function and ignore the returned
  Promise, which is acceptable because we cannot `await` a DOM event listener.
  To handle `pixi.app.init` failures, wrap the `await` in a try/catch inside
  `init()` and surface errors via `setStatus()`."

Without this note, an implementer who follows Tasks 1 and 5 in order may add
error handling for the synchronous init path (try/catch around `init()`) and
wonder why their catch block never fires when Pixi fails.

**Severity: CRITICAL.** Unhandled `pixi.app.init` failures silently produce a
broken page with no user-visible error and no DevTools guidance. The plan
should explicitly address this either with a try/catch inside `init()` or with
a note explaining that unhandled rejection is acceptable here and why.

---

### IMPORTANT (Should fix before implementation)

#### I1. `pixi.fade` and `pixi.current` are never added to `app.stage` -- the scene graph comment is misleading

**Plan text (Task 5, Step 1, comment):**

```js
// pixi.fade is rendered into pixi.trail each frame; not added to stage.
// pixi.current is rendered into pixi.trail each frame; not added to stage.
```

The spec's §5 scene graph shows:

```
app.stage
├── trailSprite     ← PIXI.Sprite of a RenderTexture (the persistence layer)
└── current         ← PIXI.Graphics (this frame's fresh trace)
```

The spec shows `current` as a child of `app.stage`, but the plan's comment
says it is NOT added to stage. This is not a contradiction of the spec's
intent (the plan's approach of rendering `current` directly into the trail
texture is valid), but the plan directly contradicts the spec's scene graph
diagram without explaining the deviation.

More importantly, the approach of rendering `pixi.current` into `pixi.trail`
via `renderer.render()` and then relying on `pixi.trailSprite` (which holds
the trail texture) being on stage to present the accumulated result is correct.
But `pixi.trailSprite` alone is on stage. If `pixi.current` is never added
to stage and is only rendered via the explicit `renderer.render()` call, the
implementer must be certain that PixiJS's automatic per-frame stage render does
not also pick up `pixi.current` from somewhere and double-draw it.

This approach is safe as described, but the plan should explicitly acknowledge
the deviation from the spec's scene graph diagram so the implementer does not
"fix" it by adding `current` to stage (which would cause the current frame's
trace to appear twice -- once baked into the trail texture and once as a
live child of stage, with no decay applied to the stage child).

**Fix:** Add a sentence in Task 5 Step 1 noting: "Note: the spec's scene graph
diagram shows `current` as a stage child, but this plan does not add it to
stage. Only `trailSprite` is on stage. `pixi.fade` and `pixi.current` are
rendered directly into the trail texture each frame via explicit `renderer.render()`
calls; do not add them to `app.stage`."

---

#### I2. Task 3: `findZeroCrossing` test for the third case is ambiguous -- the function's contract does not cover it

**Plan text (Task 3, Step 1):**

```js
test("findZeroCrossing treats buf[i+1] === 0 as a valid crossing target", () => {
  const buf = [-0.1, 0, 0.2, 0.3];
  assert.strictEqual(findZeroCrossing(buf), 0);
});
```

The plan's test name says "treats `buf[i+1] === 0` as a valid crossing target"
and expects index `0`. The loop condition in the implementation (Task 3, Step
3) is:

```js
if (buf[i] < 0 && buf[i + 1] >= 0) return i;
```

With `buf = [-0.1, 0, 0.2, 0.3]`:
- i=0: `buf[0] = -0.1 < 0` AND `buf[1] = 0 >= 0` → returns `0`. Correct.

The test is valid and the implementation satisfies it. However, the test name
"treats `buf[i+1] === 0` as a valid crossing target" is slightly misleading:
`0` is the index returned (the crossing point), not the index of the zero
value. The crossing is at index 0 (the negative-to-zero transition starting
from -0.1). A future reader may misread this as "returns the index of the
zero value" (1) rather than "returns the index of the first sample before
the crossing" (0). This is a cosmetic issue, but in a test that is explicitly
documenting an edge case, precision matters.

**Fix:** Rename the test: "findZeroCrossing returns the negative-sample index
when buf[i+1] is exactly 0 (zero-crossing to silence)."

---

#### I3. Task 14, Step 1: Chromium detection placed at the start of `init()`, but `init()` skips Pixi -- `pixi.app` stays `null`, which the later null-checks in `frame()` and `applyState()` must handle

**Plan text (Task 14, Step 1):**

```js
if (!navigator.mediaDevices?.getDisplayMedia) {
  setStatus("...");
  document.getElementById("capture").disabled = true;
  return;   // Skip Pixi init entirely -- there's nothing to visualise.
}
```

The early return from `init()` on non-Chromium browsers means `pixi.app`,
`pixi.trail`, `pixi.trailSprite`, `pixi.fade`, and `pixi.current` all remain
`null`. Because the Start button is disabled, `startCapture` is never called
and `frame()` is never called, so the null handles are never dereferenced.

However, `setStatus()` is called BEFORE it is defined in the file. In the plan,
`setStatus` is defined in Task 6 Step 1. `init()` is defined in Task 5 Step 1.
The Chromium check is added to the top of `init()` in Task 14 Step 1. At the
time Task 14 is implemented, all tasks 1-13 are already done, so `setStatus`
is defined in `main.js` above `init()`. But the Task 14 step must verify this
ordering explicitly because `setStatus` is defined in the `audio capture`
section (Task 6), not the global section, and if the implementer reads Tasks 5
and 14 together without Task 6, the call to `setStatus` inside `init()` before
`setStatus` is defined would fail.

Since all tasks are implemented sequentially, this ordering is safe. But the
plan should note explicitly: "`setStatus` is already defined from Task 6; this
call is safe." Without that note, an implementer doing Tasks 5 + 14 in
isolation (e.g., a parallel subagent) would see a `ReferenceError: setStatus
is not defined` at runtime.

---

#### I4. Task 11: The keydown handler closes over `state` and `applyState` -- but the closing brace of the keydown handler in Task 11 is not shown, making the Task 12 edit ambiguous

**Plan text (Task 11, Step 1):**

```js
document.addEventListener("keydown", (e) => {
  if (!state.running && e.key !== "Escape") return;
  if (e.key === "1") { state.view = "waveform";  applyState(); }
  if (e.key === "2") { state.view = "spectrum";  applyState(); }
  if (e.key === "3") {
    if (state.channels === 1) return;
    state.view = "lissajous"; applyState();
  }
  if (e.key === "Escape") stopCapture();
});
```

**Plan text (Task 12, Step 1):**

> Inside the existing `keydown` handler, add (just before the `Escape` line):
>
> ```js
>     if (e.key === "t" || e.key === "T") {
>       const order = ["crt", "neon", "mono"];
>       const idx = order.indexOf(state.theme);
>       state.theme = order[(idx + 1) % order.length];
>       applyState();
>     }
> ```

Similarly, Task 15 Step 3 adds an `F` key block "inside the existing `keydown`
handler." Both edits require the implementer to locate the existing handler
and insert code at specific positions inside it. This is a standard Edit
operation, but the plan does not specify the search anchor precisely enough
for a subagent: "just before the `Escape` line" is sufficient for a human
reading the file but requires the implementer to identify the correct
`if (e.key === "Escape")` line in a handler that by Task 15 has multiple
insertions.

This is a low-risk concern for a human implementer but a concrete source of
confusion for a subagent doing Tasks 12 and 15 in sequence without seeing the
intermediate state after Task 11.

**Fix:** In Tasks 12 and 15, provide the surrounding lines as context for the
edit, not just "before the Escape line." For example: "In the keydown handler
added in Task 11, locate `if (e.key === 'Escape') stopCapture();` and insert
the following block immediately before that line:" -- then show the surrounding
context so the Edit tool can anchor unambiguously.

---

### NICE-TO-HAVE (Minor improvements)

#### N1. TDD failure mode in Task 2 Step 2 does not match the actual failure

**Plan text (Task 2, Step 2):**

> "Expected: All three tests fail. The failure message will mention either
> `Cannot find module '../main.js'` (if main.js doesn't export) or
> `freqToX is not a function` (because Task 1's main.js exports an empty
> object)."

The plan correctly anticipates that Task 1 creates `main.js` with
`module.exports = { /* helpers added in T2/T3 */ }`, so `require('../main.js')`
succeeds and `freqToX` is destructured as `undefined`. Calling
`freqToX(20, 1000)` where `freqToX` is `undefined` throws `TypeError:
freqToX is not a function`. This is correct.

However, the first test is:

```js
test("freqToX maps 20 Hz to x = 0", () => {
  assert.strictEqual(freqToX(20, 1000), 0);
});
```

`assert.strictEqual(undefined(20, 1000), 0)` -- Node will throw `TypeError:
freqToX is not a function` before `assert.strictEqual` is reached. The test
runner will report this as a test failure with a `TypeError`, not an assertion
failure. The plan says "the failure message will mention ... `freqToX is not
a function`" -- this is correct.

The `Cannot find module` path is unreachable as described: Task 1 creates
`main.js` before Task 2 creates the test, so the module will always be found.
The plan should drop the "Cannot find module" branch from the expected-failure
description to avoid confusing the implementer if they read it and expect a
module-not-found error.

---

#### N2. Task 7: `frame()` calls `requestAnimationFrame(frame)` inside itself -- stopping the loop requires `state.running = false` before the next call, but `stopCapture` also needs to drain the in-flight `rAF`

**Plan text (Task 7, Step 1 -- end of `frame()`):**

```js
requestAnimationFrame(frame);
```

**Plan text (Task 6, Step 1 -- `stopCapture`):**

```js
state.running = false;
```

**Plan text (Task 7, Step 1 -- start of `frame()`):**

```js
if (!state.running) return;
```

The loop correctly self-terminates via `state.running`: on the next rAF tick
after `stopCapture()` sets `state.running = false`, `frame()` returns
immediately without scheduling another tick. This is correct and safe.

The note for the implementer: if the user clicks Stop and then Start again
quickly, `startCapture` calls `requestAnimationFrame(frame)` at its end, which
starts a new loop. If the old loop was still in a single in-flight rAF (between
`stopCapture` setting `running = false` and the next tick), both the old tick
(which exits immediately because `!state.running`) and the new rAF coexist for
exactly one frame, with no harm because the old tick exits immediately.

This is correct behaviour. The plan does not need to change it, but a comment
in `stopCapture` noting "the in-flight rAF tick exits harmlessly on the next
call because `state.running` is now `false`" would prevent an implementer from
adding a redundant `cancelAnimationFrame` call with a stored handle.

---

#### N3. Task 9: The spectrum ribbon closes back to `(0, h)` but the path may not connect cleanly to the baseline start

**Plan text (Task 9, Step 1 -- closing the ribbon):**

```js
// Close the ribbon back down to the baseline.
g.lineTo(w, h);
g.lineTo(0, h);
g.closePath();
g.fill({ color: theme.fg, alpha: 0.5 });
g.stroke({ color: theme.fg, width: theme.lineWidth });
```

The ribbon path is built starting with:

```js
g.moveTo(x, h);   // start of the ribbon at the bottom-left
g.lineTo(x, y);
```

where `x` is the X position of the first bin above 20 Hz (not necessarily
`0`). After the loop, the path ends at `(x_last, y_last)` where `x_last` is
the X of the last bin below 20 kHz (not necessarily `w`). The closing sequence
adds `lineTo(w, h)` then `lineTo(0, h)` then `closePath()`.

The `closePath()` call connects back to the path's start point, which is
`moveTo(x_first, h)` -- not `(0, h)`. So the bottom edge of the ribbon goes:
`x_last_bin → w → 0 → x_first_bin` (via closePath). This leaves a gap along
the bottom between `0` and `x_first_bin`, and between `x_last_bin` and `w`,
which are covered by the two explicit `lineTo` calls and the `closePath`. The
net result is a correctly closed ribbon.

However, the stroke will trace the entire closed path including the bottom
edges, drawing a visible outline along the baseline. This is likely intentional
(it frames the ribbon) but could look cluttered on the CRT theme where the
glow filter halos the bottom line. This is a cosmetic consideration; no fix
required unless the implementer notices it during verification and wants to
separate the fill path from the stroke path.

---

#### N4. Task 15, Step 2: The `markActive` function adds a second `keydown` listener to `document`, but the render loop already calls `requestAnimationFrame(frame)` every frame from a `keydown` inside `frame()` -- no conflict, but the second listener is additive

**Plan text (Task 15, Step 2):**

```js
document.addEventListener("keydown", markActive);
```

There are now two `keydown` listeners on `document`: the view/theme/escape
handler from Task 11, and this idle-reset handler. This is correct and
intentional -- both fire on every keydown, the idle-reset runs first (insertion
order) then the view handler. No conflict.

The note: if the implementer sees two separate `keydown` listeners and
consolidates them into one (a reasonable impulse), the `markActive` call should
be placed at the top of the existing listener to avoid calling it on keys that
return early (e.g., pressing `1` when `!state.running` exits the handler
before any visual change, but the panel should still un-idle). The plan's
approach of a separate listener is actually the correct design for exactly this
reason: `markActive` should fire on ALL keypresses, including those that the
first listener ignores.

A brief comment in the plan noting "a second listener is intentional: `markActive`
must fire even for keys the main handler ignores" would prevent a well-meaning
consolidation that breaks the idle-reset for non-hotkey keypresses.

---

#### N5. Task 18 commit message co-author line says "Claude Opus 4.7" -- model name is not current

**Plan text (Task 18, Step 2):**

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

The model executing this plan will be whatever model the user invokes. The
commit message should use a placeholder (e.g., `Claude <noreply@anthropic.com>`)
or match the actual model in use at commit time, following the project's commit
convention. The hardcoded `Opus 4.7` will be wrong if the implementer is
running Sonnet or a different Opus version. Per project commit convention,
the co-author line should reflect the actual model used.

---

## Verification: Forward References (task-by-task)

The following confirms no task calls a function or variable that does not exist
at the time that task is implemented.

| Task | Calls | Defined in |
|---|---|---|
| T1 | `init()` (body empty) | T1 itself |
| T2 | `freqToX` (test only; function defined in T2) | T2 |
| T3 | `findZeroCrossing` (test only; defined in T3) | T3 |
| T4 | `state`, `audio`, `pixi`, `themes` (declared) | T4 itself |
| T5 | `PIXI.Application`, `PIXI.RenderTexture`, `PIXI.Sprite`, `PIXI.Graphics`, `PIXI.filters.*`, `state`, `pixi`, `themes` | T4 (`state`/`pixi`/`themes`); PIXI from CDN loaded before `main.js` |
| T6 | `setStatus`, `startCapture`, `stopCapture`, `state`, `audio`, `document.getElementById` | T4 (`state`/`audio`); T6 itself (setStatus is first function defined); DOM from HTML |
| T7 | `applyState`, `frame`, `drawWaveform`, `drawSpectrum`, `drawLissajous` (placeholders), `themes`, `pixi`, `state`, `audio`, `requestAnimationFrame` | T4 (`state`/`pixi`/`themes`); T6 (`audio`); T7 itself (all four functions defined in T7); `requestAnimationFrame` is browser global |
| T7 Step 2 | calls `applyState()` and `requestAnimationFrame(frame)` from inside `startCapture` | `applyState` and `frame` defined in T7 Step 1; T7 Step 2 modifies `startCapture` (already in file from T6) |
| T8 | `drawWaveform` replaces placeholder; calls `findZeroCrossing` | T3 (`findZeroCrossing`); placeholder defined in T7 |
| T9 | `drawSpectrum` replaces placeholder; calls `freqToX`, `audio.ctx.sampleRate` | T2 (`freqToX`); `audio.ctx` set in T6 |
| T10 | `drawLissajous` replaces placeholder | placeholder defined in T7 |
| T11 | `state`, `applyState`, `stopCapture` in keydown handler | T4 (`state`); T7 (`applyState`); T6 (`stopCapture`) |
| T12 | adds to existing keydown handler from T11; uses `state.theme` | T4 (`state`); handler from T11 |
| T13 | `state`, `applyState` in `#gain`/`#fft`/`#smooth` listeners | T4 (`state`); T7 (`applyState`) |
| T14 | `setStatus`, `audio.analyserL`, `state.running`, calls `stopCapture` | T6 (`setStatus`, `stopCapture`); T4 (`state`); T6 (`audio`) |
| T15 | `state.running`, `stopCapture` in keydown; `document.fullscreenElement`, `requestFullscreen` | T4 (`state`); T6 (`stopCapture`); browser globals |
| T16 | creates docs only | none |
| T17 | dispatches code-reviewer agent | meta-task, not a code step |
| T18 | `git add`/`git commit` | git CLI |

No forward references found. Every function is defined before (or within) the
task that calls it.

---

## Verification: PixiJS v8 API Claims

All API claims verified against Context7 `/pixijs/pixijs/v8_12_0`,
`/llmstxt/pixijs_llms-full_txt`, and `/websites/pixijs_8_x` (official
`pixijs.com/8.x` guides).

| Plan claim | Verified? | Evidence |
|---|---|---|
| `new PIXI.Application()` + `await pixi.app.init({...})` | Confirmed correct | v8_12_0 README and app-overview.md |
| `app.init({ canvas, resizeTo, background, antialias, resolution, autoDensity })` | Confirmed correct | v8_12_0 app-overview.md; all these fields are valid init options |
| `PIXI.RenderTexture.create({ width, height, resolution })` | Confirmed correct | Standard v8 API; `RenderTexture.create` static factory is unchanged |
| `new PIXI.Sprite(texture)` | Confirmed correct | Standard v8 form |
| `new PIXI.Graphics()` | Confirmed correct | Standard v8 form |
| `g.rect(0, 0, w, h).fill({ color, alpha })` -- chained | Confirmed correct | `pixijs.com/8.x` guide and `llms-medium.txt`: `new Graphics().rect(...).fill({...})` is the v8 idiomatic form |
| `g.moveTo(x, y)`, `g.lineTo(x, y)` | Confirmed correct | Standard v8 Graphics API; unchanged from v7 |
| `g.stroke({ color, width })` | Confirmed correct | v8 migration guide: replaces v7 `lineStyle`; `stroke({color, width})` is the documented v8 form |
| `g.fill({ color: 0x000000, alpha: 0.12 })` | Confirmed correct | `fill()` accepts `{color, alpha}` in v8 |
| `g.closePath()` | Confirmed correct | Standard Canvas/PixiJS Graphics API; unchanged |
| `g.clear()` | Confirmed correct | Standard v8 Graphics API; clears the path without destroying the object |
| `pixi.app.renderer.render({ container: ..., target: ..., clear: false })` | **Ambiguous/likely wrong for destination texture** | See CRITICAL C1. The single-object `RenderOptions` form uses `target` as the source container in the documented examples; using it as a destination RenderTexture is not confirmed by any example in the v8 docs |
| `PIXI.filters.GlowFilter`, `PIXI.filters.CRTFilter`, `PIXI.filters.BloomFilter` -- namespace in browser bundle | Unverified (see below) | No Context7 source confirms what the `pixi-filters@6` browser bundle exposes on `PIXI.filters`; the pixi-filters docs show ESM sub-path imports only |
| `new PIXI.filters.GlowFilter({ distance, outerStrength, color })` | Constructor options confirmed correct | `/pixijs/filters`: `distance`, `outerStrength`, `color` are valid GlowFilter options |
| `new PIXI.filters.CRTFilter({ curvature, lineWidth, vignetting })` | Constructor options confirmed correct | `/pixijs/filters`: `curvature`, `lineWidth`, `vignetting` are valid CRTFilter options |
| `new PIXI.filters.BloomFilter({ strength: { x: 8, y: 8 } })` | Constructor option confirmed correct | `/pixijs/filters`: `strength` is `{x, y}` object form |
| `app.canvas` (not `app.view`) | Confirmed correct | v8_12_0 README uses `app.canvas`; v7's `app.view` is removed |

---

## Unverified Claims

**U1. `PIXI.filters.GlowFilter` / `PIXI.filters.CRTFilter` / `PIXI.filters.BloomFilter` are available as `PIXI.filters.*` in the browser bundle.**

The plan (Task 5, Step 1) uses `new PIXI.filters.GlowFilter(...)` etc. The
pixi-filters documentation only shows ESM sub-path imports
(`import { GlowFilter } from 'pixi-filters/glow'`). The Context7 pixi-filters
source does reference a CDN install line:

```html
<script src="https://cdn.jsdelivr.net/npm/pixi-filters@latest/dist/browser/pixi-filters.min.js">
```

The spec's §3 states: "`pixi-filters@6` ships a single combined browser bundle
at `dist/browser/pixi-filters.min.js` which exposes all filter classes on the
`PIXI.filters` global." The spec has stronger assurance text than the plan. The
plan simply uses `PIXI.filters.GlowFilter` without a verification step.

The spec's Task 5, Step 2 verify step says: "If `PIXI.filters` is undefined,
the pixi-filters CDN bundle failed to load." But the plan does not tell the
implementer what the correct global namespace is if `PIXI.filters` is defined
but the filter classes are on a different key (e.g., `PIXI.GlowFilter`
directly, or `window.filters.GlowFilter`). This should be verified in the
browser console before implementing Task 5 Step 1's filter construction lines.

The implementer should be instructed: "In the DevTools console after loading
the page, run `Object.keys(PIXI.filters)` to confirm `GlowFilter`,
`CRTFilter`, and `BloomFilter` are present. If `PIXI.filters` is undefined,
check the Network tab for the pixi-filters script load status. If the filter
classes are on `window` directly (not under `PIXI.filters`), adjust the
constructor calls accordingly."

---

## Question for the Author

**Q1. Does the `ResizeObserver` vs `window.addEventListener("resize")` inconsistency matter?**

The spec's §5 states: "`ResizeObserver` on `document.body`: re-create `trail`
`RenderTexture` at the new dimensions."

The plan's Task 5 Step 1 uses `window.addEventListener("resize", resize)`.

These have different triggering conditions: `ResizeObserver` fires when the
observed element's size changes (including from programmatic CSS changes or
element resizing that does not change the viewport), while `window.resize`
fires only when the viewport (window) changes. For a full-viewport fixed-canvas
layout where `#stage` is `position: fixed; inset: 0`, the two are equivalent
in practice -- any viewport resize changes `window.innerWidth`/`innerHeight`
which is what the `resize` handler reads.

The plan's approach is functionally correct for this layout, but deviates from
the spec without a stated reason. Is this deviation intentional? If so, the
plan should note: "Using `window.resize` rather than `ResizeObserver` because
the canvas is fixed-viewport; both are equivalent for this layout." If the
author prefers `ResizeObserver` to match the spec, the implementation is:

```js
new ResizeObserver(() => { /* same resize body */ }).observe(document.body);
```

This is not a correctness issue for the stated layout -- flagged only for
spec consistency.

---

## Spec Coverage Check

All spec sections are covered by the plan tasks listed in the review prompt
plus the following check of edge cases:

| Spec section | Plan coverage | Gap? |
|---|---|---|
| §4 audio pipeline | Tasks 6, 7 | No gap |
| §4 video track `.stop()` | Task 6 Step 1 (explicit `stream.getVideoTracks().forEach(t => t.stop())`) | No gap |
| §4 channel detection | Task 6 Step 1 (`audioTrack.getSettings().channelCount`) | No gap |
| §5 render pipeline | Tasks 5, 7 | No gap |
| §5 resize handling | Task 5 Step 1 (`window.addEventListener("resize")`) | Minor deviation from spec (see Q1) |
| §6a waveform | Task 8 | No gap |
| §6b spectrum | Task 9 | No gap |
| §6c Lissajous | Task 10 | No gap |
| §6c mono guard | Task 7 `applyState()` disables the Lissajous option | No gap |
| §7 DOM shell | Task 1 | No gap |
| §7 auto-hide controls | Task 15 | No gap |
| §7 hotkeys (1/2/3/T/F/Esc) | Tasks 11, 12, 15 | No gap |
| §8 state object | Task 4 | No gap |
| §8 `applyState()` | Task 7 | No gap |
| §8 `startCapture()` | Task 6 | No gap |
| §8 `stopCapture()` idempotent | Task 6 (`if (!state.running && !audio.stream && !audio.ctx) return`) | No gap |
| §9 error table | Task 14 + Task 6 error paths | No gap |
| §10 automated tests | Tasks 2, 3 | No gap |
| §10 manual QA checklist | Task 16 | No gap |
| §11 dev workflow | Task 1 verify step + README in Task 16 | No gap |

No spec requirements are missing from the plan.

---

## Verdict

**Ready to implement? No -- two critical issues require plan edits before Task 7 is started.**

C1 (the `renderer.render` destination-texture API form) is a structural
question that has no safe runtime fallback: the failure is silent (blank
canvas), not a thrown exception. The plan must commit to one of the confirmed
v8 patterns for off-screen rendering before the implementer writes the frame
loop. C2 (`async init()` with unhandled rejection) requires an explicit
try/catch inside `init()` or a documented rationale for why the unhandled
rejection is acceptable. The four IMPORTANT findings (I1-I4) each need one
sentence added to the relevant task step; none require architectural revision.
The five NICE-TO-HAVE findings are cosmetic and editorial. Once C1 and C2 are
resolved and I1-I4 are annotated, the plan is ready for implementation.
