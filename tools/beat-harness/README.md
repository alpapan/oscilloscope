# Beat-detection validation harness

An offline, Node-only harness that runs the app's exact per-frame audio chain
without Android, a browser, or the Web Audio API, then scores the detected beats
against known ground truth. It exists so the beat algorithm in
`audio-features.js` can be validated and tuned in seconds, on a battery of
signals with exact beat times, instead of by rebuild-and-eyeball on a device.

## Run it

```bash
node tools/beat-harness/run.js
```

Prints a per-case table (F-measure, precision, recall, mean timing error,
detected/expected counts) and an aggregate F plus total false positives on the
negative controls. The committed regression gate is a subset of this battery:

```bash
node --test tests/beat-accuracy.test.js
```

## What the pipeline does

Each frame reproduces what the app does once per `requestAnimationFrame`:

1. `signal-gen.js` synthesizes 48 kHz PCM with exact ground-truth beat times.
2. `pipeline.js` advances a sample cursor by `hop` (800 samples = one frame at
   60 fps), takes the trailing `fftSize` window, and calls the emulator.
3. `analyser-emulator.js` reproduces the W3C `getByteFrequencyData` transform
   exactly: Blackman window, FFT (`fft.js`), magnitude normalized by `N`, per-bin
   smoothing EMA (`smoothingTimeConstant` 0.8), conversion to dB, byte scaling
   over [-100, -30] dB. This makes the offline feature equal to the shipped one.
4. The per-frame `freqLin = bytes / 255` is fed to the detector under test
   (`createBeatTracker` from `audio-features.js`), exactly as `createAudioAnalysis`
   does. Detected beat times are collected.
5. `scorer.js` matches detected to ground-truth beats.

## Scoring

mir_eval beat F-measure: a +/-70 ms tolerance window, one-to-one nearest
matching, `precision = matched/detected`, `recall = matched/reference`,
`F = 2PR/(P+R)`. The first 5 seconds are trimmed so the causal tracker has time
to lock. Negative controls (silence, white noise, steady tone) have no reference
beats and are scored by a false-positive count instead of F.

Acceptance target: steady cases F >= 0.9, aggregate (non-control) F >= 0.75.

## Add a case

1. In `signal-gen.js`, add the case name to the `generators` list and add a
   matching `case` in `build()` that returns `{ pcm, beats }`, where `beats` are
   ground-truth times in seconds. Use the seeded `createPrng` for any noise so
   the case stays reproducible. Beats must fall after the 5 s trim to be scored.
2. Optionally add an assertion in `tests/beat-accuracy.test.js` if the case
   should be part of the committed gate.

All randomness is seeded; the harness is fully deterministic.

## Known limitations (documented gaps)

- The FFT path is implemented to the W3C spec but is not bit-compared against a
  real Chrome `AnalyserNode` (no headless capture in the loop). Fidelity rests on
  the exact-spec implementation and the emulator's spectral-property tests.
- The frame cadence is a constant 60 fps; real devices jitter their frame times.
- Signals are mono. Beats are low-frequency, so this is sufficient.
- Very fast tempos near 175 BPM can lock to half-time. At 60 fps the true period
  (about 20.6 frames) is a poor integer fit while its half (about 41 frames)
  rounds cleanly, so the autocorrelation favors the slower octave. This is the
  classic beat-tracking octave ambiguity at a tempo extreme; the visualizer still
  pulses on every other kick.
