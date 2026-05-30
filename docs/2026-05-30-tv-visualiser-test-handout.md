# Scope phone-to-TV visualiser - handout

The phone captures audio and streams a compact analysis frame over the LAN to a
paired Google TV, which draws the oscilloscope fullscreen. The phone can run
screen-off while streaming. One app, two form factors (phone vs leanback TV),
chosen at runtime.

Shipped in commit `0029361` (`feat(tv): phone-paired TV visualiser`).

---

## 1. For the next agent (you start with no memory of this work)

### Plan and design docs - read these first
- Plan (the build, task by task): `docs/plans/2026-05-30-tv-paired-visualizer.md`
- Design spec (why it is shaped this way): `docs/superpowers/specs/2026-05-30-tv-paired-visualizer-design.md`
- Plan reviews: `docs/plans/reviews/2026-05-30-tv-paired-visualizer.md` (v1),
  `...-v2.md`, `...-phase4.md`
- Code reviews: `docs/plans/reviews/2026-05-30-tv-paired-visualizer-code-review.md`

### Skills to load (superpowers) - load before acting
- `brainstorming` - before any new feature or UI change. Do NOT code until a design is agreed.
- `writing-plans` - turn the agreed design into a task-by-task plan, then dispatch `plan-reviewer`.
- `test-driven-development` - mandatory for all production code (Kotlin and JS). Failing test first, watch it fail, minimal code to pass.
- `subagent-driven-development` - execute the plan with one subagent per task.
- `verification-before-completion` - run the real command and cite output before claiming anything works.
- `requesting-code-review` / `receiving-code-review` - review before every commit.

### Project discipline (from the user's CLAUDE.md - non-negotiable)
- One commit per whole feature, not per task. Commit only when asked.
- Commit with pathspec: `git add <files> && git commit -m "msg" -- <same files>`. Never `git add -A`/`.`.
- Never push unless explicitly asked. Never `rm -rf` (the harness blocks it; ask the user to run it).
- No em dashes in prose (use ` - ` or hyphens). Plans/reviews are exempt.
- Run `plan-reviewer` before finalising any plan; run `code-reviewer` before any commit; address every finding (Critical, Important, Minor).
- Pairing / auth code is security-sensitive: Opus + TDD only.

### Devices and adb
- adb is NOT on PATH. Use `~/Android/Sdk/platform-tools/adb`.
- Hardware: Pixel 10 (`frankel`) = capture phone; Chromecast with Google TV (`sabrina`) = render target. Both joined over WIRELESS adb.
- Phone: reach it at its LAN IP `192.168.0.132:<port>`. Its Wireless-Debugging screen shows `10.0.2.15:<port>` (internal NAT, NOT reachable from this host) - use the LAN IP. The port rotates whenever wireless debugging is toggled; ask the user for the current `IP:port`.
- TV: `192.168.0.6` (adb transport `192.168.0.6:45753`); TV receiver listens on TCP `8765`.
- Builds are debug-signed, so `adb install -r <apk>` works over the installed app. If it ever fails with a signature mismatch, the installed app is release-signed - `adb uninstall com.alpapan.scope` first.
- The USER does interactive phone testing (tapping, swiping, visually verifying). Build and install for them, but do NOT drive the phone with `input swipe`/`input tap`/screencap-walked flows. The TV has no human, so screencapping the TV to confirm output is fine.

### Build and test commands
- JVM unit tests: `cd android && ./gradlew :app:testDebugUnitTest --offline` (junit needs one online run first to cache).
- Build APK: `./gradlew :app:assembleDebug --offline` -> `android/app/build/outputs/apk/debug/scope-0.3.3.apk`.
- JS tests: `node --test tests/*.test.js` (pure-logic + structural tests).
- Sync web assets into the APK after editing `index.html`/`main.js`/`*.js`/`*.css`: `npm run sync` (runs `sync-www.sh` -> `www/`, then `cap sync`). A new root web file must be added to BOTH `sync-www.sh` and `package.json` `build.files`.
- gradle output dir is `android/app/build` (CWD-sensitive; prefer absolute paths or `./gradlew -p <android-dir>`).

### Architecture map
- Wire protocol + full file list: the plan's "Wire protocol" and "File structure" sections.
- Phone path: `AudioCaptureService.kt` (`pcmTap`) -> `ScopeAudioPlugin.makePcmTap` (native FFT/downsample + frame encode) -> `PhoneSenderClient` (off-thread queue) -> TV.
- TV path: `TvReceiverService.kt` (`ServerSocket(8765)`, pairing) -> plugin events -> `main.js startTvMode` (duck-typed AnalyserNode shim) -> existing `audio-features` + draw.
- Form factor: `ScopeAudioPlugin.getFormFactor` -> `main.js` init branch (TV mode returns early).
- Frontend rule: every `<button>` is themed (`var(--fg)`/`var(--bg)`, never default white) and at least 44px tall. Lock size with a structural test in `tests/precapture-ui.test.js`.

---

## 2. Known issues and required work (fix these next)

1. **Discovery does not find the TV.** On the phone, "Connect to TV" search does
   not list the TV even while the TV app is running and advertising. This is most
   likely a bug. Investigate `tv/TvDiscovery.kt` (advertise + browse), the NSD
   service type `_scope._tcp.`, registration timing, and `ScopeAudioPlugin.discoverTvs`.
2. **TV does not show its own IP.** Manual-IP entry is offered as a fallback, but
   the TV app never displays its IP address, so there is nothing to type. Add the
   TV's LAN IP (and port `8765`) to the pair overlay so manual entry is usable.
3. **App version string.** The next version must display its version (currently
   `versionName 0.3.3` in `android/app/build.gradle`, `version` in `package.json`)
   somewhere appropriate - small text on the start screen and/or the TV pair
   overlay - at an appropriate (small) font size.

(Items 1 and 2 are why end-to-end pairing currently needs the manual IP, which
the user knows out of band: `192.168.0.6:8765`.)

---

## 3. Test steps

### Setup
- TV (Chromecast): open Scope. It boots into TV mode and shows `Pair code: NNNN`
  over a faint green baseline. The code persists while waiting and changes only
  if a wrong code is tried.
- Phone (Pixel): open Scope. You land on the start screen with two buttons.

### Part A - phone UI (no TV needed)
1. The start screen shows two themed green buttons: **Capture audio** (filled)
   and **Capture mic** (outlined), both comfortably tappable.
2. Swipe left on the start screen. The drawer opens showing ONLY: Theme, Keep
   screen on, Allow fullscreen, Connect to TV, Exit.
3. Close it, tap a capture button, then swipe left again. The drawer now shows
   the FULL set (Sensitivity, Auto-gain, Detail, Smoothing, EQ) plus Stop.

   PASS: short list before capture, full list after.

### Part B - end to end (Spotify to TV)
1. Start Spotify on the phone and play a track.
2. In Scope tap **Capture mic** (Spotify cannot be captured any other way). The
   capture badge shows MIC.
3. Swipe left, tap **Connect to TV**.
4. Pick the TV from the list. (Known issue 1: it probably will not appear.) Tap
   **Enter IP manually** and type `192.168.0.6:8765`.
5. Enter the 4-digit code shown on the TV.

   PASS: the TV's pair overlay disappears and the oscilloscope moves to the music.
6. Turn the phone screen off. The TV keeps drawing.

   PASS: TV visualisation continues with the phone screen off.

### Part C - negotiation and edge cases
1. On the TV remote press D-pad left/right (or OK): the view cycles
   waveform / spectrum / lissajous and the phone adapts what it computes.
2. Wrong code: disconnect, then reconnect from the phone with a wrong code. The
   TV rejects it and the on-screen pair code rotates to a new value.
3. Reconnect with the correct (new) code - it pairs again.
4. Stop capture on the phone (or close it). The TV shows a pair code again and
   waits for a new connection.

### What to report back
- Latency from sound to TV draw (target under about 200 ms).
- Spotify mic-capture quality (speaker-to-mic acoustic loop).
- Whether discovery found the TV (issue 1) or you needed the manual IP.
- Any stutter while the phone screen is off.
- Whether view switching on the TV remote felt responsive.
