# Scope phone-to-TV visualiser - handout

The phone captures audio and streams a compact analysis frame over the LAN to a
paired Google TV, which draws the oscilloscope fullscreen. The phone can run
screen-off while streaming. One app, two form factors (phone vs leanback TV),
chosen at runtime.

Shipped in commit `0029361` (`feat(tv): phone-paired TV visualiser`). This
session's fixes are in commit `f6d0d45` (`fix(tv): mic-background streaming,
pair-overlay IP/version, numeric code entry`). Subsequent housekeeping in
commit `d31cb51` (logs, handoff). A 2026-05-31 follow-up session verified
discovery on-device and captured TV evidence of the 5a undersampling root
cause; see §7.

Note: this repository commits CODE only. Plans, plan reviews, brainstorming
specs, and device screencaptures live on disk locally and are not in git
(see `CLAUDE.md`, which is itself gitignored). Earlier session context that
referenced files under `docs/plans/`, `docs/superpowers/specs/`, and
`docs/evidence/` is summarised inline in this handoff and in commit
messages; do not assume those paths exist in a fresh clone.

---

## 1. For the next agent (you start with no memory of this work)

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
- No em dashes in prose (use ` - ` or hyphens).
- Run `plan-reviewer` before finalising any plan; run `code-reviewer` before any commit; address every finding (Critical, Important, Minor).
- Get the user's explicit agreement on a design before implementing it. Proposing is not agreeing.
- Never claim "fixed"/"works" without real device evidence (screencap, logcat, user confirmation). Verify every subagent claim.
- Git is for code (project rule, in `CLAUDE.md`). Plans, reviews, brainstorming specs, screencaps stay local and out of commits.

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
- JS lint + typecheck: `npm run lint` (ESLint flat config `eslint.config.mjs`) and `npm run typecheck` (`tsc --noEmit`, checkJs via `tsconfig.json` + `types/globals.d.ts`).
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
1. **Discovery does not find the TV.** Added `CHANGE_WIFI_MULTICAST_STATE` + a `WifiManager.MulticastLock` around NSD browse/advertise, and replaced every silent NSD callback with a `ScopeNsd`-tagged log (`tv/TvDiscovery.kt`). **VERIFIED on-device 2026-05-31 (§7)** with logcat evidence on both sides. The user's first tap may miss when the system NSD holds a stale `_scope._tcp.` record from a previous TV process; once refreshed (TV restart or after the stale record ages out) it works first time. Manual IP entry stays as a deliberate fallback.
2. **TV does not show its own IP.** DONE + verified (TV screencap): the LAN IP shows under the pair code in a smaller font.
3. **App version string.** DONE + verified: version `v0.3.3` bottom-right on the TV (smallest font) and at the bottom of the phone settings drawer.

---

## 3. Done this session (all in commit f6d0d45 unless noted)

| Change | State | Evidence |
|---|---|---|
| Mic capture survives losing focus while streaming to TV | **USER-VERIFIED** | works when shifting from PiP |
| Numeric pair-code keyboard (autofocus, digits-only) | **USER-VERIFIED** | keyboard appears, digits-only |
| TV LAN IP under code + version bottom-right; phone drawer version | **VERIFIED** | adb TV screencap |
| Discovery: multicast lock + NSD diagnostics | **VERIFIED 2026-05-31 (§7)** | both-side logcat |
| TV waveform upsample nearest -> linear interpolation | shipped | **NO visible quality change** (see 5a) |
| Dev tooling: ESLint + tsc checkJs; npm run lint/typecheck | done | lint 0, typecheck 0, 88 tests |
| Android lint errors fixed (leanback feature, AudioRecord SuppressLint) | done | `lintDebug` 0 errors |
| Diagnostic logging removed (`ScopeMic` 1Hz, `ScopeLife`) | done (commit `d31cb51`) | `ScopeNsd` kept (surfaces real NSD errors, tests assert it) |

Mic-background fix mechanism: `CaptureLifecycle.shouldStopOnStop(isFinishing, inPiP, streamingToTv)` = `isFinishing || (!inPiP && !streamingToTv)`. `MainActivity.onStop` previously stopped capture whenever `!inPiP`; now it keeps capture alive while `ScopeAudioPlugin.isStreamingToTv` (= `sender.connected`).

---

## 4. Lessons learnt (read before continuing)
- **No "fixed" claim without device evidence.** The nearest->linear resample change passed its unit test and did nothing on the real TV. Unit/structural tests prove the code, not the user-visible bug.
- **Get the user's agreement on a design before implementing.** After a rejected proposal, slow down further - do not pivot-and-build.
- **Verify every subagent claim.** This session a quality agent claimed "no zero-crossing trigger on TV frames" (FALSE - `drawWaveform` applies `findZeroCrossing`, main.js ~1222) and "the 500ms `PhoneSenderClient` poll is the dominant latency" (FALSE - `queue.poll(500ms)` wakes immediately on enqueue). A code agent recommended "stream raw PCM" (bad - offloads the FFT to the weak Chromecast + ~3Mbps continuous WiFi). A log-cleanup agent reported "Kotlin tests pass" having only compiled the main app, missing a broken test source. The user repeatedly reminded: subagents lie - read their code.
- **User does phone testing**; agent builds/installs and may screencap the TV.
- **NsdManager state outlives our app.** A "Connect to TV" tap can yield an empty modal because the system NSD still holds the prior TV process's `_scope._tcp.` record as current and is waiting it out. Not our bug. If the user reports "doesn't find the TV", retry after the TV's app is cold-restarted before assuming a multicast or code regression. Future UX work could surface a "searching..." indicator with a 10-15s window.

---

## 5. What's left

### 5a. TV visualisation quality (NOT fixed - needs design + user agreement)
Verified root cause: the phone computes each analysis frame over an ISOLATED 1024-sample (21ms) chunk. `ScopeAudioPlugin.makePcmTap` calls `Dsp.downsample(left, spec.waveformPoints)`, and `Dsp.downsample` returns the input unchanged when `points >= src.size` - the chunk is already 1024 samples, so requesting 2048 points yields only 1024. The phone's OWN display instead reads a continuous 2048-sample analyser window. So the TV gets coarse, half-resolution, phase-jumpy snapshots; upsampling on the TV (the shipped resample change) cannot reconstruct samples the phone never sent. Secondary: ~47fps chunk rate vs the TV's 60fps draw, and the 8-frame drop-oldest queue under jitter.

Visual confirmation (2026-05-31): captured on-TV during YouTube Music streaming. The visible waveform is a smooth low-detail green line - consistent with the undersampling story. (Screencap kept locally; not in repo.)

Candidate fix (sliding window on the phone): keep a ring buffer of recent PCM samples and compute each compact frame over a continuous 2048-sample window of the newest samples, not the isolated 1024 chunk. Frame size unchanged; phone keeps doing the DSP. The one tradeoff: each frame then reflects ~43ms of the most-recent audio rather than 21ms. **Not agreed.** Six open design choices need the user's call before any plan; see §7.

Rejected alternative: streaming raw PCM (offloads FFT to the weak Chromecast + ~3Mbps continuous WiFi).

### 5b. Phone-to-TV view/theme control (NOT implemented; brainstorm in progress)
Verified root cause: the phone never sends view/theme to the TV. `main.js applyState` only calls `sendTvRenderRequest` when `state.tvMode` (i.e. on the TV, driven by the TV remote at `wireTvRemote`, main.js ~846). The TV's JS listens for `tvAnalysisFrame`/`tvPairCode`/`tvConnected`/`tvDisconnected` but NOT for incoming control. THEME has no cross-device channel.

User has agreed (2026-05-31 brainstorm): TV is meant to replicate the visuals of the phone; only view + theme cross the wire; TV remote round-trips via the phone so the phone remains source of truth. Detailed data-flow design captured in session conversation; spec to be written next (and kept local per project rule).

### 5c. Discovery confirmation
**Resolved 2026-05-31 - see §7.** Multicast lock fix verified on both the TV advertise side and the phone browse side. Stale-cache UX caveat is a future improvement, not a regression.

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
2. Swipe left, **Connect to TV**, **Enter IP manually** `192.168.0.6:8765` (discovery may not list it on the very first tap if the system NSD holds a stale record; cold-restart the TV's app or retry).
3. Enter the 4-digit code - a NUMERIC keyboard appears, field focused. PASS: TV overlay disappears, oscilloscope follows the music.
4. Press home / turn the screen off. PASS: TV keeps drawing (mic-background fix). VERIFIED this session.

### C - still broken (expected to fail until 5a/5b land)
1. Change theme or cycle view ON THE PHONE: the TV does NOT follow (5b not implemented).
2. TV visualisation is coarser/jaggier than the phone (5a not fixed).

---

## 7. 2026-05-31 follow-up session

### 5c discovery - VERIFIED on real devices

Both the TV-side advertise path and the phone-side browse path were
exercised with logcat capture. The multicast lock fix from `f6d0d45`
works.

TV-side evidence (controlled cold restart via `am force-stop com.alpapan.scope`
+ `monkey -p com.alpapan.scope -c android.intent.category.LEANBACK_LAUNCHER 1`):
```
07:46:46.893  Capacitor/Plugin: methodName: startTvReceiver
07:46:47.060  Capacitor/Console: {"code":"7208","ip":"192.168.0.6"}
07:46:48.041  ScopeNsd: advertise registered as 'Scope TV' port 8765
```

Phone-side evidence (Scope freshly foregrounded; user tapped Connect to TV):
```
07:48:54.218  ScopeNsd: service found: 'Scope TV' type=_scope._tcp.
07:48:54.230  ScopeNsd: service resolved: 'Scope TV' -> 192.168.0.6:8765
```

UX caveat (first-try miss): the user's very first tap on Connect to TV
yielded an empty list. Diagnosis: `dumpsys servicediscovery` on the phone
showed our `_scope._tcp.local` listener registered, but the system NSD held
the previous TV process's stale registration as "current". Once the TV's
app was cold-restarted (which sent NSD goodbye + re-register), the second
tap on the phone found the TV first time. NOT a multicast or code bug.

Optional UX mitigation (not implemented; needs user agreement before any
work): the Connect-to-TV modal could surface "searching..." with a 10-15s
timeout and an explicit "no TVs found" message vs "still searching".

### Visual evidence of 5a undersampling

Captured on the TV while paired and streaming YouTube Music from the phone
(device-audio capture via MediaProjection, not microphone). The on-screen
waveform was a smooth low-detail green line, exactly the symptom predicted
by the verified 5a root cause: 1024-sample isolated chunk + `Dsp.downsample`
no-op when `points >= src.size`. Screencap retained locally as a 5a baseline;
not committed.

### Subagent claim flags (re-verify before any plan)

Two sonnet subagents investigated 5a and 5b. Their reports informed the
in-session brainstorming but are NOT design decisions and are kept local.
Specific claims to re-check from source:
- 5a: "TV's `requestAnimationFrame` 60Hz draw causes visible jaggedness".
  Likely overstated - rAF just repeats the latest frame when no new one
  arrives; the visible jaggedness is the undersampling itself, not the
  cadence mismatch.
- 5b: "TV remote handler is `MobileUI.cycleView` at `mobile-ui.js:35`".
  Architecture map says `wireTvRemote` in `main.js:846`. At least one
  is stale.

### Open design choices for 5a (still on the user)

The next agent must NOT pivot to TDD on 5a without the user's call on
these. Restate in chat and wait for the user's choice; do not infer.

| # | Topic | Default I would propose |
|---|---|---|
| 5a-1 | Sliding window size | fixed 2048, or follow `state.fftSize` |
| 5a-2 | ~21ms history per frame OK | yes (more stable trigger) |
| 5a-3 | Chase 47-vs-60fps mismatch | out of scope for this round |

5b's design choices were agreed in this session's brainstorm (view+theme
only; TV mirrors phone; TV remote round-trips via phone). Spec writing
follows.

### This session's commits

- `d31cb51` (chore): post-f6d0d45 housekeeping. `ScopeLife` diagnostic
  logs removed from `AudioCaptureService.onDestroy` and `MainActivity.onStop`
  (now-dead `willStop` variable inlined). Previous-session orphan
  `SlidingWindowTest.kt` deleted from disk (was untracked - referenced
  a never-created `SlidingWindow` class).
- Subsequent commits in this session codify the "git is for code" project
  rule (project `CLAUDE.md`, gitignore patterns) and purge pre-rule tracked
  plans/reviews/specs from history. See `git log` for SHAs and messages.

### Open work for the next agent

1. Pick up the 5b spec writing where the brainstorm left off (data flow
   agreed; components + wire format + error handling + testing still to
   present). Spec lives locally only.
2. Get the user's call on the three 5a open questions above.
3. Re-verify the flagged subagent claims by reading source.
4. Write a 5a plan and a 5b plan (separate plans, separate reviews,
   separate TDD cycles). Both kept local per project rule. Dispatch
   `plan-reviewer` on each.
5. Implement each via TDD (`superpowers:test-driven-development`).
6. Build the APK, install it on the phone (`adb -s 192.168.0.132:<port>
   install -r android/app/build/outputs/apk/debug/scope-0.3.3.apk`), and
   have the user verify the TV-side change with a fresh YouTube Music
   stream.
