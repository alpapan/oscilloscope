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
