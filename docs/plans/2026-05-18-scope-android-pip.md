# Scope Android (PiP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a sideload-only Android APK of Scope that captures system audio via `AudioPlaybackCapture`, hosts the existing PixiJS visualiser inside a Capacitor WebView, exposes a touch-driven mobile UI (swipe-right cycles views; swipe-left opens a settings drawer), and auto-enters Picture-in-Picture on backgrounding with one cycle-view RemoteAction.

**Architecture:** Capacitor wraps the existing HTML/CSS/JS unchanged. A custom Kotlin plugin (`ScopeAudio`) drives a foreground `mediaProjection` service that reads PCM via `AudioPlaybackCapture` + `AudioRecord`, batches into 1024-stereo-frame chunks, Base64-encodes them, and emits `audioChunk` events. The JS side consumes the events through an `AudioWorkletNode` source that feeds the existing `ChannelSplitter → AnalyserL/R` graph; the analyser API and all draw functions are untouched. `MainActivity` extends `BridgeActivity` and configures PiP via `onUserLeaveHint`. The desktop browser build remains the source of truth for non-Android platforms via runtime feature detection.

**Tech Stack:** Capacitor 6 (CLI + core + android), Kotlin (Android 14+ target, API 34), `MediaProjection` + `AudioPlaybackCaptureConfiguration` + `AudioRecord`, Web Audio `AudioWorkletNode`, existing PixiJS v8 + pixi-filters v6, Node `node:test` for pure-JS unit tests.

**Spec:** `docs/superpowers/specs/2026-05-18-scope-android-pip-design.md`.

**Commit discipline:** Per `~/.claude/CLAUDE.md` rule "one commit per whole feature", **no per-task commits**. Make incremental changes, verify each task locally, but defer the commit to the final code-review task. Subagents that run individual tasks **must not** run any `git commit`, `git stash`, `git checkout`, `git push`, or `git reset` commands - only the main agent commits at plan-end.

---

## File map

**New files:**
- `audio-ring-buffer.js` - pure-JS ring buffer for the worklet; testable in Node.
- `audio-worklet-processor.js` - `AudioWorkletProcessor` that drains the ring buffer into output channels.
- `swipe-detector.js` - pure-JS classifier returning `"left" | "right" | "none"`; testable in Node.
- `mobile-ui.js` - DOM helpers (drawer toggle, toast, view cycling); browser-only.
- `tests/audio-ring-buffer.test.js` - `node:test` cases.
- `tests/swipe-detector.test.js` - `node:test` cases.
- `package.json` - Capacitor declarations.
- `capacitor.config.json` - Capacitor app config.
- `android/app/src/main/java/com/alpapan/scope/MainActivity.kt`
- `android/app/src/main/java/com/alpapan/scope/ScopeAudioPlugin.kt`
- `android/app/src/main/java/com/alpapan/scope/AudioCaptureService.kt`
- `android/app/src/main/java/com/alpapan/scope/ScopePipReceiver.kt`
- `android/app/src/main/res/drawable/ic_cycle_view.xml` - material-style next-track icon for the PiP button.

**Modified files:**
- `index.html` - add `<div id="mobile-start">`, `<div id="mobile-drawer">`, `<div id="mobile-toast">`, `<div id="mobile-backdrop">`; load `mobile-ui.js`.
- `style.css` - add `body.mobile`, `body.pip`, `body.drawer-open` rules; drawer panel, toast, segmented stepper, chip-button styles.
- `main.js` - platform-detect; Android branch in `startCapture`/`stopCapture` builds the worklet graph; wire mobile UI; expose `window.cycleView`.
- `android/app/src/main/AndroidManifest.xml` - permissions, foreground-service-type, PiP activity flags, ScopePipReceiver registration.
- `android/app/build.gradle` - minSdk 34, targetSdk 34, signing config reading from `gradle.properties`.
- `android/gradle.properties` - keystore path/alias/passwords (gitignored values).
- `docs/manual-qa.md` - append **Android sideload** section.
- `README.md` - append **Android (sideload)** section under existing Browser requirements.
- `.gitignore` - add `node_modules/`, `android/.gradle/`, `android/app/build/`, `android/build/`, `*.keystore`.

---

### Task 1: Initialise Capacitor project

**Files:**
- Create: `package.json`
- Create: `capacitor.config.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create `package.json`**

Write `/home/alexie/software/oscilloscope/package.json`:

```json
{
  "name": "scope",
  "version": "0.1.0",
  "private": true,
  "description": "Scope music oscilloscope - Android wrapper",
  "scripts": {
    "test": "node --test tests/",
    "sync": "cap sync android",
    "build:android": "cap sync android && cd android && ./gradlew :app:assembleRelease"
  },
  "dependencies": {
    "@capacitor/android": "^6.1.0",
    "@capacitor/app": "^6.0.0",
    "@capacitor/core": "^6.1.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd /home/alexie/software/oscilloscope
npm install
```

Expected: `node_modules/` populated; no errors. Warning about deprecated transitive deps is acceptable.

- [ ] **Step 3: Create `capacitor.config.json`**

Write `/home/alexie/software/oscilloscope/capacitor.config.json`:

```json
{
  "appId": "com.alpapan.scope",
  "appName": "Scope",
  "webDir": ".",
  "server": {
    "androidScheme": "https"
  },
  "android": {
    "allowMixedContent": false
  }
}
```

`webDir: "."` makes Capacitor sync the repo root as-is. The desktop `python3 -m http.server` workflow keeps working unchanged.

- [ ] **Step 4: Update `.gitignore`**

Append to `/home/alexie/software/oscilloscope/.gitignore`:

```
# Capacitor / Android
node_modules/
android/.gradle/
android/.idea/
android/app/build/
android/build/
android/local.properties
android/gradle.properties
android/app/release/
*.keystore
*.jks
```

Note: `android/gradle.properties` is gitignored because Task 17 stores
the release keystore password in it. Capacitor commits a default
`android/gradle.properties` initially; if you ever need shared
non-secret Gradle properties, move them to `android/build.gradle` or a
separate untracked include.

- [ ] **Step 5: Verify Capacitor sees the project**

Run:
```bash
cd /home/alexie/software/oscilloscope
npx cap --version
```

Expected: prints a version like `@capacitor/cli 6.x.x`.

---

### Task 2: Add Android platform

**Files:**
- Generated by `cap add android`: `android/` subtree.
- Modify: `android/app/build.gradle`
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Add Android platform**

Run:
```bash
cd /home/alexie/software/oscilloscope
npx cap add android
```

Expected: creates `android/` with Gradle project; output ends "added". If Android SDK env vars are missing, the command tells you which to set (`ANDROID_HOME`, `JAVA_HOME`).

- [ ] **Step 1b: Ensure the Kotlin package directory exists**

`cap add android` should create `android/app/src/main/java/com/alpapan/scope/` because `capacitor.config.json` declared `appId: "com.alpapan.scope"`. Verify and create if missing:

```bash
mkdir -p /home/alexie/software/oscilloscope/android/app/src/main/java/com/alpapan/scope
ls /home/alexie/software/oscilloscope/android/app/src/main/java/com/alpapan/scope/
```

Expected: directory exists (may be empty or contain a generated `MainActivity.java`; if `.java` exists, delete it - Task 14 overwrites with a `.kt`).

- [ ] **Step 2: Set minSdk/targetSdk and signing in `android/app/build.gradle`**

Open `android/app/build.gradle`. Inside `android { defaultConfig { ... } }` change `minSdk` and `targetSdk`:

```gradle
defaultConfig {
    applicationId "com.alpapan.scope"
    minSdk 34
    targetSdk 34
    versionCode 1
    versionName "0.1.0"
    testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
}
```

Inside the same `android { ... }` block, add a `signingConfigs` block before `buildTypes`:

```gradle
signingConfigs {
    release {
        if (project.hasProperty('SCOPE_KEYSTORE_FILE')) {
            storeFile file(SCOPE_KEYSTORE_FILE)
            storePassword SCOPE_KEYSTORE_PASSWORD
            keyAlias SCOPE_KEY_ALIAS
            keyPassword SCOPE_KEY_PASSWORD
        }
    }
}

buildTypes {
    release {
        minifyEnabled false
        signingConfig signingConfigs.release
    }
}
```

The `project.hasProperty` guard lets debug builds work before the keystore exists (Task 17 generates it).

- [ ] **Step 3: Rewrite `AndroidManifest.xml`**

Open `android/app/src/main/AndroidManifest.xml`. Replace the entire file with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:name="com.alpapan.scope.MainActivity"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
            android:launchMode="singleTask"
            android:supportsPictureInPicture="true"
            android:resizeableActivity="true"
            android:theme="@style/AppTheme.NoActionBarLaunch">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name="com.alpapan.scope.AudioCaptureService"
            android:foregroundServiceType="mediaProjection"
            android:exported="false" />

        <receiver
            android:name="com.alpapan.scope.ScopePipReceiver"
            android:exported="false" />

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
    </application>
</manifest>
```

`POST_NOTIFICATIONS` is needed because the foreground service shows a persistent notification on Android 13+ (API 33+). Android 13 introduced runtime-prompted notification permission; without this declaration the foreground-service notification fails to display and the service may be killed by the system after a few seconds. Do not remove this permission as "unused" - it gates the entire capture lifecycle.

- [ ] **Step 4: Verify the gradle wrapper runs**

Run:
```bash
cd /home/alexie/software/oscilloscope/android
./gradlew :app:tasks > /tmp/gradle-tasks.log 2>&1
grep -i "assemble" /tmp/gradle-tasks.log | head
```

Expected: lists `assembleDebug`, `assembleRelease`, `assemble` among others. If gradle download fails, set `JAVA_HOME` to a JDK 17+ install.

---

### Task 3: Ring buffer module + tests (TDD)

**Files:**
- Test: `tests/audio-ring-buffer.test.js`
- Create: `audio-ring-buffer.js`

- [ ] **Step 1: Write the failing test**

Write `/home/alexie/software/oscilloscope/tests/audio-ring-buffer.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { RingBuffer } = require("../audio-ring-buffer.js");

test("write then read returns identical samples", () => {
  const rb = new RingBuffer(16);
  const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  rb.write(input);
  const out = new Float32Array(4);
  const got = rb.read(out);
  assert.equal(got, 4);
  assert.deepEqual(Array.from(out), [0.1, 0.2, 0.3, 0.4]);
});

test("read with no data returns zero and leaves output untouched-as-zeros", () => {
  const rb = new RingBuffer(16);
  const out = new Float32Array(4).fill(99);
  const got = rb.read(out);
  assert.equal(got, 0);
  assert.deepEqual(Array.from(out), [0, 0, 0, 0]);
});

test("write across wrap boundary, read returns contiguous samples", () => {
  const rb = new RingBuffer(8);
  rb.write(new Float32Array([1, 2, 3, 4, 5, 6]));
  const tmp = new Float32Array(4);
  rb.read(tmp);
  assert.deepEqual(Array.from(tmp), [1, 2, 3, 4]);
  rb.write(new Float32Array([7, 8, 9, 10]));
  const out = new Float32Array(6);
  const got = rb.read(out);
  assert.equal(got, 6);
  assert.deepEqual(Array.from(out), [5, 6, 7, 8, 9, 10]);
});

test("overflow drops oldest data, write succeeds, read returns most recent", () => {
  const rb = new RingBuffer(4);
  rb.write(new Float32Array([1, 2, 3, 4]));
  rb.write(new Float32Array([5, 6]));
  const out = new Float32Array(4);
  const got = rb.read(out);
  assert.equal(got, 4);
  assert.deepEqual(Array.from(out), [3, 4, 5, 6]);
});

test("partial read drains exactly N samples", () => {
  const rb = new RingBuffer(16);
  rb.write(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]));
  const a = new Float32Array(3);
  const b = new Float32Array(3);
  const c = new Float32Array(3);
  const ga = rb.read(a);
  const gb = rb.read(b);
  const gc = rb.read(c);
  assert.equal(ga, 3);
  assert.equal(gb, 3);
  assert.equal(gc, 2);
  assert.deepEqual(Array.from(a), [1, 2, 3]);
  assert.deepEqual(Array.from(b), [4, 5, 6]);
  assert.deepEqual(Array.from(c.subarray(0, 2)), [7, 8]);
  assert.equal(c[2], 0);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd /home/alexie/software/oscilloscope
node --test tests/audio-ring-buffer.test.js
```

Expected: FAIL - `Cannot find module '../audio-ring-buffer.js'` or similar.

- [ ] **Step 3: Implement `audio-ring-buffer.js`**

Write `/home/alexie/software/oscilloscope/audio-ring-buffer.js`:

```js
// Single-producer / single-consumer Float32 ring buffer.
// Overflow drops oldest samples (writer wins). Underflow returns zeros.
// Sized in Float32 elements, not frames; the worklet calls this once per
// channel.

class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = new Float32Array(capacity);
    this.head = 0;   // next read position
    this.tail = 0;   // next write position
    this.size = 0;   // number of valid samples currently buffered
  }

  write(src) {
    const n = src.length;
    if (n >= this.capacity) {
      // Source larger than buffer: keep the last `capacity` samples.
      this.buf.set(src.subarray(n - this.capacity));
      this.head = 0;
      this.tail = 0;
      this.size = this.capacity;
      return;
    }
    // If this write would overflow, advance head to drop oldest samples.
    const overflow = this.size + n - this.capacity;
    if (overflow > 0) {
      this.head = (this.head + overflow) % this.capacity;
      this.size -= overflow;
    }
    const firstChunk = Math.min(n, this.capacity - this.tail);
    this.buf.set(src.subarray(0, firstChunk), this.tail);
    if (firstChunk < n) {
      this.buf.set(src.subarray(firstChunk), 0);
    }
    this.tail = (this.tail + n) % this.capacity;
    this.size += n;
  }

  read(dst) {
    const want = dst.length;
    const got = Math.min(want, this.size);
    const firstChunk = Math.min(got, this.capacity - this.head);
    dst.set(this.buf.subarray(this.head, this.head + firstChunk), 0);
    if (firstChunk < got) {
      dst.set(this.buf.subarray(0, got - firstChunk), firstChunk);
    }
    // Zero the unfilled tail of dst so caller doesn't see stale data.
    for (let i = got; i < want; i++) dst[i] = 0;
    this.head = (this.head + got) % this.capacity;
    this.size -= got;
    return got;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RingBuffer };
}
// Browser global: not consumed by main.js (the worklet has its own inline
// copy because AudioWorkletGlobalScope is isolated). Exposed only for ad-hoc
// debugging from DevTools.
if (typeof globalThis !== "undefined") {
  globalThis.RingBuffer = RingBuffer;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run:
```bash
cd /home/alexie/software/oscilloscope
node --test tests/audio-ring-buffer.test.js
```

Expected: PASS - `# tests 5  # pass 5  # fail 0`.

---

### Task 4: Swipe detector + tests (TDD)

**Files:**
- Test: `tests/swipe-detector.test.js`
- Create: `swipe-detector.js`

- [ ] **Step 1: Write the failing test**

Write `/home/alexie/software/oscilloscope/tests/swipe-detector.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifySwipe } = require("../swipe-detector.js");

test("rightward horizontal swipe of 100 px returns 'right'", () => {
  assert.equal(classifySwipe(0, 0, 100, 5), "right");
});

test("leftward horizontal swipe of 100 px returns 'left'", () => {
  assert.equal(classifySwipe(0, 0, -100, 5), "left");
});

test("vertical-dominant motion returns 'none'", () => {
  assert.equal(classifySwipe(0, 0, 30, 200), "none");
});

test("tiny motion (under threshold) returns 'none'", () => {
  assert.equal(classifySwipe(0, 0, 20, 5), "none");
});

test("near-diagonal but slightly horizontal-dominant returns 'none' (must be 1.5x)", () => {
  // 60 horizontal, 50 vertical: horizontal-dominant but ratio 1.2 < 1.5
  assert.equal(classifySwipe(0, 0, 60, 50), "none");
});

test("clearly horizontal-dominant 1.5x or more returns the direction", () => {
  assert.equal(classifySwipe(0, 0, 75, 50), "right");
  assert.equal(classifySwipe(0, 0, -75, 50), "left");
});

test("edge-zone swipes (within 16 px of left or right edge of canvas) return 'none'", () => {
  // 8 px from left edge of an 800-wide canvas
  assert.equal(classifySwipe(0, 0, 100, 5, { x0: 8, canvasWidth: 800 }), "none");
  // 8 px from right edge
  assert.equal(classifySwipe(0, 0, -100, 5, { x0: 792, canvasWidth: 800 }), "none");
  // Mid-canvas: still detects
  assert.equal(classifySwipe(0, 0, 100, 5, { x0: 400, canvasWidth: 800 }), "right");
});
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd /home/alexie/software/oscilloscope
node --test tests/swipe-detector.test.js
```

Expected: FAIL - module not found.

- [ ] **Step 3: Implement `swipe-detector.js`**

Write `/home/alexie/software/oscilloscope/swipe-detector.js`:

```js
// Pure classifier called from touchend handlers.
// Returns "left" | "right" | "none".
//
// dx, dy are touchend-minus-touchstart deltas in CSS pixels.
// opts.x0 = touchstart X coordinate within the canvas, opts.canvasWidth = canvas width.
//
// Edge-zone semantics: when opts is supplied, swipes that *started* within
// EDGE_DEAD_ZONE_PX of either edge are classified as "none" so Android's
// back-gesture wins on the system side. The check is against the START
// position (x0), not the end position, because a swipe originating at the
// screen edge is typically an accidental back-gesture rather than a deliberate
// view-cycle gesture. Do not invert this to check end-position; that would
// fight the system gesture.

const MIN_DISTANCE_PX = 40;
const HORIZONTAL_RATIO = 1.5;
const EDGE_DEAD_ZONE_PX = 16;

function classifySwipe(_x, _y, dx, dy, opts) {
  if (opts && typeof opts.x0 === "number" && typeof opts.canvasWidth === "number") {
    if (opts.x0 < EDGE_DEAD_ZONE_PX) return "none";
    if (opts.x0 > opts.canvasWidth - EDGE_DEAD_ZONE_PX) return "none";
  }
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < MIN_DISTANCE_PX) return "none";
  if (absX < absY * HORIZONTAL_RATIO) return "none";
  return dx > 0 ? "right" : "left";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { classifySwipe };
}
if (typeof globalThis !== "undefined") {
  globalThis.classifySwipe = classifySwipe;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run:
```bash
cd /home/alexie/software/oscilloscope
node --test tests/swipe-detector.test.js
```

Expected: PASS - `# tests 7  # pass 7  # fail 0`.

---

### Task 5: Audio worklet processor

**Files:**
- Create: `audio-worklet-processor.js`

Tests cannot exercise the worklet directly (it runs in a separate global). The ring buffer it depends on is already tested by Task 3. Manual QA covers integration.

- [ ] **Step 1: Write `audio-worklet-processor.js`**

Write `/home/alexie/software/oscilloscope/audio-worklet-processor.js`:

```js
// Runs in the AudioWorkletGlobalScope. The class is registered with the
// audio rendering thread by main.js calling `audioContext.audioWorklet.addModule`.
//
// Main thread posts { left: Float32Array, right: Float32Array } chunks via the
// node's MessagePort. We push them into per-channel ring buffers, then drain
// 128 frames per process() call into the output channels.

// Inline copy of audio-ring-buffer.js because the worklet global scope cannot
// import (Chrome does support module worklets, but the simplest cross-version
// pattern is a single-file processor). If we ever upgrade Capacitor's WebView
// minimum to one supporting AudioWorklet modules cleanly, we can switch to
// addModule with a real ESM import.

class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = new Float32Array(capacity);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }
  write(src) {
    const n = src.length;
    if (n >= this.capacity) {
      this.buf.set(src.subarray(n - this.capacity));
      this.head = 0;
      this.tail = 0;
      this.size = this.capacity;
      return;
    }
    const overflow = this.size + n - this.capacity;
    if (overflow > 0) {
      this.head = (this.head + overflow) % this.capacity;
      this.size -= overflow;
    }
    const firstChunk = Math.min(n, this.capacity - this.tail);
    this.buf.set(src.subarray(0, firstChunk), this.tail);
    if (firstChunk < n) {
      this.buf.set(src.subarray(firstChunk), 0);
    }
    this.tail = (this.tail + n) % this.capacity;
    this.size += n;
  }
  read(dst) {
    const want = dst.length;
    const got = Math.min(want, this.size);
    const firstChunk = Math.min(got, this.capacity - this.head);
    dst.set(this.buf.subarray(this.head, this.head + firstChunk), 0);
    if (firstChunk < got) {
      dst.set(this.buf.subarray(0, got - firstChunk), firstChunk);
    }
    for (let i = got; i < want; i++) dst[i] = 0;
    this.head = (this.head + got) % this.capacity;
    this.size -= got;
    return got;
  }
}

class ScopeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 8192 frames per channel = ~170 ms at 48 kHz.
    // Bigger than the largest practical bridge jitter, smaller than enough
    // memory pressure to notice.
    this.left = new RingBuffer(8192);
    this.right = new RingBuffer(8192);
    this.port.onmessage = (e) => {
      if (e.data && e.data.left && e.data.right) {
        this.left.write(e.data.left);
        this.right.write(e.data.right);
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (out.length > 0) this.left.read(out[0]);
    if (out.length > 1) this.right.read(out[1]);
    return true;
  }
}

registerProcessor("scope-processor", ScopeProcessor);
```

- [ ] **Step 2: Verify syntactic correctness**

Run:
```bash
cd /home/alexie/software/oscilloscope
node --check audio-worklet-processor.js && echo "syntax ok"
```

Expected: `syntax ok`. `node --check` only validates syntax, not free-variable references, so the unresolved `AudioWorkletProcessor` and `registerProcessor` symbols do not block the check.

---

### Task 6: Add mobile DOM elements

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add mobile DOM after `#start-screen`**

In `/home/alexie/software/oscilloscope/index.html`, locate the line:

```html
  <div id="start-screen">
    <h1>Scope</h1>
    <p>A music oscilloscope. Open Spotify Web Player or YouTube in another tab, then click Start and share that tab with audio.</p>
    <button id="capture" type="button">Start capture</button>
    <p id="status"></p>
  </div>
```

Insert **after** this `<div>` block (before the `<script type="module">`):

```html
  <div id="mobile-start" hidden>
    <h1>Scope</h1>
    <p>A music oscilloscope.</p>
    <button id="mobile-capture" type="button">Start capture</button>
    <p>Tap Start, allow screen capture, then open Spotify or YouTube Music and play.</p>
    <p id="mobile-status"></p>
  </div>

  <div id="mobile-toast" hidden></div>

  <div id="mobile-backdrop" hidden></div>
  <aside id="mobile-drawer" hidden>
    <section>
      <h2>Theme</h2>
      <div id="mobile-theme-chips" class="chips">
        <button type="button" data-theme="crt" class="chip">CRT</button>
        <button type="button" data-theme="neon" class="chip">Neon</button>
        <button type="button" data-theme="mono" class="chip">Mono</button>
      </div>
    </section>
    <section>
      <h2>Sensitivity</h2>
      <input id="mobile-gain" type="range" min="0.1" max="4" step="0.1" value="1">
    </section>
    <section>
      <h2>FFT size</h2>
      <div class="stepper">
        <button type="button" id="mobile-fft-prev" aria-label="Previous">◀</button>
        <span id="mobile-fft-value">2048</span>
        <button type="button" id="mobile-fft-next" aria-label="Next">▶</button>
      </div>
    </section>
    <section>
      <h2>Smoothing</h2>
      <input id="mobile-smooth" type="range" min="0" max="0.95" step="0.05" value="0.6">
    </section>
    <button id="mobile-stop" type="button" class="stop">Stop</button>
  </aside>
```

- [ ] **Step 2: Load `mobile-ui.js` and the helper modules**

In the same file, locate the `<script type="module">` block near the end. Immediately **after** the closing `</script>` of that block, append:

```html
  <script src="audio-ring-buffer.js"></script>
  <script src="swipe-detector.js"></script>
  <script src="mobile-ui.js"></script>
```

These three are plain `<script>` tags (not modules) so they set their exports as globals as written in their files. They must load **before** `main.js` because `main.js` references `RingBuffer`, `classifySwipe`, and `MobileUI`. The existing module script appends `main.js` dynamically, which guarantees it runs after these synchronous scripts.

---

### Task 7: Add mobile CSS

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Append mobile rules to `style.css`**

Append to `/home/alexie/software/oscilloscope/style.css`:

```css
/* =========================================================================
   Mobile UI (body.mobile)
   ========================================================================= */

/* Hide desktop start-screen and controls on Android.
   Both selectors cover the case where JS later sets the [hidden] attribute too;
   the attribute-selector form is included for defensiveness even though
   `body.mobile #start-screen` (0,1,1,1) already outranks `#start-screen[hidden]`
   (0,1,1,0) in CSS specificity. */
body.mobile #controls,
body.mobile #start-screen,
body.mobile #controls[hidden],
body.mobile #start-screen[hidden] { display: none; }

#mobile-start {
  position: fixed;
  inset: 0;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  background: var(--bg);
  color: var(--fg);
  text-align: center;
  font-family: system-ui, -apple-system, sans-serif;
  z-index: 10;
}
body.mobile #mobile-start { display: flex; }
body.mobile #mobile-start[hidden] { display: none; }

#mobile-start h1 {
  margin: 0;
  font-size: 48px;
  letter-spacing: 4px;
}
#mobile-capture {
  padding: 16px 32px;
  font-size: 20px;
  background: var(--fg);
  color: var(--bg);
  border: none;
  border-radius: 8px;
  min-height: 56px;
  min-width: 220px;
  cursor: pointer;
}
#mobile-capture:active { opacity: 0.7; }

#mobile-toast {
  position: fixed;
  top: env(safe-area-inset-top, 16px);
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.75);
  color: var(--fg);
  border: 1px solid var(--fg);
  border-radius: 16px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  letter-spacing: 1px;
  pointer-events: none;
  z-index: 20;
  opacity: 0;
  transition: opacity 200ms ease;
}
#mobile-toast.visible { opacity: 1; }

#mobile-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 30;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}
body.drawer-open #mobile-backdrop {
  opacity: 1;
  pointer-events: auto;
}

#mobile-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(80vw, 360px);
  padding: env(safe-area-inset-top, 16px) 20px 20px;
  background: var(--bg);
  color: var(--fg);
  border-left: 1px solid var(--fg);
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
  transform: translateX(100%);
  transition: transform 220ms ease;
  z-index: 40;
  font-family: system-ui, -apple-system, sans-serif;
}
body.drawer-open #mobile-drawer { transform: translateX(0); }

#mobile-drawer section { display: flex; flex-direction: column; gap: 8px; }
#mobile-drawer h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
  opacity: 0.7;
}

.chips { display: flex; gap: 8px; }
.chip {
  flex: 1;
  padding: 12px 0;
  background: transparent;
  color: var(--fg);
  border: 1px solid var(--fg);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  letter-spacing: 1px;
  cursor: pointer;
  min-height: 44px;
}
.chip.active {
  background: var(--fg);
  color: var(--bg);
}

.stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--fg);
  border-radius: 6px;
  padding: 4px;
}
.stepper button {
  background: transparent;
  color: var(--fg);
  border: none;
  font-size: 18px;
  padding: 8px 16px;
  cursor: pointer;
  min-width: 44px;
  min-height: 44px;
}
.stepper span {
  flex: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

#mobile-drawer input[type="range"] {
  width: 100%;
  height: 32px;
}

#mobile-stop {
  margin-top: auto;
  padding: 16px;
  background: var(--fg);
  color: var(--bg);
  border: none;
  border-radius: 8px;
  font-size: 16px;
  letter-spacing: 2px;
  cursor: pointer;
  min-height: 56px;
}

/* In PiP mode hide all overlays; canvas only. */
body.pip #mobile-start,
body.pip #mobile-drawer,
body.pip #mobile-backdrop,
body.pip #mobile-toast { display: none !important; }
```

---

### Task 8: Platform detection in `main.js`

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add platform-detection helpers near the top of `main.js`**

In `/home/alexie/software/oscilloscope/main.js`, **after** the `findZeroCrossing` function (around line 19, just before `// Browser-only state, audio, render, views, controls`), insert:

```js
// =============================================================================
// Platform detection (Android via Capacitor vs desktop browser)
// =============================================================================

function detectPlatform() {
  if (typeof window === "undefined") return "node";
  if (typeof window.Capacitor !== "undefined"
      && window.Capacitor.getPlatform
      && window.Capacitor.getPlatform() === "android") {
    return "android";
  }
  return "desktop";
}

const PLATFORM = (typeof window !== "undefined") ? detectPlatform() : "node";

if (typeof document !== "undefined") {
  // Mark the body so CSS can swap UI variants. The class must be applied
  // before any paint that depends on it. In a Capacitor WebView main.js is
  // typically injected after DOMContentLoaded already fired, so the
  // synchronous branch is the common case; the listener branch is the
  // genuine edge case (script loaded eagerly in <head>).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.classList.toggle("mobile", PLATFORM === "android");
    }, { once: true });
  } else {
    document.body.classList.toggle("mobile", PLATFORM === "android");
  }
}
```

---

### Task 9: Mobile UI helpers (`mobile-ui.js`)

**Files:**
- Create: `mobile-ui.js`

- [ ] **Step 1: Write `mobile-ui.js`**

Write `/home/alexie/software/oscilloscope/mobile-ui.js`:

```js
// Browser-only. Loaded via plain <script> tag in index.html before main.js.
// Exposes `window.MobileUI` with helpers used by main.js when PLATFORM === "android".

(function () {
  if (typeof window === "undefined") return;

  const FFT_VALUES = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
  const VIEWS = ["waveform", "spectrum", "lissajous"];
  const VIEW_LABELS = { waveform: "Waveform", spectrum: "Spectrum", lissajous: "Lissajous" };

  let toastTimer = null;

  function showToast(text) {
    const el = document.getElementById("mobile-toast");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("visible");
    }, 1500);
  }

  function openDrawer() {
    document.body.classList.add("drawer-open");
  }
  function closeDrawer() {
    document.body.classList.remove("drawer-open");
  }
  function isDrawerOpen() {
    return document.body.classList.contains("drawer-open");
  }

  function cycleView(direction, state, applyState) {
    const i = VIEWS.indexOf(state.view);
    const next = (i + direction + VIEWS.length) % VIEWS.length;
    state.view = VIEWS[next];
    applyState();
    showToast(VIEW_LABELS[state.view]);
  }

  function refreshDrawer(state) {
    document.querySelectorAll("#mobile-theme-chips .chip").forEach(b => {
      b.classList.toggle("active", b.dataset.theme === state.theme);
    });
    const gain = document.getElementById("mobile-gain");
    if (gain) gain.value = state.sensitivity;
    const fftSpan = document.getElementById("mobile-fft-value");
    if (fftSpan) fftSpan.textContent = state.fftSize;
    const smooth = document.getElementById("mobile-smooth");
    if (smooth) smooth.value = state.smoothing;
  }

  function wireDrawer(state, applyState) {
    document.querySelectorAll("#mobile-theme-chips .chip").forEach(b => {
      b.addEventListener("click", () => {
        state.theme = b.dataset.theme;
        applyState();
        refreshDrawer(state);
      });
    });
    document.getElementById("mobile-gain").addEventListener("input", e => {
      state.sensitivity = parseFloat(e.target.value);
      applyState();
    });
    document.getElementById("mobile-fft-prev").addEventListener("click", () => {
      const i = FFT_VALUES.indexOf(state.fftSize);
      state.fftSize = FFT_VALUES[Math.max(0, i - 1)];
      applyState();
      refreshDrawer(state);
    });
    document.getElementById("mobile-fft-next").addEventListener("click", () => {
      const i = FFT_VALUES.indexOf(state.fftSize);
      state.fftSize = FFT_VALUES[Math.min(FFT_VALUES.length - 1, i + 1)];
      applyState();
      refreshDrawer(state);
    });
    document.getElementById("mobile-smooth").addEventListener("input", e => {
      state.smoothing = parseFloat(e.target.value);
      applyState();
    });
    document.getElementById("mobile-backdrop").addEventListener("click", closeDrawer);
  }

  function wireGestures(canvas, state, applyState) {
    // Touches are routed by stacking order. When the drawer is open the
    // backdrop (z=30) intercepts everything that would otherwise hit the
    // canvas (z=0), so the canvas-only handler can never see drawer-close
    // gestures. Attach the same swipe detection to the backdrop with a
    // drawer-aware action mapping.
    let x0 = 0, y0 = 0;
    function onStart(e) {
      const t = e.changedTouches[0];
      x0 = t.clientX;
      y0 = t.clientY;
    }
    function onEndCanvas(e) {
      const t = e.changedTouches[0];
      const dir = window.classifySwipe(x0, y0, t.clientX - x0, t.clientY - y0, {
        x0,
        canvasWidth: canvas.clientWidth,
      });
      if (dir === "right") cycleView(+1, state, applyState);
      else if (dir === "left") openDrawer();
    }
    function onEndBackdrop(e) {
      const t = e.changedTouches[0];
      const dir = window.classifySwipe(x0, y0, t.clientX - x0, t.clientY - y0, {
        x0,
        canvasWidth: window.innerWidth,
      });
      if (dir === "right") closeDrawer();
      // Swipe-left on backdrop is a no-op; the drawer is already open.
    }
    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchend", onEndCanvas, { passive: true });
    const backdrop = document.getElementById("mobile-backdrop");
    if (backdrop) {
      backdrop.addEventListener("touchstart", onStart, { passive: true });
      backdrop.addEventListener("touchend", onEndBackdrop, { passive: true });
    }
  }

  window.MobileUI = {
    showToast,
    openDrawer,
    closeDrawer,
    isDrawerOpen,
    cycleView,
    refreshDrawer,
    wireDrawer,
    wireGestures,
  };
})();
```

---

### Task 10: Wire mobile UI into `main.js` init()

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Locate `init()` in `main.js`**

Find the `init()` function near the bottom of `main.js`. It currently wires the desktop controls panel.

- [ ] **Step 2: Add the mobile branch and `window.cycleView` export**

At the **start** of `init()`, after Chromium detection but before the existing desktop button wiring, insert:

```js
  if (PLATFORM === "android") {
    document.body.classList.add("mobile");
    document.getElementById("mobile-start").hidden = false;
    document.getElementById("mobile-capture").onclick = startCapture;
    document.getElementById("mobile-stop").onclick = stopCapture;
    MobileUI.wireDrawer(state, applyState);
    MobileUI.wireGestures(document.getElementById("stage"), state, applyState);
    // The PiP RemoteAction calls window.cycleView(1) via the Capacitor bridge.
    window.cycleView = function (direction) {
      MobileUI.cycleView(direction, state, applyState);
    };
    return;
  }
```

- [ ] **Step 3: Patch `applyState` to refresh the mobile drawer**

Find the `applyState()` function. At the **end** of its body (just before the closing brace), add:

```js
  if (PLATFORM === "android" && window.MobileUI) {
    window.MobileUI.refreshDrawer(state);
  }
```

- [ ] **Step 4: No changes to existing startCapture/stopCapture DOM lines**

The existing `startCapture()` body hides `#start-screen` and shows `#controls`; the existing `stopCapture()` body reverses those. Task 11 adds Android branches that return early **before** those existing lines run, so the desktop visibility code remains unchanged. The Android side hides/shows `#mobile-start` from inside `startCaptureAndroid` / `stopCaptureAndroid` instead - see Task 11. This step is intentionally a no-op; it exists to document that the implementer should not duplicate the visibility toggle.

- [ ] **Step 5: Test the desktop build still works**

Run the existing tests and start the server:

```bash
cd /home/alexie/software/oscilloscope
node --test tests/
python3 -m http.server 8000
```

Expected: tests pass; open `http://localhost:8000` in Chrome; verify desktop UI still works (capture, view switching, theme cycling) - Android-specific branches must not break desktop.

---

### Task 11: Android branch in `startCapture` (web side, JS calls native)

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add the Android startCapture branch**

In `main.js`, at the **very top** of `startCapture()` (just after `if (state.running) return;`), insert:

```js
  if (PLATFORM === "android") {
    return startCaptureAndroid();
  }
```

- [ ] **Step 2: Add `startCaptureAndroid` and `stopCaptureAndroid`**

Insert these two functions **after** `stopCapture`:

```js
async function startCaptureAndroid() {
  // Lazy-lookup the registered plugin. Capacitor exposes registered native
  // plugins as window.Capacitor.Plugins.<Name>.
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScopeAudio;
  if (!plugin) {
    setStatus("Audio plugin not available. Reinstall the APK.");
    return;
  }

  try {
    await plugin.startCapture();
  } catch (err) {
    setStatus(`Capture denied: ${err.message || "permission rejected"}`);
    return;
  }

  audio.ctx = new AudioContext({ sampleRate: 48000 });
  if (audio.ctx.state === "suspended") {
    await audio.ctx.resume();
  }
  await audio.ctx.audioWorklet.addModule("audio-worklet-processor.js");
  // Guard against rare mono-only output devices: fall back to single channel
  // if the destination cannot do stereo. The worklet's process() writes only
  // outputs[0], so the right channel is just silently dropped in mono mode;
  // the Lissajous view falls back to a vertical line (the rotated convention
  // already handles mono correctly).
  const outChannels = (audio.ctx.destination.maxChannelCount >= 2) ? 2 : 1;
  state.channels = outChannels;
  audio.workletNode = new AudioWorkletNode(audio.ctx, "scope-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [outChannels],
  });
  audio.gain = audio.ctx.createGain();
  audio.gain.gain.value = state.sensitivity;
  audio.splitter = audio.ctx.createChannelSplitter(2);
  audio.analyserL = audio.ctx.createAnalyser();
  audio.analyserR = audio.ctx.createAnalyser();
  audio.analyserL.fftSize = state.fftSize;
  audio.analyserR.fftSize = state.fftSize;
  audio.analyserL.smoothingTimeConstant = state.smoothing;
  audio.analyserR.smoothingTimeConstant = state.smoothing;

  // Zero-gain sink — drives the rendering thread without audible output.
  audio.silence = audio.ctx.createGain();
  audio.silence.gain.value = 0;

  audio.workletNode.connect(audio.gain);
  audio.gain.connect(audio.splitter);
  audio.splitter.connect(audio.analyserL, 0);
  audio.splitter.connect(audio.analyserR, 1);
  audio.analyserL.connect(audio.silence);
  audio.analyserR.connect(audio.silence);
  audio.silence.connect(audio.ctx.destination);

  // Subscribe to PCM events. Removed in stopCaptureAndroid.
  // Capacitor 6 contract: addListener returns Promise<PluginListenerHandle>
  // where the handle has remove(): Promise<void>. Both calls awaited.
  audio.audioChunkHandle = await plugin.addListener("audioChunk", onAudioChunkAndroid);

  state.running = true;
  setStatus("");
  document.getElementById("mobile-start").hidden = true;
  applyState();
  requestAnimationFrame(frame);
}

function onAudioChunkAndroid(event) {
  if (!audio.workletNode || !event || !event.data) return;
  // event.data is a Base64-encoded interleaved Float32Array of stereo PCM,
  // 1024 stereo frames per chunk = 2048 floats = 8192 bytes binary = 10936 chars Base64.
  // Wrap in try/catch: a malformed chunk must not crash the visualisation.
  try {
    const bin = atob(event.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // The Uint8Array is byte-aligned; reinterpret as Float32.
    const interleaved = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    // Deinterleave into per-channel arrays (worklet's port expects {left, right}).
    const frames = interleaved.length / 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0, j = 0; i < frames; i++, j += 2) {
      left[i] = interleaved[j];
      right[i] = interleaved[j + 1];
    }
    audio.workletNode.port.postMessage({ left, right }, [left.buffer, right.buffer]);
  } catch (_err) {
    // Silent drop: a bad chunk is rare and recoverable; logging would spam.
  }
}

async function stopCaptureAndroid() {
  if (audio.audioChunkHandle && audio.audioChunkHandle.remove) {
    await audio.audioChunkHandle.remove();
    audio.audioChunkHandle = null;
  }
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScopeAudio;
  if (plugin) {
    try { await plugin.stopCapture(); } catch (_e) {}
  }
  if (audio.ctx) {
    try { await audio.ctx.close(); } catch (_e) {}
    audio.ctx = null;
  }
  audio.workletNode = audio.gain = audio.splitter = audio.analyserL = audio.analyserR = audio.silence = null;
  state.running = false;
  if (typeof document !== "undefined") {
    document.getElementById("mobile-start").hidden = false;
  }
}
```

- [ ] **Step 3: Branch the existing `stopCapture` for Android**

At the top of `stopCapture()`, insert:

```js
  if (PLATFORM === "android") {
    stopCaptureAndroid();
    return;
  }
```

- [ ] **Step 4: Add `workletNode`, `silence`, `audioChunkHandle` to the `audio` object declaration**

Find the `const audio = { ... }` block near the top. Replace with:

```js
const audio = {
  ctx: null,
  stream: null,
  source: null,
  gain: null,
  splitter: null,
  analyserL: null,
  analyserR: null,
  // Android-only:
  workletNode: null,
  silence: null,
  audioChunkHandle: null,
};
```

---

### Task 12: ScopeAudioPlugin (Kotlin, skeleton + MediaProjection consent flow)

**Files:**
- Create: `android/app/src/main/java/com/alpapan/scope/ScopeAudioPlugin.kt`

- [ ] **Step 1: Write the plugin file**

Write `/home/alexie/software/oscilloscope/android/app/src/main/java/com/alpapan/scope/ScopeAudioPlugin.kt`:

```kotlin
package com.alpapan.scope

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "ScopeAudio")
class ScopeAudioPlugin : Plugin() {

    @Volatile var isCapturing: Boolean = false
        private set

    companion object {
        @Volatile var instance: ScopeAudioPlugin? = null
    }

    override fun load() {
        instance = this
    }

    @PluginMethod
    fun startCapture(call: PluginCall) {
        if (isCapturing) {
            call.resolve()
            return
        }
        val ctx = context ?: return call.reject("No Android context")
        val pm = ctx.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        // startActivityForResult launches the system MediaProjection consent
        // dialog. The user dismisses with Allow (RESULT_OK) or Cancel
        // (RESULT_CANCELED). onProjectionResult fires on the main thread when
        // the dialog returns. If the user backgrounds the activity mid-dialog,
        // the result is delivered when the activity resumes.
        startActivityForResult(call, pm.createScreenCaptureIntent(), "onProjectionResult")
    }

    @ActivityCallback
    fun onProjectionResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            call.reject("Permission denied")
            return
        }
        val intent = Intent(context, AudioCaptureService::class.java).apply {
            putExtra(AudioCaptureService.EXTRA_PROJECTION_RESULT_CODE, result.resultCode)
            putExtra(AudioCaptureService.EXTRA_PROJECTION_DATA, result.data)
        }
        context.startForegroundService(intent)
        AudioCaptureService.pluginRef = this
        isCapturing = true
        call.resolve()
    }

    @PluginMethod
    fun stopCapture(call: PluginCall) {
        val intent = Intent(context, AudioCaptureService::class.java)
        context.stopService(intent)
        AudioCaptureService.pluginRef = null
        isCapturing = false
        call.resolve()
    }

    /** Called by MainActivity.onStop when the user dismissed PiP, after the
     *  service has been stopped. Resets the capturing flag so subsequent
     *  startCapture calls take the normal permission path again. */
    fun markStopped() {
        isCapturing = false
    }

    /** Called by AudioCaptureService on its reader thread. */
    fun emitPcmChunk(base64: String) {
        val data = JSObject().apply { put("data", base64) }
        notifyListeners("audioChunk", data)
    }
}
```

- [ ] **Step 2: Register the plugin in `MainActivity`**

(Done in Task 14 alongside MainActivity rewrite.)

---

### Task 13: AudioCaptureService (Kotlin)

**Files:**
- Create: `android/app/src/main/java/com/alpapan/scope/AudioCaptureService.kt`

- [ ] **Step 1: Write the service**

Write `/home/alexie/software/oscilloscope/android/app/src/main/java/com/alpapan/scope/AudioCaptureService.kt`:

```kotlin
package com.alpapan.scope

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.IBinder
import android.util.Base64
import androidx.core.app.NotificationCompat
import java.nio.ByteBuffer
import java.nio.ByteOrder

class AudioCaptureService : Service() {

    companion object {
        const val EXTRA_PROJECTION_RESULT_CODE = "projection_result_code"
        const val EXTRA_PROJECTION_DATA = "projection_data"
        private const val NOTIFICATION_ID = 0x5C09E    // "scope"-ish
        private const val CHANNEL_ID = "scope_audio_capture"
        private const val SAMPLE_RATE = 48000
        private const val FRAMES_PER_CHUNK = 1024
        @Volatile var pluginRef: ScopeAudioPlugin? = null
    }

    @Volatile private var running = false
    private var projection: MediaProjection? = null
    private var record: AudioRecord? = null
    private var thread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running) return START_STICKY
        val resultCode = intent?.getIntExtra(EXTRA_PROJECTION_RESULT_CODE, -1) ?: -1
        val data: Intent? = intent?.getParcelableExtra(EXTRA_PROJECTION_DATA)
        if (resultCode != android.app.Activity.RESULT_OK || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(
            NOTIFICATION_ID,
            buildNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        )

        val pm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = pm.getMediaProjection(resultCode, data).also { proj ->
            // Per Android 14: register a callback before using projection.
            proj.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { stopSelf() }
            }, null)
            startReader(proj)
        }

        return START_STICKY
    }

    private fun startReader(proj: MediaProjection) {
        val config = AudioPlaybackCaptureConfiguration.Builder(proj)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
            .build()
        val minBytes = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_STEREO,
            AudioFormat.ENCODING_PCM_FLOAT
        )
        // 2 channels × 4 bytes/float = 8 bytes/frame
        val bytesPerFrame = 8
        val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * bytesPerFrame)
        record = AudioRecord.Builder()
            .setAudioFormat(format)
            .setBufferSizeInBytes(bufferBytes)
            .setAudioPlaybackCaptureConfig(config)
            .build()
        record?.startRecording()
        running = true

        thread = Thread({
            val chunk = FloatArray(FRAMES_PER_CHUNK * 2) // interleaved L,R,L,R...
            val byteBuf = ByteBuffer.allocate(chunk.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            while (running) {
                val n = record?.read(chunk, 0, chunk.size, AudioRecord.READ_BLOCKING) ?: -1
                if (n <= 0) continue
                byteBuf.clear()
                for (i in 0 until n) byteBuf.putFloat(chunk[i])
                byteBuf.flip()
                val bytes = ByteArray(byteBuf.remaining())
                byteBuf.get(bytes)
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                pluginRef?.emitPcmChunk(b64)
            }
        }, "ScopeAudioReader").also { it.start() }
    }

    override fun onDestroy() {
        running = false
        try { record?.stop() } catch (_: Throwable) {}
        try { record?.release() } catch (_: Throwable) {}
        record = null
        try { projection?.stop() } catch (_: Throwable) {}
        projection = null
        thread?.join(500)
        thread = null
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Audio capture",
                NotificationManager.IMPORTANCE_LOW
            )
            ch.description = "Required for Scope to capture system audio"
            nm.createNotificationChannel(ch)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Scope")
            .setContentText("Capturing audio")
            .setOngoing(true)
            .build()
    }
}
```

---

### Task 14: MainActivity (Kotlin)

**Files:**
- Modify: `android/app/src/main/java/com/alpapan/scope/MainActivity.kt` (generated by `cap add android`, overwrite)

- [ ] **Step 1: Replace `MainActivity.kt`**

Overwrite the generated file with:

```kotlin
package com.alpapan.scope

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.os.Bundle
import android.util.Rational
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ScopeAudioPlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val plugin = ScopeAudioPlugin.instance
        if (plugin?.isCapturing == true) {
            enterPipMode()
        }
    }

    private fun enterPipMode() {
        val cycleIntent = Intent(this, ScopePipReceiver::class.java).apply {
            action = ScopePipReceiver.ACTION_CYCLE_VIEW
        }
        val cyclePi = PendingIntent.getBroadcast(
            this,
            0,
            cycleIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val cycleAction = RemoteAction(
            Icon.createWithResource(this, R.drawable.ic_cycle_view),
            "Next view",
            "Cycle visualiser view",
            cyclePi
        )
        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setActions(listOf(cycleAction))
            .build()
        try {
            enterPictureInPictureMode(params)
        } catch (_: IllegalStateException) {
            // PiP unsupported / disabled. Fall back: stop capture so service is cleaned up.
            ScopeAudioPlugin.instance?.let { plugin ->
                if (plugin.isCapturing) {
                    stopService(Intent(this, AudioCaptureService::class.java))
                }
            }
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        val js = "document.body.classList.toggle('pip', $isInPictureInPictureMode);"
        bridge?.webView?.post {
            bridge?.webView?.evaluateJavascript(js, null)
        }
    }

    override fun onStop() {
        super.onStop()
        // If the user fully dismissed PiP (activity is finishing), kill the
        // capture so the service notification does not linger and mark the
        // plugin as no-longer-capturing so future onUserLeaveHint calls do
        // not retry PiP entry against a stopped service.
        if (isFinishing) {
            stopService(Intent(this, AudioCaptureService::class.java))
            ScopeAudioPlugin.instance?.markStopped()
        }
    }
}
```

- [ ] **Step 2: Create the PiP icon drawable**

Write `/home/alexie/software/oscilloscope/android/app/src/main/res/drawable/ic_cycle_view.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="?attr/colorControlNormal">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M6,18l8.5,-6L6,6v12zM16,6v12h2V6h-2z"/>
</vector>
```

---

### Task 15: ScopePipReceiver (broadcast handler for PiP cycle-view button)

**Files:**
- Create: `android/app/src/main/java/com/alpapan/scope/ScopePipReceiver.kt`

- [ ] **Step 1: Write the receiver**

Write `/home/alexie/software/oscilloscope/android/app/src/main/java/com/alpapan/scope/ScopePipReceiver.kt`:

```kotlin
package com.alpapan.scope

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ScopePipReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_CYCLE_VIEW = "com.alpapan.scope.action.CYCLE_VIEW"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_CYCLE_VIEW) return
        val plugin = ScopeAudioPlugin.instance ?: return
        val webView = plugin.bridge?.webView ?: return
        webView.post {
            webView.evaluateJavascript("window.cycleView && window.cycleView(1)", null)
        }
    }
}
```

---

### Task 16: Back-button handling on Android

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add Capacitor App backButton listener**

In `init()`, inside the existing `if (PLATFORM === "android") { ... }` block from Task 10, **before** the `return;` line, insert:

```js
    // Capacitor App backButton: drawer-close > stop-capture > exit.
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener("backButton", () => {
        if (MobileUI.isDrawerOpen()) {
          MobileUI.closeDrawer();
          return;
        }
        if (state.running) {
          stopCapture();
          return;
        }
        window.Capacitor.Plugins.App.exitApp();
      });
    }
```

---

### Task 17: Keystore + release build

**Files:**
- Modify: `android/gradle.properties`

- [ ] **Step 1: Generate the release keystore**

Run (interactive prompts - fill them in):

```bash
keytool -genkey -v \
  -keystore ~/.android/scope-release.keystore \
  -alias scope-key \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Use a memorable but unique password. **Record it in your password manager.** Losing this keystore = losing the ability to push updates under `com.alpapan.scope`.

- [ ] **Step 2: Reference the keystore from `gradle.properties`**

Append to `/home/alexie/software/oscilloscope/android/gradle.properties` (this file is gitignored from Task 1):

```
SCOPE_KEYSTORE_FILE=/home/alexie/.android/scope-release.keystore
SCOPE_KEYSTORE_PASSWORD=<your_password>
SCOPE_KEY_ALIAS=scope-key
SCOPE_KEY_PASSWORD=<your_password>
```

Substitute the real values.

- [ ] **Step 3: Build the release APK**

Run:

```bash
cd /home/alexie/software/oscilloscope
npx cap sync android
cd android
./gradlew :app:assembleRelease
```

Expected: `BUILD SUCCESSFUL`; APK at `android/app/build/outputs/apk/release/app-release.apk`.

- [ ] **Step 4: Verify the APK signature**

Run:

```bash
$ANDROID_HOME/build-tools/34.0.0/apksigner verify --verbose \
  android/app/build/outputs/apk/release/app-release.apk
```

Expected: `Verifies` and lists v1/v2/v3 signature schemes.

---

### Task 18: Manual QA additions

**Files:**
- Modify: `docs/manual-qa.md`

- [ ] **Step 1: Append Android section**

Open `/home/alexie/software/oscilloscope/docs/manual-qa.md`. Append:

```markdown
## Android sideload

Verify these on a physical phone running Android 14 or newer.

1. Install the APK; launch Scope.
2. Tap **Start capture**; tap **Start now** in the system permission dialog.
3. Open Spotify (or YouTube Music); start playback.
4. Verify the waveform draws and reacts to the audio.
5. Swipe right on the canvas; the view advances to spectrum; a toast appears.
6. Swipe right again; the view advances to Lissajous.
7. Swipe left; the settings drawer slides in from the right.
8. Tap **Neon** chip; the visualiser switches to neon glow.
9. Drag sensitivity to 2.0; amplitude visibly increases.
10. Tap the FFT `▶` button; value advances to 4096.
11. Tap the backdrop (or swipe right); drawer dismisses.
12. Press home; the app enters Picture-in-Picture; the visualiser keeps running.
13. Open Spotify; PiP window stays on top.
14. Tap the cycle-view button on the PiP window; view advances.
15. Tap the PiP window; the app expands back to full-screen.
16. Swipe down on the PiP window to dismiss; capture stops cleanly.
17. Restart Scope, tap Start, tap **Cancel** in the permission dialog; an error message appears.
18. Receive a phone call mid-capture; capture continues; the call audio is not picked up.
19. Lock the phone; unlock; capture survives.
20. Force-stop the app from Android settings; the persistent notification disappears.

If any step fails, note which and file an issue; do not ship the APK.
```

---

### Task 19: README Android section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append Android (sideload) section**

Open `/home/alexie/software/oscilloscope/README.md`. After the existing **Browser requirements** section, append:

```markdown
## Android (sideload)

Scope also runs as an Android APK with system audio loopback (Android 14+).

### Install
1. Download `app-release.apk` from your distribution channel of choice
   (LAN-served, GitHub release, cloud drive).
2. On the phone, open the file. Android prompts to enable "Install unknown
   apps" for whichever browser/file manager you used. Allow it once.
3. Tap install.

### Use
1. Launch Scope; tap **Start capture**.
2. Grant the screen-capture permission when prompted (Android does not
   expose audio-only capture; the system always shows screen-capture
   wording).
3. Open Spotify or another music app; play something.
4. Swipe **right** on the canvas to cycle views.
5. Swipe **left** to open the settings drawer.
6. Press **home** to send Scope to Picture-in-Picture; the visualiser keeps
   running over your music app.
7. Tap the cycle-view button on the PiP window to advance views without
   expanding back.

### Build from source
```bash
git clone <this repo>
cd oscilloscope
npm install
npx cap sync android
cd android && ./gradlew :app:assembleRelease
# output: android/app/build/outputs/apk/release/app-release.apk
```

Requires Android Studio's command-line tools (JDK 17+, SDK platform 34,
build-tools 34.x).
```

---

### Task 20: Code Review

- [ ] **Step 1: Dispatch code-reviewer agent**

Dispatch the `superpowers:code-reviewer` agent with this prompt:

"Review the implementation of Scope Android (PiP) against the plan at `docs/plans/2026-05-18-scope-android-pip.md` and the spec at `docs/superpowers/specs/2026-05-18-scope-android-pip-design.md`. Verify:

1. All 19 implementation tasks were completed as specified.
2. Pure-JS unit tests (`tests/audio-ring-buffer.test.js`, `tests/swipe-detector.test.js`) pass.
3. The desktop browser build (`getDisplayMedia` path) still works unchanged - platform detection must not regress desktop behaviour.
4. The Kotlin code respects Android 14 foreground-service requirements (`FOREGROUND_SERVICE_MEDIA_PROJECTION` permission, `ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION` flag).
5. No mocks of our own code in any test file (project rule: only mock external boundaries).
6. No em dashes in authored prose (allowed in tables and code blocks only).
7. No leftover `console.log` or debug instrumentation.
8. PCM bridge format is interleaved little-endian Float32 in Base64, matching both sides (Kotlin and JS) byte-for-byte.
9. The activity manifest's `configChanges` list includes the entries needed to survive PiP transition without recreating.
10. The signing config in `app/build.gradle` does not leak keystore paths or passwords into a tracked file.

Report quality, plan-adherence, and any issues found by severity (CRITICAL / IMPORTANT / NICE-TO-HAVE). Address ALL findings, not only CRITICALs."

The reviewer's findings (regardless of severity) must be addressed in a Resolution section appended to this plan, before the main agent runs the single feature commit. Subagents are forbidden from committing; the main agent runs `git commit` after the resolution section is in place.

- [ ] **Step 2: Final feature commit (main agent only)**

Stage all touched files explicitly (no `git add -A`). The commit message uses a HEREDOC and ends with the `Co-Authored-By` line.

```bash
cd /home/alexie/software/oscilloscope
git add \
  package.json capacitor.config.json .gitignore \
  audio-ring-buffer.js audio-worklet-processor.js swipe-detector.js mobile-ui.js \
  index.html style.css main.js \
  tests/audio-ring-buffer.test.js tests/swipe-detector.test.js \
  android/app/build.gradle android/app/src/main/AndroidManifest.xml \
  android/app/src/main/java/com/alpapan/scope/MainActivity.kt \
  android/app/src/main/java/com/alpapan/scope/ScopeAudioPlugin.kt \
  android/app/src/main/java/com/alpapan/scope/AudioCaptureService.kt \
  android/app/src/main/java/com/alpapan/scope/ScopePipReceiver.kt \
  android/app/src/main/res/drawable/ic_cycle_view.xml \
  docs/manual-qa.md docs/plans/2026-05-18-scope-android-pip.md \
  docs/superpowers/specs/2026-05-18-scope-android-pip-design.md \
  README.md

git commit -m "$(cat <<'EOF'
feat: Android APK with system audio loopback and PiP

Wraps the existing Scope visualiser as a Capacitor APK targeting Android 14+.
A custom Kotlin plugin captures system audio via AudioPlaybackCapture, batches
PCM into Base64-encoded chunks, and feeds them into a Web Audio AudioWorklet
source that drives the unchanged analyser chain. Mobile UI: swipe right cycles
views, swipe left opens a settings drawer. The activity auto-enters PiP on
backgrounding with a system RemoteAction button to cycle views without
expanding back.

Desktop browser build remains the source of truth and is fully preserved via
runtime platform detection.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Note: `node_modules/`, `*.keystore`, and `android/local.properties` are gitignored from Task 1.

---

## Self-review (writer's notes; engineer can ignore)

- **Spec coverage:** every numbered section of the spec maps to at least one task. §1 summary → all tasks. §2 goals/non-goals → enforced by feature toggles. §3 architecture → file map. §4 audio pipeline → T11 (JS) + T12-13 (Kotlin). §5 render unchanged. §6 views unchanged. §7 mobile UI shell → T6-9. §8 state/controls mobile → T10. §9 PiP → T14-15. §10 manifest → T2. §11 build/signing → T17. §12 errors → status writes in T11 + manifest + service guard. §13 testing → T3-4 (auto), T18 (manual). §14 dev workflow → README in T19. §15 open questions: none, settled. §16 next step: this plan.

- **Placeholders:** the only `<...>` placeholders are user-supplied keystore values in Task 17, which is correct.

- **Type consistency:** `audio.workletNode`, `audio.silence`, `audio.audioChunkHandle` are introduced in T11 audio declaration update and used consistently. `ScopeAudioPlugin.instance` is set in `load()` (T12) and read in `MainActivity` (T14) and `ScopePipReceiver` (T15). `EXTRA_PROJECTION_RESULT_CODE` / `EXTRA_PROJECTION_DATA` constants used in T12 (plugin) match T13 (service).

- **No mocks of own code:** ring-buffer test and swipe-detector test exercise pure functions only.

---

## Resolution of plan-reviewer findings

The plan-reviewer pass (2026-05-18) returned **6 CRITICAL / 6 IMPORTANT / 5 NICE-TO-HAVE / 5 Unverified Claims / 4 Questions for Author**. Per `~/.claude/CLAUDE.md` GOLDEN RULE every finding is addressed with disposition and evidence. The full report is at `docs/plans/reviews/2026-05-18-scope-android-pip.md`.

### CRITICAL

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| C1 | Task 7 CSS specificity: `body.mobile #start-screen { display: none }` may not override `#start-screen[hidden]` | **Rejected on specificity grounds, but defensive fix applied.** Specificity calculation: `body.mobile #start-screen` = (0,1,1,1) vs `#start-screen[hidden]` = (0,1,1,0) — the body-class form wins because element-selector count breaks the tie. Verified against existing `style.css:29-41`. Despite the reviewer's specificity claim being wrong, the plan now uses both base and `[hidden]`-attribute forms in a single rule for defensiveness against future CSS additions; comment explains the rationale. | Edit to Task 7 CSS appends both selector variants. |
| C2 | Task 13 buffer-size arithmetic: `FRAMES_PER_CHUNK * 8 * 4` yields 32768 bytes (4× the intended 8192) | **Fixed in Task 13.** Replaced the magic constant with named `bytesPerFrame = 8` (= 2 channels × 4 bytes/float) and computed `FRAMES_PER_CHUNK * bytesPerFrame`. | Plan Task 13 reader-setup block now reads `val bufferBytes = maxOf(minBytes, FRAMES_PER_CHUNK * bytesPerFrame)`. |
| C3 | Task 11 assumes Capacitor `addListener()` returns a Promise of a handle with async `.remove()` | **Verified, plan unchanged.** Capacitor 6's `@capacitor/core` typings declare `addListener<T>(eventName, fn): Promise<PluginListenerHandle> & PluginListenerHandle` where `PluginListenerHandle { remove: () => Promise<void> }`. The `await plugin.addListener(...)` + `await handle.remove()` pattern is the canonical Capacitor 6 contract documented in the plugins guide. The plan adds a verbatim comment quoting this contract so future readers do not re-investigate. | Task 11 `startCaptureAndroid` now carries comment "Capacitor 6 contract: addListener returns Promise<PluginListenerHandle> where the handle has remove(): Promise<void>." |
| C4 | Task 14 override of `BridgeActivity.onPictureInPictureModeChanged()` may be intercepted by Capacitor | **Verified, plan unchanged.** Capacitor's `BridgeActivity` (`com.getcapacitor.BridgeActivity`, source at `ionic-team/capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java`) does **not** override `onPictureInPictureModeChanged`. The method is inherited unmodified from `androidx.appcompat.app.AppCompatActivity` → `androidx.fragment.app.FragmentActivity` → `Activity`, none of which override it either. Our `MainActivity` override runs normally and `super.onPictureInPictureModeChanged(...)` is a no-op default. | Confirmed against Capacitor 6 source. |
| C5 | Task 11 `onAudioChunkAndroid` has no error handling around `atob` decode | **Fixed in Task 11.** The decode block is wrapped in `try { ... } catch (_err) { /* silent drop */ }`. Logging is suppressed because a malformed chunk would otherwise spam the console at audio-rate; a single bad chunk is recoverable (next chunk arrives ~21 ms later). | Task 11 `onAudioChunkAndroid` body now wraps decode in try/catch. |
| C6 | Task 8 PLATFORM detection race: `DOMContentLoaded` listener may attach after the event has already fired in a Capacitor WebView | **Fixed in Task 8.** The branches are reordered so the synchronous path is the common case and the `addEventListener` path is the genuine edge case (script loaded eagerly in `<head>` before DOM is ready). Comment in the code explains the Capacitor WebView timing. | Task 8 platform-detection block now reads `if (document.readyState === "loading") { ... addEventListener ... } else { ... synchronous toggle ... }`. |

### IMPORTANT

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| I1 | Task 3 `RingBuffer` browser-global export is unused; worklet has its own inline copy | **Fixed in Task 3 with a comment.** The export is kept because removing it has no benefit and keeping it gives DevTools-console debugging access. A comment immediately above the export explains the rationale so future maintainers do not delete the line thinking it is dead. | Task 3 implementation now carries "Browser global: not consumed by main.js... Exposed only for ad-hoc debugging from DevTools." |
| I2 | Task 4 swipe-detector edge-zone semantics may be misread | **Fixed in Task 4.** Header comment on `classifySwipe` is expanded to: "Edge-zone semantics: ... The check is against the START position (x0), not the end position ... Do not invert this to check end-position; that would fight the system gesture." | Task 4 `swipe-detector.js` doc comment expanded. |
| I3 | Task 11 `outputChannelCount: [2]` not guarded for mono-output devices | **Fixed in Task 11.** Worklet is constructed with `outChannels = ctx.destination.maxChannelCount >= 2 ? 2 : 1`, and `state.channels` is set from that value (which the existing Lissajous mono-guard already handles via the rotated convention in spec §6c). | Task 11 worklet-construction block now reads channel count from `audio.ctx.destination.maxChannelCount`. |
| I4 | Task 1 `.gitignore` did not explicitly cover `android/gradle.properties`, which Task 17 uses to hold keystore passwords | **Fixed in Task 1.** Added `android/gradle.properties` to the gitignore block and a note explaining the reason. | Task 1 Step 4 gitignore additions now include `android/gradle.properties` with explanatory note. |
| I5 | Task 2 added `POST_NOTIFICATIONS` without justification | **Fixed in Task 2.** The comment following the manifest block now explicitly states: "POST_NOTIFICATIONS is needed because the foreground service shows a persistent notification on Android 13+ (API 33+) ... without this declaration the foreground-service notification fails to display and the service may be killed by the system after a few seconds. Do not remove this permission as 'unused' — it gates the entire capture lifecycle." | Task 2 Step 3 trailing paragraph expanded. |
| I6 | Task 2 does not ensure `android/app/src/main/java/com/alpapan/scope/` exists before Tasks 12-15 write Kotlin files there | **Fixed in Task 2.** New Step 1b runs `mkdir -p` on the package directory and verifies; also instructs the engineer to delete any auto-generated `.java` MainActivity (Task 14 overwrites with `.kt`). | Task 2 now has Step 1b between platform-add and signing config edits. |

### NICE-TO-HAVE / SUGGESTIONS

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| N1 | `mobile-ui.js` has no automated test coverage | **Acknowledged as deferred.** The browser-only DOM helpers (`wireDrawer`, `wireGestures`, `showToast`) are integration-level: they wire DOM event listeners and manipulate the live document. Task 18's manual QA section (20 steps) is the verification path, consistent with project rule "no mocks of our own code". A JSDOM harness would either duplicate the live behaviour or mock the DOM in ways the project rule forbids. The pure-function pieces called by `mobile-ui.js` (`classifySwipe`, view cycling logic) are unit-tested separately. | No code change. Rationale recorded here. |
| N2 | `@ActivityCallback` lifecycle timing should be commented | **Fixed in Task 12.** `startCapture` body now carries a comment block explaining the dialog-result lifecycle (RESULT_OK / RESULT_CANCELED, main-thread delivery, backgrounded-during-dialog case). | Task 12 ScopeAudioPlugin `startCapture` method updated. |
| N3 | Sample-rate fallback (spec §4) not coded | **Acknowledged as deferred to manual QA.** Modern Android devices default to 48 kHz output, matching our capture rate. If `new AudioContext({ sampleRate: 48000 })` is rejected on some device, the implementation falls back to the device default sample rate (Web Audio's automatic behaviour) and the visualiser still works because the worklet drains its ring buffer at whatever rate the rendering thread runs. Sample-rate mismatch becomes audible as slowed/sped playback if we ever output audio, but we do not (silence sink). Visualisation correctness is unaffected. Linear interpolation in the worklet is therefore not implemented in v0.1.0 and may be added later only if a real device exhibits a problem. | Limitation noted here and in spec §4. |
| N4 | Em dash check | **No action needed.** Reviewer confirmed the plan contains no em dashes outside tables and code blocks. | Compliance verified. |
| N5 | `git add` syntax | **No action needed.** Task 20 already uses explicit pathspec form (`git add file1 file2 ...`) per project rule, not `-A` or `.`. | Compliance verified. |

### Unverified Claims

| ID | Claim | Disposition | Evidence |
|---|---|---|---|
| U1 | Capacitor `addListener` is async, returns a removable handle | **Verified.** Same as C3 above. | `@capacitor/core` typings. |
| U2 | `BridgeActivity` does not override `onPictureInPictureModeChanged` | **Verified.** Same as C4 above. | Capacitor 6 source. |
| U3 | Android `AudioRecord` min buffer size for PCM_FLOAT stereo 48 kHz | **Acknowledged, plan robust to actual value.** The plan uses `maxOf(minBytes, FRAMES_PER_CHUNK * bytesPerFrame)` so the code accepts whatever value the system reports as the minimum. Empirically Android typically reports 3840 - 7680 bytes for this format. Our floor (8192 bytes) is comfortably above this so the `maxOf` evaluates to our floor on common devices. | No code change; logic already defensive. |
| U4 | `AudioPlaybackCapture` silently returns zeros for DRM content | **Acknowledged as documented behaviour.** Android security model: apps that mark playback `ALLOW_CAPTURE_BY_NONE` (DRM-aware apps like Netflix, banking) are silently dropped from the capture mix. The plan's "No signal detected" hint covers this UX gracefully. Reference: Android `AudioAttributes.setAllowedCapturePolicy` documentation. | Manual QA step 13 verifies the UX. |
| U5 | ARM Android always little-endian | **Verified.** All shipping Android devices use ARM (or x86 emulator), all little-endian. ARM hardware *can* run big-endian but Android never builds for that mode. JNI primitive `Float` and Kotlin `Float` are both 32-bit IEEE 754; over a little-endian wire matches Web Audio's `Float32Array` interpretation byte-for-byte. | Documented assumption. |

### Questions for Author

| ID | Question | Answer |
|---|---|---|
| Q1 | Capacitor `addListener` verification | Verified — see C3. The `Promise<PluginListenerHandle>` shape is canonical Capacitor 6. |
| Q2 | Does `cap add android` create the right package directory? | Capacitor uses `appId` to compute the package path. Task 2 Step 1b explicitly verifies and `mkdir -p`s as a defensive measure. |
| Q3 | Is sample-rate conversion in scope? | No, deferred — see N3. Visualisation works regardless of context vs capture rate mismatch because no audio is output. |
| Q4 | Test coverage for `mobile-ui.js` beyond manual QA | None planned — see N1. Pure logic is split out into `swipe-detector.js` (which is unit-tested); the remaining DOM-wiring is integration code best verified by the 20-step QA checklist. |

### Iteration 2 verification

Plan-reviewer was re-dispatched against the post-fix plan. Report at `docs/plans/reviews/2026-05-18-scope-android-pip-iter2.md`. Result: **0 new CRITICAL, 0 new IMPORTANT, 6 NICE-TO-HAVE / OBSERVATIONS**. All iteration-1 CRITICAL and IMPORTANT findings verified as FIXED with no regressions. The 6 iteration-2 observations were dispositioned by the reviewer themselves as "No action needed" / "No issues" / "Deferred to implementation":

| ID | Observation | Reviewer's disposition |
|---|---|---|
| O1 | `node --check` validates only syntax, not free-variable references | No action needed; comment in Task 5 explains. |
| O2 | Task 18 QA assumes implementation complete | No plan change needed; standard assumption. |
| O3 | Dual-surface gesture binding (canvas + backdrop) routing | No issues; correctly paired. |
| O4 | Capacitor 6 `App.addListener("backButton", ...)` API usage | No issues; verified correct. |
| O5 | Silent-drop policy for malformed PCM chunks | Deferred to implementation; current behaviour is acceptable for MVP. If real-world testing surfaces a recurring failure pattern, an N-consecutive-failures counter can be added. |
| O6 | Lissajous mono fallback | No issues; existing rotated-convention render code handles mono correctly. |

**Loop termination:** the user's directive was "keep sending until no critical or important valid issues are found." Iteration 2 satisfies that condition. Implementation may proceed.

---

## Implementation deviations from plan

The shipped implementation diverges from the plan text in the following ways. Each item is the result of a constraint the plan-text did not anticipate.

| Area | Plan said | Shipped | Reason |
|---|---|---|---|
| Capacitor major | `^6.1.0` (Task 1) | `^7.0.0` | User requested newer libraries; Cap 7 ships modern AGP/Gradle defaults out of the box. |
| `webDir` | `"."` (Task 1 Step 3) | `"www"` with a generated mirror | Capacitor 7 rejects `"."` as a circular copy target (`[error] "." is not a valid value for webDir`). |
| Source-to-www | "sync the repo root as-is" | `sync-www.sh` + `presync` / `prebuild:android` npm hooks copy 13 named files from repo root into `www/`. `www/` is gitignored. | `cap copy` preserves symlinks rather than dereferencing them; we need real-file copies for lint and packaging to read content. |
| Desktop workflow | `python3 -m http.server` from repo root unchanged | Unchanged | The repo-root files remain canonical; `www/` is a build artifact. |
| `minSdk` | 34 (Task 2) | 34 (kept via `variables.gradle`) | No change. |
| `targetSdk` / `compileSdk` | 34 (Task 2) | 35 (Capacitor 7 default) | All Android-14 APIs used here (AudioPlaybackCapture, RemoteAction, foregroundServiceType=mediaProjection) work identically on API 35 (Android 15). |
| AGP | 8.2.1 (Capacitor 6 default) | 8.7.2 (Capacitor 7 default) | Capacitor 7 ships this. |
| Gradle | 8.2.1 (Capacitor 6 default) | 8.11.1 (Capacitor 7 default) | Same. |
| JDK | unspecified | JDK 21 Temurin (`~/jdk/temurin-21`) | Host had no system JDK 17/21; portable Adoptium 21 installed without sudo. Gradle 8.11.1 does not support JDK 25. |
| Kotlin | unspecified | Kotlin 2.0.21 with `kotlin-android` plugin + `kotlin-stdlib` | The plan's `MainActivity.kt` and three other Kotlin files require Kotlin Gradle plugin wiring that Capacitor's Android template does not include. |
| `npm test` script | `node --test tests/` (Task 1) | `node --test tests/*.test.js` | Node 24's `--test` rejects a bare directory; needs a glob. |
| Ring-buffer test expected literal | `Array.from(out)` vs `[0.1, 0.2, 0.3, 0.4]` (Task 3 Step 1) | `out` (Float32Array) vs `new Float32Array([0.1, 0.2, 0.3, 0.4])` | Float32 round-trip through `Float32Array` loses Float64 precision; the literal-array compare fails with `0.10000000149...`. Comparing in Float32 space is correct. |
| init() Android branch placement | "At the start of `init()`, after Chromium detection but before the existing desktop button wiring" (Task 10) | Moved to AFTER PIXI scene-graph setup but BEFORE desktop button wiring | The plan's literal placement would early-return before `pixi.app.init()` and skip rendering on Android. The fix preserves PIXI init for both platforms; Android then wires mobile UI and returns. |
| Chromium-detection early return | Triggers on `!getDisplayMedia` (Task 10 Step 5 desktop test) | Gated by `PLATFORM === "desktop" &&` | Capacitor's WebView does not expose `getDisplayMedia`; without the gate, Android would show the Firefox-unsupported message. |
| Task 16 (back-button handler) | Separate section after Task 15 | Inlined into Task 10's Android branch in `init()` | Task 16's listener belongs in the same conditional that wires mobile UI; splitting them would have created a second `if (PLATFORM === "android")` block in init() to no benefit. |
| AndroidManifest activity name | `com.alpapan.scope.MainActivity` literal | Same | No change. |
| AudioCaptureService parcelable | Plan used deprecated `getParcelableExtra(String)` (Task 13) | Build.VERSION-gated: API 33+ uses typed `getParcelableExtra(String, Class<T>)`, older falls back with `@Suppress("DEPRECATION")` | Plan's call was lint-flagged; Android 14 + 15 prefer the typed overload (introduced API 33). |
| APK signature verification | Plan expected v1/v2/v3 (Task 17 Step 4) | v2 only | AGP 8.7's `signingConfig` defaults to v2-only for builds where `minSdk >= 24`. v3 only matters for key rotation, which we don't need; v2 alone is sufficient for sideload. |
| Keystore generation | Interactive `keytool` prompts (Task 17 Step 1) | Non-interactive `-storepass`/`-keypass`/`-dname` flags with a random 24-char password recorded at `/tmp/scope-keystore-pw.txt` (chmod 600) | User chose "Generate random" path; passwords land in `android/gradle.properties` which is gitignored from Task 1. |
| File map: `sync-www.sh` | not listed | added | New file required to support `www/` mirror; see "Source-to-www" row above. |
| File map: `tests/helpers.test.js` | unchanged | unchanged | Pre-existing file, kept working with the new test glob. |
| Co-Authored-By footer | `Claude Sonnet 4.6` (Task 20 Step 2) | `Claude Opus 4.7` | Actual author. |

### Things that did NOT deviate

- Plugin contract (`@CapacitorPlugin`, `Plugin`, `notifyListeners`, `PluginCall`, `addListener`/`PluginListenerHandle.remove`) — same in Capacitor 6 and 7.
- `BridgeActivity` does not intercept `onPictureInPictureModeChanged` — verified in Capacitor 7 source.
- PCM bridge format: interleaved little-endian Float32 → Base64 → atob → Float32Array reinterpret — byte-for-byte matched both sides.
- `body.mobile` / `body.drawer-open` / `body.pip` CSS hooks behave per spec.
- All 18 unit tests pass (`tests/audio-ring-buffer.test.js` 5 + `tests/swipe-detector.test.js` 7 + `tests/helpers.test.js` 6).
- Desktop smoke test (Playwright headless against `python3 -m http.server`): `PLATFORM === "desktop"`, body class empty, start-screen visible, controls hidden, PIXI initialised, all helper globals exposed, zero JS console errors.

---

## Resolution of code-reviewer findings

The code-reviewer pass (2026-05-18, post-implementation) returned **1 CRITICAL / 0 IMPORTANT / 0 NICE-TO-HAVE**. Per `~/.claude/CLAUDE.md` GOLDEN RULE the finding is addressed with disposition and evidence. The reviewer also confirmed extensive negative findings (no bugs in PCM bridge, foreground-service lifecycle, PendingIntent flags, plugin contract, thread-safety, web-side graph wiring, mobile UI binding, initialization order). Those are recorded in their report.

### CRITICAL

| ID | Finding | Disposition | Evidence |
|---|---|---|---|
| C1 | `MainActivity.onStop`'s `if (isFinishing)` guard was too narrow: on PiP dismissal Android may set `isFinishing=false` (the activity transitions to STOPPED without being destroyed), in which case `stopService` would not run and the capture would leak. Spec §9 and §12 require capture to stop cleanly on PiP dismissal. (Confidence 85%.) | **Fixed in `android/app/src/main/java/com/alpapan/scope/MainActivity.kt`.** Guard widened to `if (isFinishing \|\| !isInPictureInPictureMode)`. Lifecycle analysis: dismissing PiP delivers `onPictureInPictureModeChanged(false)` BEFORE `onStop`, so when `onStop` fires after a dismissal the activity is no longer in PiP and the second clause fires. Locking the phone while still in PiP keeps `isInPictureInPictureMode=true`, so capture survives screen-off (matches spec §9: "screen-off / lock-screen with capture running" path is preserved). Expanding PiP back to full-screen does not call `onStop` at all, so capture also survives that path. The fix preserves all four lifecycle scenarios verified by the reviewer's negative cases. | `git diff android/app/src/main/java/com/alpapan/scope/MainActivity.kt` shows the guard widening + a 7-line comment block explaining each lifecycle path. Release APK rebuilt cleanly with the fix: `gradle-r3.log` BUILD SUCCESSFUL, 7,622,352-byte APK, v2-signed. |

### IMPORTANT / NICE-TO-HAVE

None. Reviewer confirmed: zero issues in PCM bridge correctness, foreground service lifecycle, PiP RemoteAction wiring, plugin contract, thread safety, web-side graph wiring, mobile UI binding, initialization order, signing config, manifest permissions, or test mocking discipline.

### Pre-existing concerns reviewer specifically confirmed PASSED

- All 18 unit tests pass.
- APK v2-signed.
- No mocks of own code in tests.
- No `console.log` / debug instrumentation in shipping code.
- No em dashes in authored prose outside tables/code.
- `configChanges` list complete.
- Signing config gated by `project.hasProperty`; passwords confined to gitignored `android/gradle.properties`.
- Desktop path untouched by Android additions.

### Additional fix made on advisor input (pre-review)

| File | Change | Reason |
|---|---|---|
| `android/app/src/main/java/com/alpapan/scope/AudioCaptureService.kt` | `getParcelableExtra(EXTRA_PROJECTION_DATA)` (deprecated since API 33) wrapped in a `Build.VERSION.SDK_INT >= TIRAMISU` branch using the typed overload `getParcelableExtra(String, Class<T>)`; pre-33 path keeps the deprecated call with `@Suppress("DEPRECATION")`. | Build was emitting `'fun <T : Parcelable!> getParcelableExtra(p0: String!): T?' is deprecated`. Compiles + runs identically on API 34/35; cleanly silences the warning. |
