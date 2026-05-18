# Scope

A music oscilloscope. Captures audio (browser tab on desktop, system mix or
microphone on Android) and renders three live views: time-domain waveform,
frequency spectrum, and stereo Lissajous.

## Layout

Three deployment targets, one codebase. The static web files at the
project root (`index.html`, `main.js`, `style.css`, `audio-*.js`,
`mesh-warp.js`, `palette-color.js`, `swipe-detector.js`, `mobile-ui.js`,
`pixi-shim.js`) are the source of truth. **There is no separate compile
step for the renderer code** — each platform wraps the same files.

- **Desktop browser build**: serve the project root over HTTP and open in
  a Chromium browser. See *Run it on desktop* below.
- **Standalone Windows / macOS / Linux app**: Electron wraps the same
  root files via `electron/main.js`. APK-equivalent installers land in
  `dist/`. See *Standalone desktop app* below.
- **Android build**: Capacitor copies the root files into
  `android/app/src/main/assets/public/` via `sync-www.sh` and the APK
  runs them in a WebView. APKs land in
  `android/app/build/outputs/apk/release/`.

## Run it on desktop

1. Clone the repo.
2. From the project root: `npm install && npm run serve`
   (or `python3 -m http.server 8000` if you prefer no Node).
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

### Capture mode badge

While capture is running, a small pill in the top-right shows the active
source: **SYSTEM** (green) for the MediaProjection / system-audio path,
**MIC** (amber) for the microphone fallback.

### Mic fallback for DRM-protected sources

Some apps (notably Spotify music and some Chrome playback paths) set
`FLAG_NO_MEDIA_PROJECTION` on their AudioTrack, which causes Android's
audio policy to strip those streams from `REMOTE_SUBMIX` and `Scope` reads
literal-zero PCM. There is no client-side bypass for that flag.

To recover the visualisation in that case, Scope offers a microphone-source
capture path (the phone's mic picks up speaker output). When projection-mode
capture stays silent while another app is actively playing, a banner offers
"Use microphone"; tap once and Scope requests `RECORD_AUDIO` permission and
restarts capture via the mic.

- Settings → **Microphone capture** toggle to pick mic mode upfront.
- Settings → **Auto-switch to microphone when source is protected** to skip
  the banner and switch silently (a 2 s toast confirms the switch). This
  preference is persisted across sessions.
- While in mic mode, Scope polls every ~5 s for an unflagged source; if one
  appears (you switch to VLC, YouTube, etc.) it offers to switch back to the
  higher-quality system path. Rate-limited to one offer per ~5 min.

Mic mode also enables Android's `AutomaticGainControl` and `NoiseSuppressor`
audio effects, and the JS auto-gain envelope follower opens its ceiling
from `2×` (system mode) to `12×` so volume variation between songs is
normalised.

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

## Standalone desktop app (Electron)

Scope can also be packaged as a native Windows / macOS / Linux app. The
Electron wrapper lives in `electron/main.js` and reuses the exact same web
assets the browser build serves — there is no second codebase. On Windows
the wrapper auto-selects the "Entire screen" source so the user does not
get a Chromium source picker each launch; on macOS / Linux Electron's
`loopback` audio is best-effort and may degrade to silent video capture.

### Run from source (dev)
```bash
npm install
npm run electron       # opens Scope in an Electron window backed by Chromium
```

### Build a Windows installer (.exe)
```bash
# On a Windows machine with Node.js 20+ and npm:
git clone <this repo>
cd oscilloscope
npm install
npm run dist:win
# Output: dist/Scope Setup 0.3.0.exe (NSIS installer, x64)
```
Run the produced .exe — it walks the user through install location and
puts a Scope shortcut in the Start menu. Uninstall via Settings → Apps.

Cross-building from Linux to Windows is possible with Wine + Mono
installed (electron-builder picks them up automatically) but the supported
path is building on the same OS family you target.

### macOS / Linux variants
```bash
npm run dist:mac       # produces dist/Scope-0.3.0.dmg
npm run dist:linux     # produces dist/Scope-0.3.0.AppImage
```

### Signed Windows build

Generate a self-signed code-signing cert (one-time) then sign installers on
every build. Full notes: `docs/build-signed.md`.

```bash
# Prereqs (one-time)
sudo apt-get install -y wine64 wine-binfmt mono-devel openssl osslsigncode

# Generate the cert (one-time)
./scripts/generate-signing-cert.sh

# Each build
export CSC_LINK="file://$HOME/.scope-signing/scope-signing.pfx"
export CSC_KEY_PASSWORD='your-cert-password'
npm run dist:win
npm run verify:win
```

The installer is signed with the publisher CN baked into the cert (default
"Alexie Papanicolaou" — override via `SCOPE_CERT_CN` env var when running
the generator). To make Windows show that publisher name on UAC/SmartScreen
instead of "Unknown publisher", import the public `scope-signing.crt` into
the target user's `TrustedPublisher` cert store. Without that import,
SmartScreen warns once on first install (self-signed certs have no
reputation); users click "More info → Run anyway".

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
