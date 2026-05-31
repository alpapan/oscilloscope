// tests/beat-tracker.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { spectralFlux } = require("../audio-features.js");

test("spectralFlux: rising bins produce positive flux", () => {
  const prev = new Float64Array([0, 0, 0, 0]);
  const cur = new Float64Array([0, 0.5, 0.5, 0]);
  assert.ok(Math.abs(spectralFlux(cur, prev) - 1.0) < 1e-9);
});

test("spectralFlux: falling bins are half-wave rectified to zero", () => {
  const prev = new Float64Array([1, 1, 1, 1]);
  const cur = new Float64Array([0, 0, 0, 0]);
  assert.equal(spectralFlux(cur, prev), 0);
});

test("spectralFlux: only the positive differences are summed", () => {
  const prev = new Float64Array([0.2, 0.8, 0.0]);
  const cur = new Float64Array([0.5, 0.1, 0.4]); // +0.3, -0.7, +0.4
  assert.ok(Math.abs(spectralFlux(cur, prev) - 0.7) < 1e-9);
});

const { estimateTempo } = require("../audio-features.js");

test("estimateTempo: recovers the period of an impulse train", () => {
  // Impulse every 25 frames at 60 fps -> 25/60 s period -> 144 bpm.
  const frameDt = 1 / 60;
  const n = 360;
  const flux = new Float64Array(n);
  for (let i = 0; i < n; i += 25) flux[i] = 1;
  const { bpm, periodFrames } = estimateTempo(flux, frameDt, { minBpm: 50, maxBpm: 200, priorBpm: 120 });
  assert.ok(periodFrames >= 23 && periodFrames <= 27, `periodFrames=${periodFrames}`);
  assert.ok(Math.abs(bpm - 144) < 10, `bpm=${bpm}`);
});

test("estimateTempo: prefers the prior octave over a half-tempo alias", () => {
  // 120 bpm impulse train (30-frame period). Without the prior, 60 bpm
  // (60-frame) aliases are tempting; the prior at 120 should keep it near 30.
  const frameDt = 1 / 60;
  const n = 480;
  const flux = new Float64Array(n);
  for (let i = 0; i < n; i += 30) flux[i] = 1;
  const { periodFrames } = estimateTempo(flux, frameDt, { minBpm: 50, maxBpm: 200, priorBpm: 120 });
  assert.ok(periodFrames >= 28 && periodFrames <= 32, `periodFrames=${periodFrames}`);
});

const { createBeatTracker } = require("../audio-features.js");

// Build a synthetic freqLin frame: energy in the given bins, else zero.
function frameWith(bins, value, n = 64) {
  const f = new Float64Array(n);
  for (const b of bins) f[b] = value;
  return f;
}

test("createBeatTracker: locks to a steady kick grid and ignores off-beat hats", () => {
  const frameDt = 1 / 60;
  // Synthetic 64-bin frames: kicks live in bins 1-3, hats in bins 40-50. Set the
  // flux band by bin index (the Hz default assumes a real 1024-bin spectrum) so
  // kicks are in-band and the high-frequency hats are out.
  const tr = createBeatTracker({ frameDt, historySeconds: 6, priorBpm: 120, fluxLoBin: 1, fluxHiBin: 10 });
  const kick = frameWith([1, 2, 3], 1.0);   // low bins
  const hat = frameWith([40, 45, 50], 0.8);  // high bins
  const silent = new Float64Array(64);
  const periodFrames = 30;                    // 120 bpm at 60 fps
  const kickFrames = new Set();
  const hatFrames = new Set();
  for (let f = 0; f * 1 < 360; f++) {
    if (f % periodFrames === 0) kickFrames.add(f);
    if (f % periodFrames === Math.round(periodFrames / 2)) hatFrames.add(f);
  }
  const beatFrames = [];
  let prev = silent;
  for (let f = 0; f < 360; f++) {
    let cur = silent;
    if (kickFrames.has(f)) cur = kick;
    else if (hatFrames.has(f)) cur = hat;
    else if (kickFrames.has(f - 1) || hatFrames.has(f - 1)) cur = silent; // decay after onset
    const nowMs = f * frameDt * 1000;
    const dt = f === 0 ? 0 : frameDt;
    const { beat } = tr.update(cur, dt, nowMs);
    if (beat) beatFrames.push(f);
    prev = cur;
  }
  // After lock, the count of beats should match the kicks in the late window
  // (within +/-1), and every beat aligns to a kick and not to an off-beat hat.
  // The count check rejects both under-locking (missing beats) and any
  // double-fire regression (extra beats).
  const late = beatFrames.filter((f) => f > 180);
  const lateKicks = [...kickFrames].filter((f) => f > 180).length;
  assert.ok(
    late.length >= lateKicks - 1 && late.length <= lateKicks + 1,
    `expected ~${lateKicks} late beats, got ${late.length}`,
  );
  for (const bf of late) {
    const nearKick = [...kickFrames].some((kf) => Math.abs(kf - bf) <= 3);
    const nearHat = [...hatFrames].some((hf) => Math.abs(hf - bf) <= 2);
    assert.ok(nearKick, `beat at frame ${bf} should be near a kick`);
    assert.ok(!nearHat, `beat at frame ${bf} should NOT be on an off-beat hat`);
  }
});

test("createBeatTracker: silence produces no beats", () => {
  const frameDt = 1 / 60;
  const tr = createBeatTracker({ frameDt, fluxLoBin: 1, fluxHiBin: 10 });
  const silent = new Float64Array(64);
  let beats = 0;
  for (let f = 0; f < 200; f++) {
    const { beat } = tr.update(silent, f === 0 ? 0 : frameDt, f * frameDt * 1000);
    if (beat) beats += 1;
  }
  assert.equal(beats, 0);
});

test("createBeatTracker: exposes a plausible bpm once locked", () => {
  const frameDt = 1 / 60;
  const tr = createBeatTracker({ frameDt, priorBpm: 120, fluxLoBin: 1, fluxHiBin: 10 });
  const kick = frameWith([1, 2, 3], 1.0);
  const silent = new Float64Array(64);
  let bpm = 0;
  for (let f = 0; f < 360; f++) {
    const cur = f % 30 === 0 ? kick : silent;
    ({ bpm } = tr.update(cur, f === 0 ? 0 : frameDt, f * frameDt * 1000));
  }
  assert.ok(bpm > 100 && bpm < 140, `bpm=${bpm}`);
});
