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
10. Tap the FFT next button; value advances to 4096.
11. Tap the backdrop (or swipe right); drawer dismisses.
12. Press home; the app enters Picture-in-Picture; the visualiser keeps running.
13. Open Spotify; PiP window stays on top.
14. Tap the cycle-view button on the PiP window; view advances.
15. Tap the PiP window; the app expands back to full-screen.
16. Swipe down on the PiP window to dismiss; capture stops cleanly (no persistent notification remains).
17. Restart Scope, tap Start, tap **Cancel** in the permission dialog; an error message appears.
18. Receive a phone call mid-capture; capture continues; the call audio is not picked up.
19. Lock the phone; unlock; capture survives.
20. Force-stop the app from Android settings; the persistent notification disappears.

If any step fails, note which and file an issue; do not ship the APK.
