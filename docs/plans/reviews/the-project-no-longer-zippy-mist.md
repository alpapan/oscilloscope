# Plan-reviewer report: the-project-no-longer-zippy-mist

Source plan: `/home/alexie/software/oscilloscope/docs/plans/the-project-no-longer-zippy-mist.md`
Reviewer: plan-reviewer subagent
Severity scale: CRITICAL / IMPORTANT / NICE-TO-HAVE / QUESTION

---

## Plan Summary

The plan proposes to fix a regression (solid-black visualisation after Start) introduced in commit `40a9bc2` by restoring three disabled features (mesh-warp, multi-offset stroke, BlurFilter) using TDD discipline. A Playwright canary test will bisect which feature is the root cause, a narrower diagnostic test will pin the precise PIXI v8 API misuse, then the fix will be applied and committed.

---

## Strengths

1. TDD approach is correct - failing tests first, observe failure, write minimum fix, re-run to green.
2. Canary design is well-motivated - `addInitScript` to stub `getDisplayMedia` with an oscillator + 1x1 video track is a valid browser-level integration test.
3. Bisection strategy is sound - three orthogonal features tested one at a time.
4. Playwright harness is minimal and correct.
5. Diagnostic tests are tight - each variant isolates one feature's API surface.
6. CLAUDE.md compliance on commits: pathspec form, one commit for the whole feature.

---

## Issues

### CRITICAL

**1. Canary does not confirm the app actually started before screenshotting (Task 2 Step 1).**
800 ms wait is conservative but does not prove `state.running` is true. If startup is gated by visibility or user-activation, the frame loop may never start.

**2. Canary threshold calibration is marked optional (Task 2 Step 3).**
Threshold is load-bearing; running the calibration once is cheap.

**3. Headless Chromium WebGL backend (ANGLE-on-SwiftShader) may not exercise the same shader path as Android WebView.**
The canary can pass on CI yet fail on the device. The plan acknowledges this in Task 7 (manual Android verification) but the canary's limitation should be flagged in test comments.

**4. Variant B diagnostic test may not detect the actual Graphics API misuse (Task 5 Variant B).**
If PIXI v8 re-strokes accumulated geometry, drawing 5 offset polylines plus 1 centred polyline could produce a thicker visible stroke OR a thinner one OR throw silently. Counting non-black pixels above 50 does not distinguish "5 strokes worked" from "1 stroke worked but path accumulated".

**5. Variant C does not check sprite position drift (Task 5 Variant C).**
The test reads `sprite.scale.x` and `sprite.rotation` but not `sprite.position`. If rotation accumulates (not just gets overwritten), the sprite could drift off-canvas without the scale going to zero.

### IMPORTANT

**6. Task 2 canary runs before Task 3 adds the try/catch wrapper - error visibility differs.**
Actually the wrapper is already in the working tree (visible in `git diff main.js`). Task 3 just keeps it. The plan should clarify this so the executor does not get confused.

**7. Task 1 Step 2 should clarify that npm install (Step 1) already updates devDependencies in package.json atomically.**
Step 2 only edits the `scripts` block.

**8. Task 4 bisection output does not capture per-step screenshots or status text.**
Add `screenshot: 'only-on-failure'` to playwright.config.js so each canary failure leaves a PNG that helps tell exception-failure from silent-failure apart.

**9. Variant B suggested fix mentions `g.closePath()` without verifying it exists in PIXI v8.**
The executor should grep `node_modules/pixi.js/lib/scene/graphics/shared/Graphics.mjs` for `closePath` before applying that fix.

**10. Commit message template at Task 6 Step 5 is a placeholder.**
Each variant should specify the exact commit message body.

**Inventory-test verification finding:** `tests/sync-www.test.js` filters `!name.endsWith(".test.js")` (line ~33) on root-directory `.js` files. `.spec.js` files live under `tests/`, not root, so they should not trigger the inventory check. Task 1 Step 4 should verify this explicitly rather than leaving it as a guess.

### NICE-TO-HAVE

**11. Task 2 Step 1 - `captureStream(30)` FPS justification.**
30 FPS on a 1x1 canvas is fine; a one-line comment explaining the choice helps future readers.

**12. Task 7 Step 2 APK path version `scope-0.3.0.apk` matches `package.json` version `0.3.0`. No issue.**

### UNVERIFIED CLAIMS

- Headless Chromium WebGL == Android WebView shader path. NOT VERIFIED.
- `window.MeshWarp` and `window.PaletteColor` available in test page. Need to confirm by reading script-load order in `index.html`.
- pixi-shim.js line 26 export is sufficient for tests using `window.PIXI.BlurFilter`. Likely yes (UMD global predates shim) but unverified.
- No startup gating in headless mode. UNVERIFIED.

### QUESTIONS FOR AUTHOR

1. Should the test use the ESM `BlurFilter` re-export or the UMD `window.PIXI.BlurFilter`?
2. Has PIXI v8 `Graphics.stroke()` semantics been confirmed against primary source?
3. Is the canary intended as a low-bar smoke test (with Task 7 doing the real device verification)?
4. Has the `addInitScript` stub of `getDisplayMedia` been tested in headless Chromium?

---

## Verification Summary

| Claim | Verified? |
|---|---|
| `#capture` exists in index.html (line 73) | YES |
| `#status` exists in index.html (line 74) | YES |
| `#stage` exists in index.html (line 25) | YES |
| `pixi-shim.js` re-exports `BlurFilter` (line 26) | YES |
| PIXI v8 UMD exposes `window.PIXI.BlurFilter` at top level | YES (bundle grep) |
| Working-tree diff has three disabled blocks | YES |
| `package.json` has no Playwright dep currently | YES |
| `playwright.config.js` does not exist | YES |
| `tests/render-canary.spec.js` does not exist | YES |
| `tests/sync-www.test.js` filter shape | YES (line ~33 filters `.test.js`) |

---

## CLAUDE.md Compliance Check

- No em-dashes in plan prose: PASS
- No performative apology language: PASS
- No `git checkout <path>` destructive use: PASS
- No `git add -A` / `git add .`: PASS
- No commit-per-task: PASS (one commit at end of Task 6)
- No internal-code mocks: PASS (`getDisplayMedia` is a platform boundary)
- TDD discipline: PASS for Tasks 2 and 5

---

## Verdict

**Yes, with fixes required.**

The plan is architecturally sound. TDD approach is correct, harness design is correct, bisection strategy will converge. The five CRITICAL issues plus the five IMPORTANT ones must be addressed before execution. Most are gaps in verification or unclear handoff, not flaws in the underlying approach.
