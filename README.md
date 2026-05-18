# Scope

A music oscilloscope. Captures audio from a Chromium browser tab and
renders three live views: time-domain waveform, frequency spectrum, and
stereo Lissajous.

## Run it

1. Clone the repo.
2. From the project root: `python3 -m http.server 8000`
3. Open `http://localhost:8000` in Chrome, Edge, or Brave.
4. Open Spotify Web Player or YouTube in another tab and play something.
5. In Scope, click **Start capture** then share that tab and tick **Share tab audio**.

## Browser requirements

- Chromium-based browsers only (Chrome, Edge, Brave). Firefox and Safari
  do not support audio capture via `getDisplayMedia`.
- `localhost` or `https://` origin (the page does not work over `file://`).
- WebGL 2 (any modern Chromium).

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
2. Android shows a per-session prompt asking to start recording your screen.
   Tap **Start now**. (Scope forces the dialog to "Entire screen" mode on
   Android 14+ via `MediaProjectionConfig.createConfigForDefaultDisplay()`;
   the older "Single app" option is suppressed because it scopes audio
   capture to one app and would make Scope see silence.)
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
npm run sync         # mirrors browser assets into www/ and runs cap sync
cd android && ./gradlew :app:assembleRelease
# output: android/app/build/outputs/apk/release/app-release.apk
```

Requires JDK 21 (Adoptium Temurin), Android SDK platform 34+, build-tools
34.0.0+. Release builds also need a release keystore wired up via
`android/gradle.properties` (gitignored); see `docs/manual-qa.md` for the
verification checklist.

## Hotkeys

| Key | Action |
|---|---|
| `1` / `2` / `3` | Switch to waveform / spectrum / Lissajous |
| `T` | Cycle theme (CRT → neon → mono → CRT) |
| `F` | Toggle browser fullscreen |
| `Esc` | Stop capture |

## Test

```bash
node --test tests/helpers.test.js
```

Two pure helper functions are unit-tested; everything else is verified
via the manual QA checklist at `docs/manual-qa.md`.

## Design

See `docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md`.
