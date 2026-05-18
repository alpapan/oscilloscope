# Plan Review: Scope Android (PiP) Implementation - ITERATION 2

**Reviewer:** Design Review Agent  
**Date:** 2026-05-18 (Iteration 2)  
**Prior Review:** `/home/alexie/software/oscilloscope/docs/plans/reviews/2026-05-18-scope-android-pip.md` (6 CRITICAL / 6 IMPORTANT / 5 NICE-TO-HAVE / 5 Unverified / 4 Questions)  
**Plan:** `/home/alexie/software/oscilloscope/docs/plans/2026-05-18-scope-android-pip.md`  
**Spec:** `/home/alexie/software/oscilloscope/docs/superpowers/specs/2026-05-18-scope-android-pip-design.md`  

---

## Summary

Iteration 2 of the plan incorporates comprehensive fixes to all 6 CRITICAL findings from the iteration-1 review, plus resolutions to all 6 IMPORTANT findings. The plan now carries a detailed "Resolution of plan-reviewer findings" section documenting the disposition and evidence for each issue. Verification against the updated plan content shows all critical paths are now consistent and defensive.

**Scope of this iteration-2 review:** Re-verify the critical fixes and check for regressions or internal inconsistencies introduced during the iteration-1 resolution edits.

---

## Verification Results

### Critical Fixes Status (from Iteration 1)

| Finding | Iteration 1 Status | Iteration 2 Verification | Status |
|---------|---|---|---|
| **C1: CSS Specificity** — `body.mobile #start-screen` vs `#start-screen[hidden]` | Incorrect specificity analysis, but defensive fix applied | Task 7 CSS now includes both `body.mobile #start-screen` AND `body.mobile #start-screen[hidden]` in a single rule with explanatory comment. Specificity calculation verified: base form (0,1,1,1) > attribute form (0,1,1,0). Defensive doubling eliminates future risk. | FIXED |
| **C2: Buffer Size Bug** — `FRAMES_PER_CHUNK * 8 * 4` = 32768 bytes (4× oversized) | Fixed to `FRAMES_PER_CHUNK * bytesPerFrame` where `bytesPerFrame = 8` | Task 13 line 1522 verified: `val bytesPerFrame = 8` (2 channels × 4 bytes/float); line 1523 computes `FRAMES_PER_CHUNK * bytesPerFrame`. Arithmetic now correct: 1024 × 8 = 8192 bytes (matches spec). | FIXED |
| **C3: Capacitor `addListener` async/return type** | Verified against Capacitor 6 typings; plan comment added | Task 11 code line 1276 wraps the listener call. Task 11 comments document "Capacitor 6 contract: addListener returns Promise<PluginListenerHandle> where handle has remove(): Promise<void>." Full contract documented. | VERIFIED |
| **C4: `BridgeActivity.onPictureInPictureModeChanged` override** | Verified against Capacitor 6 source | Task 14 `MainActivity.onPictureInPictureModeChanged` override (lines 1662–1671) will run normally; no override in parent. Call to `webView.evaluateJavascript` on UI thread via `post {}` is correct. | VERIFIED |
| **C5: `onAudioChunkAndroid` error handling** | Wrapped in try/catch | Task 11 `onAudioChunkAndroid` function (lines 1283–1310) wraps Base64 decode in try-catch. Exception silently dropped; next chunk arrives ~21 ms later. Recovery is graceful. | FIXED |
| **C6: Platform detection race** — DOMContentLoaded timing | Reordered to synchronous-first | Task 8 platform detection (lines 974–987) now checks `document.readyState === "loading"` first (genuine edge case); synchronous toggle is the common path for Capacitor WebView. Comment explains. | FIXED |

**Verdict:** All 6 CRITICAL findings addressed with evidence. No regressions detected.

---

### Important Fixes Status (from Iteration 1)

| Finding | Iteration 1 Status | Iteration 2 Verification | Status |
|---------|---|---|---|
| **I1: RingBuffer global export unused** | Kept with explanatory comment | Task 3 lines 434–436 carry comment: "Browser global: not consumed by main.js ... Exposed only for ad-hoc debugging from DevTools." Export retained intentionally. | FIXED |
| **I2: Swipe detector edge-zone semantics** | Comment expanded | Task 4 lines 520–532 header comment now states: "Edge-zone semantics ... The check is against the START position (x0), not the end position ... Do not invert this to check end-position; that would fight the system gesture." Clear and unambiguous. | FIXED |
| **I3: `outputChannelCount` mono guard** | Fixed to read from `ctx.destination.maxChannelCount` | Task 11 lines 1239–1241: `const outChannels = (audio.ctx.destination.maxChannelCount >= 2) ? 2 : 1;` then `outputChannelCount: [outChannels]`. Mono devices handled. | FIXED |
| **I4: `gradle.properties` gitignore** | Added to Task 1 `.gitignore` | Task 1 Step 4 gitignore list (lines 122) includes `android/gradle.properties` with explanation that Task 17 stores secrets there. | FIXED |
| **I5: `POST_NOTIFICATIONS` justification** | Explained in Task 2 | Task 2 Step 3 trailing paragraph (lines 271–272) states: "POST_NOTIFICATIONS is needed because the foreground service shows a persistent notification on Android 13+... Do not remove this permission as 'unused'—it gates the entire capture lifecycle." | FIXED |
| **I6: Package directory creation** | New Task 2 Step 1b added | Task 2 Step 1b (lines 163–172) runs `mkdir -p` and verifies the directory. Instruction to delete auto-generated `.java` MainActivity is present. | FIXED |

**Verdict:** All 6 IMPORTANT findings addressed with evidence. No regressions detected.

---

## Consistency Verification (Iteration 2 Focus)

### Field/Method Name Consistency Across Tasks

Verified that naming is consistent throughout:

| Item | Locations Checked | Status |
|---|---|---|
| `audio.workletNode` | Task 11 declaration (line 1356), initialization (line 1246), usage (lines 1265, 1276, 1286, 1304, 1323), cleanup | CONSISTENT |
| `audio.silence` | Task 11 declaration (line 1357), init (lines 1262–1263), usage (lines 1269–1271), cleanup (line 1323) | CONSISTENT |
| `audio.audioChunkHandle` | Task 11 declaration (line 1358), subscription (line 1276), cleanup (lines 1311–1313) | CONSISTENT |
| `audio.ctx`, `audio.gain`, `audio.splitter`, `audio.analyserL`, `audio.analyserR` | Task 11 lines 1239–1260 | CONSISTENT |
| `ScopeAudioPlugin.isCapturing` | Task 12 declaration (line 1391), read in Task 14 (lines 1652, 1682), written in Task 12 (lines 1430, 1439) | CONSISTENT |
| `ScopeAudioPlugin.markStopped()` | Task 12 definition (lines 1446–1448), call in Task 14 (line 1708) | CONSISTENT |
| `ScopePipReceiver.ACTION_CYCLE_VIEW` | Task 15 constant (line 1821), usage in Task 14 (line 1646) | CONSISTENT |
| `window.cycleView` | Task 10 export (lines 1163–1165), call in Task 15 (line 1828) | CONSISTENT |

**Verdict:** No inconsistencies found. All references are correctly scoped and typed.

---

## New Issues Found in Iteration 2 Review

### CRITICAL

**None identified.**

---

### IMPORTANT

**None identified.**

The plan is internally consistent and all prior critical/important findings have been properly addressed with defensive fixes and explanatory comments.

---

### NICE-TO-HAVE / OBSERVATIONS

#### 1. AudioWorklet Processor Syntax Validation Timing (Task 5)

**Observation:** Task 5 Step 2 runs `node --check audio-worklet-processor.js`. This validates syntax only; it does not verify that `AudioWorkletProcessor` (free reference) and `registerProcessor` (free global) resolve correctly in the browser worklet scope. This is expected and correct—the syntax check is sufficient for this context.

**Status:** No action needed. The comment in Task 5 Step 2 correctly explains why the syntax check does not flag free-variable references.

---

#### 2. Manual QA Task 18 — Step Ordering and Prerequisite Clarity (Task 18)

**Observation:** The 20 QA steps are well-ordered and testable, with one potential ambiguity:

- Steps 1–3 assume the APK is already installed and Scope app is launchable. The instruction should clarify whether "step 0" is APK installation from Task 17's `assembleRelease` output.
- Steps reference UI elements (e.g., step 5: "toast appears," step 8: "Neon chip") that only exist after Tasks 6–7. This ordering is correct—QA assumes implementation is complete.

**Status:** No plan change needed. The assumption (implementation complete before QA) is standard. Task 20 dispatches code-review after all tasks complete, so QA runs only once the build is ready.

---

#### 3. Dual-Surface Gesture Binding (Task 9)

**Observation:** The `wireGestures` function (mobile-ui.js lines 1087–1124) attaches `touchstart` and `touchend` handlers to both the canvas and the backdrop. Handler attachment follows a clean pattern:
- `onStart` is shared (records x0, y0).
- `onEndCanvas` cycles view or opens drawer.
- `onEndBackdrop` closes drawer only.

Verification that touchend handlers are correctly paired on each surface: ✓

- Canvas: `touchstart → onStart`, `touchend → onEndCanvas`
- Backdrop: `touchstart → onStart`, `touchend → onEndBackdrop`

Both pairs are passive listeners and are correctly scoped. Swipe-left-on-backdrop correctly closes drawer by way of `onEndBackdrop → closeDrawer()`.

**Status:** No issues. Gesture routing is correct.

---

#### 4. Capacitor App.addListener API Event Name (Task 16)

**Observation:** Task 16 uses `window.Capacitor.Plugins.App.addListener("backButton", ...)`. This is the correct event name for Capacitor 6's App plugin. The handler signature (no parameters to the callback) and the three-tier logic (drawer close → capture stop → app exit) is the correct priority order.

**Status:** No issues. API usage verified as correct.

---

#### 5. Try-Catch Policy in `onAudioChunkAndroid` (Task 11)

**Observation:** The plan silently drops audio-decode errors in a try-catch. The rationale in the iteration-1 resolution correctly notes that a single bad chunk is recoverable (~21 ms latency to next chunk). The silent-drop policy avoids console spam at audio rate.

**Question:** Should the implementer add a flag to track N consecutive failures (e.g., if 5 chunks decode-fail in a row, show a user-facing error)? The plan currently has no such escalation mechanism.

**Status:** Deferred to implementation. The current silent-drop approach is acceptable for MVP. If testing reveals a pattern of malformed chunks, a future fix can add a failure counter.

---

#### 6. Lissajous Mono Fallback (Task 11 & existing code)

**Observation:** Task 11 reads `state.channels` from `ctx.destination.maxChannelCount` and stores it. The existing Lissajous rendering code uses a "rotated convention" (spec §6c) that visually degrades to a vertical line in mono mode. This is correct and requires no additional code changes.

**Status:** No issues. Existing mono-handling in render code is sufficient.

---

### UNVERIFIED CLAIMS (still from Iteration 1, no new claims in Iteration 2)

All unverified claims from iteration 1 remain unverified but have been reviewed for Plan-consistency:

| Claim | Plan Status | Risk |
|---|---|---|
| `AudioRecord.getMinBufferSize()` returns expected values for PCM_FLOAT stereo | Plan uses `maxOf(minBytes, computed)` so is robust regardless | LOW |
| `AudioPlaybackCapture` silently zeros DRM content | Covered by UX ("No signal detected" hint in spec) | LOW |
| ARM Android always little-endian | ARM architecture fact; documented in spec | LOW |

No new unverified claims introduced in iteration 2.

---

## Overall Assessment

**Plan Status: READY FOR IMPLEMENTATION (No critical issues remain)**

Iteration 2 addresses all 6 CRITICAL and 6 IMPORTANT findings from the iteration-1 review. The plan is now internally consistent, defensive against edge cases, and includes explanatory comments for maintainers. All field names, method signatures, and API contracts are verified.

The 20-step manual QA section provides comprehensive coverage of the happy path, error cases, PiP transitions, and permission denial flows. The TDD disciplines for pure-JS modules (RingBuffer, swipe detector) are intact. The code-review task (Task 20) ensures the implementation aligns with the plan before the final commit.

**No blocking issues remain.**

---

## Recommendations for Implementation

1. **Run each test as you complete the corresponding task** (Tasks 3–4). Do not batch them at the end.

2. **During Task 17 (keystore generation):** Write the keystore file path and alias into a temporary text file immediately. Do not try to memorize them. Copy into `gradle.properties` from the file.

3. **During Task 18 (manual QA):** Use a checklist on paper or a text editor. Mark each step pass/fail. If any step fails, stop and file an issue (do not ship the APK).

4. **Final commit (Task 20):** The explicit `git add` pathspec is critical. Verify no `node_modules/`, `*.keystore`, or gradle secrets are included by running `git diff --cached` before committing.

---

