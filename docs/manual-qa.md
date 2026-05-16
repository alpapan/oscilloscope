# Scope - Manual QA Checklist

Run this checklist before declaring a release ready. Each step assumes
the previous one succeeded.

## Setup

- [ ] Serve the page: `python3 -m http.server 8000` from the project root.
- [ ] Open `http://localhost:8000` in a Chromium browser.
- [ ] Open Spotify Web Player or a YouTube video in another tab and start
      audible playback.

## Capture and Views

- [ ] Click **Start capture** then share the source tab with **Share tab
      audio** ticked.
- [ ] Waveform view renders a stable, centred trace.
- [ ] Switch to spectrum via dropdown: ribbon along the bottom; bass on
      the left, treble on the right; beats pulse the low end.
- [ ] Switch to Lissajous via dropdown: curve oscillating around a
      vertical orientation; opens into loops for stereo content.
- [ ] Switch views via hotkeys `1` / `2` / `3`: same result as dropdown;
      dropdown value updates to match.

## Themes

- [ ] CRT theme: green trace, phosphor decay (visible ghosting from
      previous frames), scanline overlay, slight bloom.
- [ ] Neon theme: cyan trace, bright bloom halo, no decay.
- [ ] Mono theme: crisp white trace, no decay, no glow.
- [ ] Cycle themes via `T`: dropdown value updates to match.

## Controls

- [ ] Sensitivity slider at 4.0 on a quiet source: trace excursion
      visibly amplified, no clipping at the canvas edges.
- [ ] FFT size at 256: spectrum coarse, waveform low-resolution.
- [ ] FFT size at 32768: spectrum dense, waveform smoother.
- [ ] Smoothing at 0.95: spectrum responds slowly.
- [ ] Smoothing at 0: spectrum twitchy.

## UI behaviour

- [ ] Move mouse away from top, wait 3 s: controls fade to ~15% opacity.
- [ ] Move mouse near top OR hover panel OR press any key: controls
      return to full opacity.
- [ ] Press `F`: browser fullscreen toggles.
- [ ] Resize the browser window mid-capture: canvas re-fits; no trail
      artifacts beyond a single frame of transient.

## Error paths

- [ ] Open in Firefox: "needs Chromium" message; Start button disabled.
- [ ] Cancel the share-picker: status shows "Capture cancelled".
- [ ] Share a window or screen (not a tab): status shows "No audio in
      the shared stream".
- [ ] Pause the source for >3 s: status shows "No signal detected"; on
      resume, status clears.
- [ ] Click "Stop sharing" in Chromium's screen-share bar: Scope
      returns to start screen; status shows "Sharing ended".
- [ ] Press `Esc` mid-capture: returns to start screen; can restart cleanly.
- [ ] Press `Esc` again on start screen: no-op (no error in console).

## Mono source

- [ ] Share a tab playing a known-mono source (a podcast, a phone-call
      audio track): `audioTrack.getSettings().channelCount` in the
      console reads `1`; the Lissajous option in the dropdown is greyed
      with tooltip "Source is mono - no stereo to plot"; pressing `3`
      does nothing.
