# Scope phone-to-TV visualiser - handout

The phone captures audio and streams a compact analysis frame over the LAN to a
paired Google TV, which draws the oscilloscope fullscreen. The phone can run
screen-off while streaming. One app, two form factors (phone vs leanback TV),
chosen at runtime.

Shipped in commit `0029361` (`feat(tv): phone-paired TV visualiser`). This
session's fixes are in commit `f6d0d45` (`fix(tv): mic-background streaming,
pair-overlay IP/version, numeric code entry`).

---

## 1. For the next agent (you start with no memory of this work)

### Plan and design docs - read these first
- Plan (the build, task by task): `docs/plans/2026-05-30-tv-paired-visualizer.md`
- Design spec (why it is shaped this way): `docs/superpowers/specs/2026-05-30-tv-paired-visualizer-design.md`
- Plan reviews: `docs/plans/reviews/2026-05-30-tv-paired-visualizer.md` (v1), `...-v2.md`, `...-phase4.md`
- This session's investigations: `docs/plans/reviews/2026-05-30-mic-background-rootcause.md`,
  `...-tv-quality-rootcause.md` (v1, has errors - see Lessons), `...-tv-quality-rootcause-v2.md`,
  `...-js-lint-setup.md`, `...-session-commit-review.md`

### Skills to load (superpowers) - load before acting
- `brainstorming` - before any new feature or UI change. Do NOT code until a design is agreed WITH THE USER.
- `writing-plans` - turn the agreed design into a task-by-task plan, then dispatch `plan-reviewer`.
- `test-driven-development` - mandatory for all production code (Kotlin and JS). Failing test first, watch it fail, minimal code to pass.
- `systematic-debugging` - for any bug; get real device evidence before proposing a fix.
- `verification-before-completion` - run the real command/device and cite output before claiming anything works.
- `requesting-code-review` / `receiving-code-review` - review before every commit.

### Project discipline (from the user's CLAUDE.md - non-negotiable)
- One commit per whole feature, not per task. Commit only when asked.
- Commit with pathspec: `git add <files> && git commit -m "msg"`. Never `git add -A`/`.`. Never push unless asked.
- No em dashes in prose (use ` - ` or hyphens). Plans/reviews are exempt.
- Run `plan-reviewer` before finalising any plan; run `code-reviewer` before any commit; address every finding (Critical, Important, Minor).
- Get the user's explicit agreement on a design before implementing it. Proposing is not agreeing.
- Never claim "fixed"/"works" without real device evidence (screencap, logcat, user confirmation). Verify every subagent claim.

### Devices and adb
- adb is NOT on PATH. Use `~/Android/Sdk/platform-tools/adb`.
- Hardware: Pixel 10 (`frankel`) = capture phone; Chromecast with Google TV (`sabrina`) = render target. Both joined over WIRELESS adb.
- Phone: reach it at its LAN IP `192.168.0.132:<port>`. Its Wireless-Debugging screen shows `10.0.2.15:<port>` (internal NAT, NOT reachable from this host) - use the LAN IP. The port rotates whenever wireless debugging is toggled; ask the user for the current `IP:port`.
- TV: `192.168.0.6` (adb transport `192.168.0.6:45753`); TV receiver listens on TCP `8765`.
- Builds are debug-signed, so `adb install -r <apk>` works over the installed app. If it ever fails with a signature mismatch, the installed app is release-signed - `adb uninstall com.alpapan.scope` first. (The obsolete `com.alpapan.scopespike` app has been uninstalled from the TV.)
- The USER does interactive phone testing (tapping, swiping, visually verifying). Build and install for them, but do NOT drive the phone with `input swipe`/`input tap`/screencap-walked flows. The TV has no human, so screencapping the TV to confirm output is fine.

### Build and test commands
- JVM unit tests: `./android/gradlew -p android :app:testDebugUnitTest --offline` (junit needs one online run first to cache).
- Build APK: `./android/gradlew -p android :app:assembleDebug --offline` -> `android/app/build/outputs/apk/debug/scope-0.3.3.apk`.
- JS tests: `node --test tests/*.test.js` (pure-logic + structural tests).
- JS lint + typecheck (added this session): `npm run lint` (ESLint flat config `eslint.config.mjs`) and `npm run typecheck` (`tsc --noEmit`, checkJs via `tsconfig.json` + `types/globals.d.ts`).
- Android lint: `./android/gradlew -p android :app:lintDebug` (now 0 errors).
- Sync web assets into the APK after editing `index.html`/`main.js`/`*.js`/`*.css`: `npm run sync` (runs `sync-www.sh` -> `www/`, then `cap sync`). A new root web file must be added to BOTH `sync-www.sh` and `package.json` `build.files`.

### Architecture map
- Phone path: `AudioCaptureService.kt` (`pcmTap`) -> `ScopeAudioPlugin.makePcmTap` (native FFT/downsample + frame encode) -> `PhoneSenderClient` (off-thread queue) -> TV.
- TV path: `TvReceiverService.kt` (`ServerSocket(8765)`, pairing) -> plugin events -> `main.js startTvMode` (duck-typed AnalyserNode shim) -> existing `audio-features` + draw.
- Control channel: TV -> phone render-requests via `TvReceiverService.sendControl` -> phone `PhoneSenderClient.onControl` -> `applyRequest` (sets the native compute spec). Phone -> TV control exists (`PhoneSenderClient.sendControl`, arrives as the TV `tvRenderRequest` event) but is currently UNUSED (see What's left 5b).
- Form factor: `ScopeAudioPlugin.getFormFactor` -> `main.js` init branch (TV mode returns early).
- Frontend rule: every `<button>` is themed (`var(--fg)`/`var(--bg)`, never default white) and at least 44px tall.

---

## 2. Status of the original three known issues
1. **Discovery does not find the TV.** Added `CHANGE_WIFI_MULTICAST_STATE` + a `WifiManager.MulticastLock` around NSD browse/advertise, and replaced every silent NSD callback with a `ScopeNsd`-tagged log (`tv/TvDiscovery.kt`). NOT yet confirmed on-device - the user still pairs via the manual IP `192.168.0.6:8765`. If still broken, pull logcat tag `ScopeNsd` to see where browse/resolve fails.
2. **TV does not show its own IP.** DONE + verified (TV screencap): the LAN IP shows under the pair code in a smaller font.
3. **App version string.** DONE + verified: version `v0.3.3` bottom-right on the TV (smallest font) and at the bottom of the phone settings drawer.

---

## 3. Done this session (all in commit f6d0d45 unless noted)

| Change | State | Evidence |
|---|---|---|
| Mic capture survives losing focus while streaming to TV | **USER-VERIFIED** | works when shifting from PiP |
| Numeric pair-code keyboard (autofocus, digits-only) | **USER-VERIFIED** | keyboard appears, digits-only |
| TV LAN IP under code + version bottom-right; phone drawer version | **VERIFIED** | adb TV screencap |
| Discovery: multicast lock + NSD diagnostics | implemented | NOT confirmed on-device |
| TV waveform upsample nearest -> linear interpolation | shipped | **NO visible quality change** (see 5a) |
| Dev tooling: ESLint + tsc checkJs; npm run lint/typecheck | done | lint 0, typecheck 0, 88 tests |
| Android lint errors fixed (leanback feature, AudioRecord SuppressLint) | done | `lintDebug` 0 errors |
| Diagnostic logging removed (`ScopeMic` 1Hz, `ScopeLife`) | done | `ScopeNsd` kept (surfaces real NSD errors, tests assert it) |

Mic-background fix mechanism: `CaptureLifecycle.shouldStopOnStop(isFinishing, inPiP, streamingToTv)` = `isFinishing || (!inPiP && !streamingToTv)`. `MainActivity.onStop` previously stopped capture whenever `!inPiP`; now it keeps capture alive while `ScopeAudioPlugin.isStreamingToTv` (= `sender.connected`).

---

## 4. Lessons learnt (read before continuing)
- **No "fixed" claim without device evidence.** The nearest->linear resample change passed its unit test and did nothing on the real TV. Unit/structural tests prove the code, not the user-visible bug.
- **Get the user's agreement on a design before implementing.** After a rejected proposal, slow down further - do not pivot-and-build.
- **Verify every subagent claim.** This session a quality agent claimed "no zero-crossing trigger on TV frames" (FALSE - `drawWaveform` applies `findZeroCrossing`, main.js ~1222) and "the 500ms `PhoneSenderClient` poll is the dominant latency" (FALSE - `queue.poll(500ms)` wakes immediately on enqueue). A code agent recommended "stream raw PCM" (bad - offloads the FFT to the weak Chromecast + ~3Mbps continuous WiFi). A log-cleanup agent reported "Kotlin tests pass" having only compiled the main app, missing a broken test source. The user repeatedly reminded: subagents lie - read their code.
- **User does phone testing**; agent builds/installs and may screencap the TV.

---

## 5. What's left

### 5a. TV visualisation quality (NOT fixed - needs research + user decision)
Verified root cause: the phone computes each analysis frame over an ISOLATED 1024-sample (21ms) chunk. `ScopeAudioPlugin.makePcmTap` calls `Dsp.downsample(left, spec.waveformPoints)`, and `Dsp.downsample` returns the input unchanged when `points >= src.size` - the chunk is already 1024 samples, so requesting 2048 points yields only 1024. The phone's OWN display instead reads a continuous 2048-sample analyser window. So the TV gets coarse, half-resolution, phase-jumpy snapshots; upsampling on the TV (the shipped resample change) cannot reconstruct samples the phone never sent. Secondary: ~47fps chunk rate vs the TV's 60fps draw, and the 8-frame drop-oldest queue under jitter.

Agent's recommendation - **NOT sufficiently researched; the user has not decided whether it is a good or bad idea**:
> My recommendation is the sliding-window fix: on the phone, keep a small ring buffer of recent samples and compute each compact frame over a continuous 2048-sample window (the same window the phone's own analyser uses), instead of over each isolated 1024-sample chunk. It keeps frames small, keeps DSP on the phone, and shouldn't change latency (it always uses the newest samples). The one tradeoff: each frame then reflects ~43ms of the most-recent audio rather than 21ms.

Next agent: research this properly before proposing it - does it actually match the phone's quality? Consider FFT window size and power-of-2 handling, whether the window should track `spec.fftSize` (which can be up to 32768) or be capped, the 47-vs-60fps draw mismatch, phone CPU cost per chunk, and how it interacts with the on-TV `findZeroCrossing` trigger. Present it and get the user's agreement before implementing. Rejected alternative: streaming raw PCM (offloads FFT to the Chromecast + bandwidth).

### 5b. Phone-to-TV view/theme control (NOT implemented)
Verified root cause: the phone never sends view/theme to the TV. `main.js applyState` only calls `sendTvRenderRequest` when `state.tvMode` (i.e. on the TV, driven by the TV remote at `wireTvRemote`, main.js ~846). The TV's JS listens for `tvAnalysisFrame`/`tvPairCode`/`tvConnected`/`tvDisconnected` but NOT for incoming control, and THEME has no cross-device channel at all - so the TV is stuck on its default theme and only changes view via its own remote.
Sketch (get user agreement first): expose `PhoneSenderClient.sendControl` via a new plugin method; in phone `applyState`, when paired (track a JS flag set on `tvConnected`/`tvDisconnected`), send `{view, theme}` to the TV; on the TV, listen for the `tvRenderRequest` event, set `state.view`+`state.theme`, call `applyState` (which on the TV re-issues the render-request so the phone computes the right data). Keep the TV remote working.

### 5c. Discovery confirmation
Confirm on-device whether the multicast lock makes "Connect to TV" list the TV without the manual IP. If not, the `ScopeNsd` logcat tag now shows where it fails.

---

## 6. Test steps

### Setup
- TV (Chromecast): open Scope. It boots into TV mode and shows `Pair code: NNNN`, the receiver IP under it, and `v0.3.3` bottom-right.
- Phone (Pixel): open Scope. Start screen with two buttons.

### A - phone UI (no TV)
1. Two themed green buttons: **Capture audio** (filled), **Capture mic** (outlined).
2. Swipe left before capture: drawer shows ONLY Theme, Keep screen on, Allow fullscreen, Connect to TV, Exit, and the version at the bottom.
3. Capture, swipe left again: FULL drawer (Sensitivity, Auto-gain, Detail, Smoothing, EQ) plus Stop, version still at the bottom.

### B - end to end (Spotify to TV)
1. Play Spotify on the phone. In Scope tap **Capture mic**.
2. Swipe left, **Connect to TV**, **Enter IP manually** `192.168.0.6:8765` (discovery may not list it yet).
3. Enter the 4-digit code - a NUMERIC keyboard appears, field focused. PASS: TV overlay disappears, oscilloscope follows the music.
4. Press home / turn the screen off. PASS: TV keeps drawing (mic-background fix). VERIFIED this session.

### C - still broken (expected to fail until 5a/5b land)
1. Change theme or cycle view ON THE PHONE: the TV does NOT follow (5b not implemented).
2. TV visualisation is coarser/jaggier than the phone (5a not fixed).
