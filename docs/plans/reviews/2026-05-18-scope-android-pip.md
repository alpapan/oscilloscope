# Plan Review: Scope Android (PiP) Implementation
## Scope Music Oscilloscope – Capacitor APK with System Audio Loopback

**Reviewer:** Design Review Agent  
**Date:** 2026-05-18  
**Plan:** `/home/alexie/software/oscilloscope/docs/plans/2026-05-18-scope-android-pip.md`  
**Spec:** `/home/alexie/software/oscilloscope/docs/superpowers/specs/2026-05-18-scope-android-pip-design.md`  

---

## Plan Summary

The plan packages the existing Scope music visualiser as a Capacitor 6 Android APK (targeting Android 14+ / API 34). A custom Kotlin plugin captures system audio via `AudioPlaybackCapture` + `AudioRecord`, batches 1024-stereo-frame chunks as Base64-encoded interleaved Float32, emits them as `audioChunk` events, and feeds them through a Web Audio `AudioWorkletNode` source into the unchanged analyser chain. Mobile UI adds swipe-based view cycling and a settings drawer. The activity auto-enters Picture-in-Picture on backgrounding with one RemoteAction button. Desktop browser build remains unbroken via platform detection. One commit per whole feature; subagents do not commit.

---

## Strengths

1. **Complete task enumeration** (Tasks 1-20): Every major component is mapped to explicit, sequenced tasks. File paths, code snippets, and expected outputs are named.

2. **TDD for pure-JS modules** (Tasks 3, 4): Ring buffer and swipe detector tests are included with failing-test-first protocol. Test cases are concrete and exercise real functionality (wrap-around reads, overflow drops, edge-zone dead band).

3. **Spec alignment**: The plan's file map (§Task 1) directly traces to the spec's architecture (§3), audio pipeline (§4), mobile UI (§7), PiP wiring (§9), and manifest/permissions (§10).

4. **Capacitor 6 API usage appears correct**: `@CapacitorPlugin`, `@PluginMethod`, `notifyListeners()`, `addListener()` return handle with `.remove()` method follow documented patterns. Plugin lifecycle (`load()`, `startActivityForResult()`, `@ActivityCallback`) is sound.

5. **Android 14 foreground-service requirement identified**: Task 13 (AudioCaptureService) includes `ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION` flag in `startForeground()` call, and Task 2 adds the manifest permission. Task 13 also registers `MediaProjection.Callback()` before using projection (Android 14 requirement).

6. **Endianness assumption stated and justified**: Plan uses `ByteOrder.LITTLE_ENDIAN` explicitly (Kotlin Task 13, line 1520), and Base64 encodes the bytes. Android ARM is guaranteed little-endian (modern Android standard), and JS side decodes identically.

7. **PiP CSS isolation correct**: `body.pip #mobile-start, body.pip #mobile-drawer, body.pip #mobile-toast { display: none !important; }` (Task 7) hides overlays in PiP. Activity's `onPictureInPictureModeChanged()` toggles the CSS class.

8. **Commit discipline enforced**: Plan states subagents do not commit; final Task 20 (code review) leads to one main-agent `git commit` with explicit file list and HEREDOC message.

9. **Manual QA section is comprehensive** (Task 18): 20 numbered steps cover happy path, error cases, PiP transitions, permission denial, DRM, and lifecycle edge cases.

---

## Issues

### CRITICAL (Must Fix Before Implementation)

#### 1. CSS Selector Specificity Contradiction — Task 7

**Location:** Plan Task 7 (CSS append), line 741.

**Problem:** The plan appends:
```css
body.mobile #start-screen { display: none; }
```

But the existing `style.css` (verified at line 41) already contains:
```css
#start-screen[hidden] { display: none; }
```

The plan's rule (`body.mobile #start-screen`) has *lower* specificity (1 class + 1 ID = 11 points) than the attribute selector `#start-screen[hidden]` (1 ID + 1 attribute = 101 points). When the desktop branch sets `document.getElementById("start-screen").hidden = true` (Task 10, Step 4 and existing code line 134), the `[hidden]` CSS rule wins, overriding the mobile class rule. **Result on Android desktop path:** the start screen remains hidden even when `PLATFORM === "android"` and the intent is to show the mobile variant.

**Evidence:**
- Existing CSS line 41: `#start-screen[hidden] { display: none; }`
- Plan CSS line 741: `body.mobile #start-screen { display: none; }`
- Existing main.js line 134: `document.getElementById("start-screen").hidden = true;`

**Fix:** Either:
- (Preferred) Change Plan Task 7 to use: `body.mobile #mobile-start { display: none; }` and `body.mobile #mobile-start[hidden] { display: none; }` — then in Task 10 Step 4, set `#mobile-start.hidden = true` instead of `#start-screen.hidden = true` on Android.
- (Alternative) Use `!important` to override the attribute selector: `body.mobile #start-screen { display: none !important; }` — but this breaks the CSS cascade and should be justified.
- (Cleanest) Modify the existing `#start-screen[hidden]` rule to respect the mobile mode: `#start-screen:not(.mobile)[hidden] { display: none; }`.

**Why it matters:** The mobile start screen will be invisible to the user even when it should be shown, blocking the capture flow on first launch.

---

#### 2. Kotlin `AudioCaptureService` Buffer Sizing Bug — Task 13

**Location:** Plan Task 13 (AudioCaptureService), lines 1503–1509.

**Problem:** The code computes:
```kotlin
val minBytes = AudioRecord.getMinBufferSize(...)
val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * 8 * 4)
```

With `FRAMES_PER_CHUNK = 1024` stereo frames:
- 1024 frames × 2 channels = 2048 floats
- 2048 floats × 4 bytes/float = 8192 bytes
- **Hardcoded multiplier:** `FRAMES_PER_CHUNK * 8 * 4 = 1024 * 8 * 4 = 32768`

The line should be:
```kotlin
val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * 2 * 4)  // frames × channels × bytes/float
```

Or more clearly:
```kotlin
val bytesPerFrame = 8  // 2 channels × 4 bytes/float
val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * bytesPerFrame)
```

**Evidence:** Spec §4 states: "1024-stereo-frame chunks (= 2048 floats interleaved = 8192 bytes binary)". The plan line 1509 reads 32768 bytes (4× too large), starving the reader thread and introducing unnecessary latency.

**Fix:** Change line 1509 from:
```kotlin
val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * 8 * 4)
```
to:
```kotlin
val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * 2 * 4)  // stereo: 2 channels × 4 bytes/float
```

**Why it matters:** Oversized buffers cause jitter, delay, and increased memory pressure. The reader thread will buffer multiple chunks needlessly, causing latency in the visualisation response.

---

#### 3. Capacitor `addListener` Return Type / Removal Pattern Unverified — Task 11

**Location:** Plan Task 11 (Android branch in main.js), line 1236.

**Problem:** The plan writes:
```js
audio.audioChunkHandle = await plugin.addListener("audioChunk", onAudioChunkAndroid);
```

and later (Task 11 Step 2, stopCaptureAndroid):
```js
if (audio.audioChunkHandle && audio.audioChunkHandle.remove) {
  await audio.audioChunkHandle.remove();
  audio.audioChunkHandle = null;
}
```

**Unverified claim:** The `addListener()` method is documented (Capacitor Context7 docs confirm `notifyListeners` and `addListener` exist), but the plan assumes:
1. `addListener()` returns a handle with a `.remove()` method.
2. `.remove()` is an async function (awaited).
3. The handle object is always truthy after a successful subscription.

The Context7 docs show *Swift* examples (`self.notifyListeners(...)`) and generic JS listener patterns (`MyPlugin.addListener(...)`), but don't explicitly verify the return type or whether `.remove()` must be awaited.

**Evidence:** Context7 query returned: "The addListener method returns a handle that can be used to call remove() on." No mention of whether it's async.

**Fix:** Before implementation, verify via:
- Capacitor 6 source code or official docs
- Existing Capacitor plugin examples in the codebase
- A minimal test with a known Capacitor plugin (e.g., `App.addListener()`)

**Why it matters:** If `.remove()` is not async, the `await` will throw. If the return type differs (e.g., a subscription object without `.remove()`), cleanup fails, leaking listener callbacks.

---

#### 4. `onPictureInPictureModeChanged()` Override in BridgeActivity — Task 14

**Location:** Plan Task 14 (MainActivity), lines 1639–1648.

**Problem:** The plan overrides `onPictureInPictureModeChanged()` and calls:
```kotlin
bridge?.webView?.evaluateJavascript(js, null)
```

**Unverified claim:** That Capacitor's `BridgeActivity` (the parent class) does not already override this method or block custom overrides. If `BridgeActivity` overrides it without calling `super.onPictureInPictureModeChanged(...)`, the plan's override will never run (or its `super` call will be intercepted).

**Evidence:** The plan inherits from `BridgeActivity` but does not verify its method-resolution order or lifecycle hooks.

**Fix:** Before implementation, check:
- Capacitor 6 source: does `BridgeActivity` override `onPictureInPictureModeChanged`?
- If yes, does it call `super`?
- If not, is the method final or sealed?

**Why it matters:** The PiP CSS class toggle is critical to hiding UI overlays in PiP. If the override is not called, the drawer and toast remain visible in PiP, breaking the user experience.

---

#### 5. Missing Error Handling in `onAudioChunkAndroid` Base64 Decode — Task 11

**Location:** Plan Task 11, lines 1250–1254.

**Problem:** The code decodes Base64 unsafely:
```js
const bin = atob(event.data);
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
```

If `event.data` is not valid Base64 (malformed from Kotlin, or undefined), `atob()` throws a `SyntaxError` that will crash the event handler. No try-catch wraps the decode.

**Evidence:** Plan does not mention error handling for invalid PCM chunks.

**Fix:** Wrap the decode in a try-catch:
```js
function onAudioChunkAndroid(event) {
  if (!audio.workletNode || !event || !event.data) return;
  try {
    const bin = atob(event.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const interleaved = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    // ... rest of decode
  } catch (err) {
    console.error("Audio chunk decode failed:", err);
  }
}
```

**Why it matters:** A single bad chunk from the Kotlin side crashes the visualisation, killing the capture. The app becomes unresponsive.

---

#### 6. `PLATFORM` Detection Race Condition — Task 8

**Location:** Plan Task 8 (Platform detection), lines 928–950.

**Problem:** The code detects `PLATFORM` at module load time:
```js
const PLATFORM = (typeof window !== "undefined") ? detectPlatform() : "node";
```

But in Task 10 (init()), the Android branch does:
```js
document.body.classList.toggle("mobile", PLATFORM === "android");
```

This assumes `PLATFORM` is already known and stable. However, if the script loads before `Capacitor` is available (even though Capacitor should inject its bridge before any app code runs), the detection will return `"desktop"` incorrectly.

Additionally, Task 8 adds an event listener for `DOMContentLoaded`, but in a typical Capacitor WebView, the HTML is already in the DOM before the main.js script runs. The event may have fired before the listener attaches.

**Evidence:** Plan lines 942–949 show both an event listener and an immediate-check fallback, indicating awareness of this edge case. But the comment says "if DOMContentLoaded already fired," which is the *likely* case, not the edge case.

**Fix:** Ensure the immediate check runs synchronously:
```js
if (document.readyState === "loading") {
  document.documentElement.addEventListener("DOMContentLoaded", () => {
    document.body.classList.toggle("mobile", PLATFORM === "android");
  }, { once: true });
} else {
  // DOMContentLoaded already fired.
  document.body.classList.toggle("mobile", PLATFORM === "android");
}
```

**Why it matters:** Timing bugs in platform detection cause the wrong CSS to apply, breaking the entire mobile UI.

---

### IMPORTANT (Should Fix Before Implementation)

#### 1. Missing RingBuffer Export for Browser Global — Task 3

**Location:** Plan Task 3, lines 413–418.

**Problem:** The `RingBuffer` class exports via both `module.exports` (Node) and `globalThis` (browser):
```js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { RingBuffer };
}
if (typeof globalThis !== "undefined") {
  globalThis.RingBuffer = RingBuffer;
}
```

But in Task 5 (AudioWorkletProcessor), the code defines a *duplicate* `RingBuffer` class inline (lines 568–611), because "the worklet global scope cannot import." This is correct for the worklet, but Task 11 (main.js) never checks whether `window.RingBuffer` is defined or uses it. The processor file is self-contained.

**Unverified claim:** That the browser export is actually used. The worklet has its own copy; the main thread doesn't instantiate RingBuffer.

**Evidence:** Task 6 (DOM elements) loads `audio-ring-buffer.js` before `main.js`, setting the global. But no code in the plan reads `window.RingBuffer` from main.js.

**Fix:** Either:
- Remove the globalThis export from Task 3 since it's not used (cleaner).
- Add a comment explaining it's for future extensibility or debugging.

**Why it matters:** Unused exports are technical debt and can be confusing during implementation.

---

#### 2. Swipe Detector Edge-Zone Semantics Unclear — Task 4

**Location:** Plan Task 4 (Swipe detector test), lines 474–481.

**Problem:** The test passes `{ x0, canvasWidth }` to `classifySwipe()`, representing the touch start position and canvas width. The edge-zone check (lines 512–514) is:
```js
if (opts.x0 < EDGE_DEAD_ZONE_PX) return "none";
if (opts.x0 > opts.canvasWidth - EDGE_DEAD_ZONE_PX) return "none";
```

This is correct, but the plan does not clarify in the main code or comments that:
- `x0` is the *touch start* X coordinate, not the swipe displacement.
- The dead zone applies to the start position, not the end position (i.e., back-gesture protection for swipes *starting* at the edge).

The test case (line 476) uses a near-left-edge swipe (x0=8 on 800-wide canvas), correctly returning "none". But Task 9 (mobile-ui.js, lines 1050–1072) wires this without that context:
```js
const dir = window.classifySwipe(x0, y0, dx, dy, {
  x0,
  canvasWidth: canvas.clientWidth,
});
```

This is correct, but maintainers may misread and think the edge zone protects the end position instead of the start.

**Fix:** Add a comment in the swipe-detector implementation (Task 4) explaining the semantics:
```js
// Edge swipes (from within EDGE_DEAD_ZONE_PX of left or right edge) return "none"
// so the system back-gesture wins. The check is against the _start_ position (x0),
// not the end position, because swiping from the edge (even to the middle) is
// typically an accidental back-gesture, not a deliberate view-cycle gesture.
```

**Why it matters:** Without the clarification, future edits may reverse the logic incorrectly (e.g., checking the end position instead).

---

#### 3. `AudioWorkletNode` Output Channel Count Assumption — Task 11

**Location:** Plan Task 11 (startCaptureAndroid), lines 1208–1212.

**Problem:** The code creates:
```js
audio.workletNode = new AudioWorkletNode(audio.ctx, "scope-processor", {
  numberOfInputs: 0,
  numberOfOutputs: 1,
  outputChannelCount: [2],
});
```

The plan assumes `outputChannelCount: [2]` will work on all Android devices. However, if the device's audio system is mono (rare, but possible on older or embedded hardware), this will fail or default to mono output from the worklet.

The spec (§4) mentions "Mono guard for the Lissajous tab" in the desktop code, but the Android path does not verify channel count at worklet construction time.

**Evidence:** Task 11 does not check `audio.ctx.destination.maxChannelCount` or handle the case where stereo is unavailable.

**Fix:** Add a channel-count check:
```js
const channels = audio.ctx.destination.maxChannelCount >= 2 ? 2 : 1;
audio.workletNode = new AudioWorkletNode(audio.ctx, "scope-processor", {
  numberOfInputs: 0,
  numberOfOutputs: 1,
  outputChannelCount: [channels],
});
```

And guard the stereo-only Lissajous view in `cycleView()` (Task 9 / Task 16):
```js
function cycleView(direction, state, applyState) {
  const i = VIEWS.indexOf(state.view);
  const next = (i + direction + VIEWS.length) % VIEWS.length;
  state.view = VIEWS[next];
  // Disable Lissajous if mono.
  if (state.view === "lissajous" && state.channels === 1) {
    state.view = (i + direction + 1 + VIEWS.length) % VIEWS.length;
  }
  applyState();
  showToast(VIEW_LABELS[state.view]);
}
```

**Why it matters:** A mono Android device will fail the AudioWorkletNode construction, crashing the capture flow.

---

#### 4. Missing `android/gradle.properties` Handling in `.gitignore` — Task 1

**Location:** Plan Task 1 (`.gitignore` append), lines 115–125.

**Problem:** The plan adds:
```
android/local.properties
*.keystore
*.jks
```

But does not explicitly add `android/gradle.properties` to `.gitignore`, even though Task 17 stores secrets in it:
```
SCOPE_KEYSTORE_PASSWORD=<filled at first build, kept locally>
SCOPE_KEY_PASSWORD=<filled at first build, kept locally>
```

If `android/gradle.properties` is not gitignored, the plan or implementer may accidentally commit passwords.

**Evidence:** Task 17 Step 2 says "this file is gitignored from Task 1," but Task 1's `.gitignore` snippet does not explicitly list `android/gradle.properties` or `gradle.properties`.

**Fix:** Add to Task 1 gitignore:
```
android/gradle.properties
gradle.properties
```

**Why it matters:** Accidentally committing keystore passwords is a security breach.

---

#### 5. `POST_NOTIFICATIONS` Permission Justification — Task 2

**Location:** Plan Task 2 (AndroidManifest.xml), line 207.

**Problem:** The plan adds `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` to the manifest but does not explain why in the main task. The comment in the manifest (line 253) mentions it's needed for Android 13+ foreground-service notifications, but the task body does not explain this dependency.

**Evidence:** The spec (§10) does not mention POST_NOTIFICATIONS; the AndroidManifest code in the spec uses RECORD_AUDIO, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PROJECTION, and INTERNET. The plan adds POST_NOTIFICATIONS without spec justification.

**Fix:** Add a note in Task 2 Step 3 comment:
```
/* POST_NOTIFICATIONS required on Android 13+ to display the foreground service
   notification that keeps the capture service alive. */
```

Or link to spec §8 (errors and edge cases) or the service implementation notes.

**Why it matters:** Without understanding why the permission is there, future maintainers may remove it as "unused," breaking foreground-service functionality on Android 13+.

---

#### 6. Missing `src/main/java` Directory Creation in Task 2 — Task 2

**Location:** Plan Task 2 (Add Android platform), after Step 1.

**Problem:** The plan runs `npx cap add android`, which generates the `android/` directory structure. However, Step 2 assumes `android/app/src/main/java/com/alpapan/scope/` exists when Tasks 12–15 create Kotlin files there. The `cap add android` command creates some Java files, but the plan does not verify the package structure matches `com.alpapan.scope`.

**Evidence:** The spec (§3) shows the intended structure, and the plan (§File map, lines 28–31) names the files with `com.alpapan.scope` package paths. But Task 2 does not confirm this directory exists after `cap add android`.

**Fix:** Add a Step after Task 2 Step 1:
```bash
cd /home/alexie/software/oscilloscope/android
mkdir -p app/src/main/java/com/alpapan/scope
```

Or verify that `capacitor.config.json` (Task 1, line 96: `appId: "com.alpapan.scope"`) causes `cap add android` to generate the correct package structure.

**Why it matters:** Without the directory, file creation in Tasks 12–15 will fail with "directory does not exist."

---

### NICE-TO-HAVE / SUGGESTIONS

#### 1. Test Coverage for `mobile-ui.js` Gesture Binding

The plan includes unit tests for `RingBuffer` and `classifySwipe` (pure functions), but `mobile-ui.js` (Task 9) is browser-only and not tested. Functions like `cycleView()`, `refreshDrawer()`, `wireGestures()` are integration-level and rely on DOM selectors.

**Suggestion:** Either add a note that these are manual-QA coverage only, or sketch a test harness (JSDOM or similar) for the drawer and toast functions.

---

#### 2. Capacitor `@ActivityCallback` Timing

Task 12 uses `@ActivityCallback` to handle the `startActivityForResult` return. The plan assumes the callback fires synchronously after the user grants/denies permission. In practice, there may be timing edge cases (user backgrounding the activity before responding).

**Suggestion:** Add a comment to Task 12 explaining the expected lifecycle:
```kotlin
// startActivityForResult() launches the system projection consent dialog.
// The user either grants (RESULT_OK) or denies (RESULT_CANCELED).
// The @ActivityCallback onProjectionResult() fires on the main thread
// when the user dismisses the dialog.
```

---

#### 3. Explicit Sample-Rate Fallback Path Documentation

Task 11 (startCaptureAndroid, lines 1203–1206) mentions sample-rate matching but does not implement the fallback to linear interpolation. The spec (§4) says "if the device refuses, we fall back to the device default and add a sample-rate-conversion stage in the worklet (linear interpolation; quality is adequate for visualisation)." But the plan does not code this fallback.

**Suggestion:** Document in Task 11 or the plan footer that sample-rate conversion is deferred to a future task or manual testing phase. Do not implement it in the initial submission, but flag it as a known limitation.

---

#### 4. `em-dash` Check in Plan Prose

The global CLAUDE.md rules forbid em dashes (U+2014) in prose. The plan uses hyphens and en dashes correctly, but the spec (e.g., line 8: "platform-specific") uses hyphens appropriately. **No em-dashes found**; the plan complies.

---

#### 5. Commits Should Use `git add --` Syntax

Task 20 Step 2 correctly uses `git add -- file1 file2 ...` (good). No issue here.

---

## Unverified Claims

1. **Capacitor `addListener()` is async and returns a removable handle** (Task 11, line 1236). Assumed from Capacitor Context7 docs, but not verified against Capacitor 6 source or existing plugin examples.

2. **`BridgeActivity.onPictureInPictureModeChanged()` is not overridden or sealed** (Task 14). The plan assumes the override will run; not verified.

3. **Android `AudioRecord` minimum buffer size for PCM_FLOAT stereo at 48 kHz** (Task 13). The plan computes `maxOf(minBytes, ...)`, but does not verify the minimum for the specific format. WebSearch confirmed PCM_FLOAT exists since API 21 but did not return a specific minimum buffer size for the exact format used.

4. **`AudioPlaybackCapture` silently returns zeros for DRM content** (spec §4, not plan-specific). Assumed from Android security model, not verified.

5. **ARM Android devices are always little-endian** (Task 11 assumes LITTLE_ENDIAN matches JS side). WebSearch confirmed modern Android (ARM) is little-endian, but edge cases (big-endian ARM or exotic platforms) are theoretically possible.

---

## Questions for the Author

1. **Task 11 / Capacitor addListener:** Has the implementer verified the exact return type and whether `.remove()` must be awaited? Can you provide a minimal test or reference to Capacitor 6 docs or source?

2. **Task 2 / Package structure:** Does `npx cap add android` with `appId: "com.alpapan.scope"` automatically create `android/app/src/main/java/com/alpapan/scope/` directory, or must it be created manually?

3. **Sample-rate conversion fallback:** Is the linear-interpolation fallback (spec §4) in scope for the initial implementation, or deferred? The plan does not code it.

4. **Test coverage for mobile-ui.js:** How will the drawer, toast, and gesture integration be tested beyond manual QA?

---

## Verdict

**Status: Yes, with critical fixes required before implementation.**

**Reasoning:**  

The plan is well-structured, comprehensive, and adheres to the spec. The TDD discipline for pure-JS modules is strong, and the Capacitor/Kotlin architecture is sound. However, **three critical issues must be fixed before implementation begins:**

1. **CSS selector specificity** (start-screen visibility) will break the mobile UI on first launch.
2. **Kotlin buffer-size computation** (32768 vs 8192 bytes) introduces unnecessary latency.
3. **Capacitor addListener pattern** must be verified against actual API to avoid event cleanup bugs.

All three are straightforward fixes; none require architectural rethinking. The IMPORTANT findings (missing RingBuffer export, edge-case documentation, channel-count guard, security of gradle.properties) should also be addressed before handoff to implementation to reduce friction during the build.

---

## Resolution Section (for main agent after addressing findings)

*This section will be populated by the main agent after incorporating all feedback and verifying fixes.*

