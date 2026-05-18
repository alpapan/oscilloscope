# Scope Android - Handover

Sideload-only Android APK of the Scope music oscilloscope, built on Capacitor 7. Targets Android 14+ (minSdk 34, compileSdk 35). System audio is captured via `MediaProjection` + `AudioPlaybackCapture`, piped over the Capacitor bridge to a Web Audio `AudioWorkletNode`, and drawn into a PixiJS canvas.

## Repo layout

```
oscilloscope/
  index.html, style.css, main.js         # source of truth for both browser and APK
  pixi-shim.js                           # pixi.js ESM/UMD bridge for browser
  audio-ring-buffer.js                   # ring buffer module (tested in node)
  swipe-detector.js                      # swipe classifier (tested in node)
  mobile-ui.js                           # drawer/toast/gestures/exit-button wiring
  audio-worklet-processor.js             # AudioWorkletProcessor (runs in audio thread)
  audio-features.js                      # PCM smoothing, EMA loudness, beat detection, three-band split
  palette-color.js                       # HSV hue cycling and hue-on-beat effects
  mesh-warp.js                           # per-frame zoom/rotate of trail sprite
  sync-www.sh                            # mirrors source files into www/ before cap sync
  www/                                   # GENERATED; do not edit (gitignored)
  package.json, capacitor.config.json    # Capacitor wiring
  tests/                                 # node --test unit tests
  android/
    app/src/main/AndroidManifest.xml
    app/src/main/java/com/alpapan/scope/
      MainActivity.kt                    # PiP entry, lifecycle, bridge JS hooks
      ScopeAudioPlugin.kt                # @CapacitorPlugin; MediaProjection consent
      AudioCaptureService.kt             # foreground service; AudioRecord reader thread
      ScopePipReceiver.kt                # broadcast receiver for PiP cycle-view button
    app/src/main/res/drawable/ic_cycle_view.xml
    app/build.gradle                     # AGP 8.7.2; Kotlin 2.0.21; signing config
    variables.gradle                     # minSdk 34, compile/target 35
    gradle.properties                    # GITIGNORED; holds keystore passwords
    gradle-wrapper.properties            # Gradle 8.11.1
  docs/
    plans/2026-05-18-scope-android-pip.md
    plans/reviews/                       # plan-review + code-review reports
    superpowers/specs/2026-05-18-scope-android-pip-design.md
    manual-qa.md
    HANDOVER.md                          # this file
```

## Build environment

The build was set up on a headless Linux server. Reproducible setup:

```
JAVA_HOME=$HOME/jdk/temurin-21               # Adoptium Temurin JDK 21 (portable, no sudo)
ANDROID_HOME=$HOME/Android/Sdk               # cmdline-tools 11076708 + platform-34 + build-tools 34.0.0
PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0:$PATH
```

Convenience sourced from `/tmp/scope-env.sh` (not in the repo).

Capacitor 7 ships with AGP 8.7.2 and Gradle 8.11.1, both compatible with JDK 21. JDK 25 is NOT supported by Gradle 8.11.1 - if upgrading, jump to AGP 9 + Gradle 9 together, but be aware Capacitor 7's `@capacitor/android` package was built against AGP 8.x and may need edits.

## Build commands

```bash
# Unit tests (Node, no dependencies)
npm test                                # all *.test.js under tests/

# Sync source -> www/ -> android/app/src/main/assets/public
npm run sync                            # runs sync-www.sh then `cap sync android`

# Build release APK
cd android && ./gradlew :app:assembleRelease
# -> android/app/build/outputs/apk/release/scope-<versionName>.apk
# versionName is set in android/app/build.gradle (defaultConfig.versionName).
```

Single-step build from source: `npm run build:android` runs sync-www.sh, `cap sync`, then assembleRelease.

## Keystore

A release keystore lives at `~/.android/scope-release.keystore` (4096-bit RSA, 10000-day validity, alias `scope-key`, password recorded by the user from `/tmp/scope-keystore-pw.txt` during the original build run).

Passwords are kept in `android/gradle.properties`, which is **gitignored**. The properties keys consumed by `android/app/build.gradle`:

```properties
SCOPE_KEYSTORE_FILE=/home/<user>/.android/scope-release.keystore
SCOPE_KEYSTORE_PASSWORD=...
SCOPE_KEY_ALIAS=scope-key
SCOPE_KEY_PASSWORD=...
```

If `gradle.properties` is missing, debug builds still work (the `project.hasProperty('SCOPE_KEYSTORE_FILE')` guard in `app/build.gradle` skips signing), but `assembleRelease` will fail.

Losing the keystore = losing the ability to update an installed APK under `com.alpapan.scope` (Android refuses to install a same-package APK signed by a different key). Back it up out-of-band.

## APK transfer

The build machine is headless with no USB-attached phone, so `adb install` from this machine is not usable. The user transfers the APK to the phone by their own method (out of scope for the agent). The APK path is always:

```
/home/alexie/software/oscilloscope/android/app/build/outputs/apk/release/app-release.apk
```

## Architecture in brief

### Audio path

1. User taps **Start capture** on the mobile-start screen.
2. JS calls `Capacitor.Plugins.ScopeAudio.startCapture()`.
3. Kotlin plugin asks for `MediaProjection`, **forced to "Entire screen" mode** via `MediaProjectionConfig.createConfigForDefaultDisplay()` (API 34+). Single-app mode is intentionally suppressed because it scopes audio capture to one app.
4. On grant, plugin starts `AudioCaptureService` (foreground, `mediaProjection` type, sticky notification).
5. Service builds `AudioPlaybackCaptureConfiguration` matching `USAGE_MEDIA | USAGE_GAME | USAGE_UNKNOWN`, opens an `AudioRecord` in PCM_FLOAT stereo 48 kHz, spawns a reader thread that reads 1024-stereo-frame chunks.
6. Each chunk is little-endian-Float32 encoded, Base64'd with `NO_WRAP`, and emitted via `notifyListeners("audioChunk", JSObject)`.
7. JS-side `onAudioChunkAndroid` does `atob` -> `Uint8Array` -> reinterpret as `Float32Array` -> deinterleave into `{left, right}` -> `postMessage` (with Transferable buffers) to the worklet.
8. The worklet has two per-channel ring buffers; `process()` drains 128 frames per callback into the output channels.
9. Output goes worklet -> gain -> channel-splitter -> two analysers -> zero-gain sink -> destination. Analyser nodes are read each `requestAnimationFrame` by the PixiJS draw functions.

### Picture-in-Picture

- `setAutoEnterEnabled(true)` is set on the activity's PiP params whenever `isCapturing == true`. The system enters PiP automatically on backgrounding (Android 12+). `setSeamlessResizeEnabled(true)` is also set.
- `onUserLeaveHint` is kept as a fallback for devices where autoEnter doesn't fire reliably. It only fires `enterPictureInPictureMode` if `!isInPictureInPictureMode`.
- `onStop` stops the foreground service when `isFinishing || !isInPictureInPictureMode`. Locking the phone while in PiP keeps `isInPictureInPictureMode=true`, so capture survives screen-off. Dismissing the PiP window sets `isInPictureInPictureMode=false` before `onStop` fires, so capture stops cleanly.
- The PiP RemoteAction button fires `ScopePipReceiver`, which evaluates `window.cycleView(1)` against the WebView.

### Mobile UI controls

- Mobile-start screen with a single **Start capture** button.
- Settings drawer slides in from the right with: Theme chips (CRT/Neon/Mono), Sensitivity slider (0.1-2.0, step 0.05), FFT-size stepper, Smoothing slider (0.65-0.95, step 0.01, default 0.8), **Stop capture** button, **Exit app** button.
- Drawer header has an X close button (also closes via backdrop tap or swipe-LTR-on-backdrop).
- Canvas gestures:
  - **Double-tap** cycles view (Waveform -> Spectrum -> Lissajous).
  - **Swipe RTL** (right-to-left) opens the drawer.
  - 32px edge deadzone on both screen edges so Android's system back-gesture wins uncontested.
- Smoothing affects ALL views via a temporal lerp on time-domain data (`smoothedTime` buffers in `main.js`); the AnalyserNode's built-in smoothingTimeConstant only affects spectrum FFT bins.

### Lifecycle robustness

- `document.addEventListener("visibilitychange", ...)` resumes the AudioContext if suspended and rebuilds the trail RenderTexture when the page becomes visible again. Prevents the "black screen on return from background" symptom seen during testing.
- Errors from each phase of `startCaptureAndroid` are surfaced to `#mobile-status` on the mobile-start screen (the user must see them; there is no logcat).

## Known issues / TODOs

These were raised by the user during the test cycle and not yet acted on:

- ~~Visualisation still feels "chaotic"~~ **RESOLVED** via PCM 2-tap pre-smoothing, multi-offset thick line rendering, frame-feedback decay, auto-gain envelope follower, and mesh-warp continuous wobble.
- **FFT control's user-visible effect is unclear.** Currently a stepper over 256, 512, ..., 32768. At higher FFTs the polyline has more points and visually reads as thicker. Consider renaming to "Detail" / "Time window" or replacing with a curated set of 2-3 presets.
- **Sensitivity terminology.** User noted "sensitivity controls amplitude, not sensitivity". A linear gain knob is the underlying implementation. Renaming to "Gain" / "Amplitude" would match expectations.
- ~~Auto-gain not implemented~~ **RESOLVED** via envelope follower with auto-gain toggle (default ON) in the settings drawer. When ON, automatically normalizes trace amplitude to canvas bounds.
- **Keep screen on toggle** (default ON) is now available in the drawer: requests Wake Lock API on web and FLAG_KEEP_SCREEN_ON on Android.

## Files NOT to commit

`android/gradle.properties` (keystore passwords), `android/local.properties` (SDK path), `*.keystore`, `*.jks`, `www/` (generated by sync-www.sh), `node_modules/`, `android/.gradle/`, `android/app/build/`. All covered by `.gitignore`.

## How tests cover what

- `tests/helpers.test.js` - 6 tests on `freqToX` and `findZeroCrossing` (pure functions in main.js).
- `tests/audio-ring-buffer.test.js` - 5 tests on the ring-buffer module.
- `tests/swipe-detector.test.js` - 7 tests on `classifySwipe`, including edge-deadzone behaviour.

The Kotlin Android code has no unit tests (the templated `ExampleInstrumentedTest.java` and `ExampleUnitTest.java` are stubs from `cap add android`). Integration testing for the audio path, PiP lifecycle, and the JS<->Kotlin bridge is by manual QA on a physical device (`docs/manual-qa.md` Android section).

## How to pick up next

1. Pull, `npm install`, source the env block from "Build environment" above.
2. Run `npm test`. Should print `# pass 18` (or higher if more tests added since handover).
3. `npm run sync && cd android && ./gradlew :app:assembleRelease` to produce the APK.
4. Transfer the APK to a phone by whatever route works for you.
5. For source changes: edit files at the repo root (NOT in www/). Re-run `npm run sync` before each rebuild; the presync hook does this automatically when you run `npm run build:android`.

## What the agent should NOT do (saved as memory)

- Do not make unilateral UI changes (renames, restructures, unsolicited additions) when given a UX bug to fix. Fix only the named symptom.
- Do not defend naming or conventions when the user says something is bad. Engage with the complaint, fix it.
- Do not suggest `adb install` - this machine is headless. State the APK file path, let the user transfer.

These rules are stored in `~/.claude/projects/-home-alexie-software-oscilloscope/memory/` and load into future sessions automatically.
