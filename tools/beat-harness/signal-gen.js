// tools/beat-harness/signal-gen.js
// Synthesized test signals with exact ground-truth beat times. A kick is a
// low-frequency sine with a fast-decay envelope. Distractor content (bassline,
// melody, hats, noise) is added to stress the detector without moving the
// ground truth. All randomness is seeded for reproducibility.
// SCORING NOTE: the scorer trims everything before 5s, so a case is only
// meaningful if beats survive that trim. Every case here runs 20s with beats
// from 0.5s onward, leaving dozens of post-trim beats. A future short/fade-in
// case with all beats < 5s would score as empty - keep beats past 5s.
const { createPrng } = require("./prng.js");

const SR = 48000;
const DUR = 20; // seconds; > 4x the 5s scoring trim so plenty of beats remain

function addKick(pcm, atSec, { freq = 60, decay = 0.06, amp = 0.9 } = {}) {
  const start = Math.round(atSec * SR);
  const len = Math.round(decay * 5 * SR);
  for (let i = 0; i < len && start + i < pcm.length; i++) {
    const t = i / SR;
    pcm[start + i] += amp * Math.exp(-t / decay) * Math.sin(2 * Math.PI * freq * t);
  }
}

function addTone(pcm, fromSec, toSec, freq, amp) {
  const a = Math.round(fromSec * SR), b = Math.min(pcm.length, Math.round(toSec * SR));
  for (let i = a; i < b; i++) pcm[i] += amp * Math.sin((2 * Math.PI * freq * i) / SR);
}

function addNoiseBurst(pcm, atSec, durSec, amp, rnd) {
  const a = Math.round(atSec * SR), b = Math.min(pcm.length, a + Math.round(durSec * SR));
  for (let i = a; i < b; i++) {
    const env = 1 - (i - a) / (b - a);
    pcm[i] += amp * env * (rnd() * 2 - 1);
  }
}

function steadyKicks(bpm, opts = {}) {
  const pcm = new Float64Array(Math.round(DUR * SR));
  const beats = [];
  const interval = 60 / bpm;
  for (let t = 0.5; t < DUR - 0.1; t += interval) { addKick(pcm, t, opts); beats.push(t); }
  return { pcm, beats };
}

function build(name) {
  switch (name) {
    case "steady-60": return finalize(name, steadyKicks(60));
    case "steady-90": return finalize(name, steadyKicks(90));
    case "steady-120": return finalize(name, steadyKicks(120));
    case "steady-140": return finalize(name, steadyKicks(140));
    case "steady-175": return finalize(name, steadyKicks(175));
    case "loud-master": return finalize(name, steadyKicks(120, { amp: 0.98 }));
    case "quiet-master": return finalize(name, steadyKicks(120, { amp: 0.08 }));
    case "kick-bass-melody": {
      const { pcm, beats } = steadyKicks(120);
      addTone(pcm, 0, DUR, 110, 0.12);               // sustained bassline (not a beat)
      const mel = [330, 392, 440, 392];
      for (let i = 0, t = 0.25; t < DUR; t += 0.33, i++) addTone(pcm, t, t + 0.25, mel[i % 4], 0.08);
      return finalize(name, { pcm, beats });
    }
    case "low-snr": {
      const { pcm, beats } = steadyKicks(120, { amp: 0.18 });
      const rnd = createPrng(7);
      for (let i = 0; i < pcm.length; i++) pcm[i] += 0.06 * (rnd() * 2 - 1);
      return finalize(name, { pcm, beats });
    }
    case "tempo-change": {
      const pcm = new Float64Array(Math.round(DUR * SR));
      const beats = [];
      const mid = DUR / 2;
      for (let t = 0.5; t < mid; t += 60 / 120) { addKick(pcm, t, {}); beats.push(t); }
      let t = beats.length ? beats[beats.length - 1] + 60 / 140 : mid;
      for (; t < DUR - 0.1; t += 60 / 140) { addKick(pcm, t, {}); beats.push(t); }
      return finalize(name, { pcm, beats });
    }
    case "syncopation": {
      const { pcm, beats } = steadyKicks(120);
      const rnd = createPrng(11);
      for (const b of beats.slice()) addNoiseBurst(pcm, b + 0.25, 0.04, 0.25, rnd); // off-beat hats
      return finalize(name, { pcm, beats }); // ground truth = kicks only
    }
    case "silence": return finalize(name, { pcm: new Float64Array(Math.round(DUR * SR)), beats: [] });
    case "white-noise": {
      const pcm = new Float64Array(Math.round(DUR * SR));
      const rnd = createPrng(99);
      for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * (rnd() * 2 - 1);
      return finalize(name, { pcm, beats: [] });
    }
    case "steady-tone": {
      const pcm = new Float64Array(Math.round(DUR * SR));
      addTone(pcm, 0, DUR, 220, 0.5);
      return finalize(name, { pcm, beats: [] });
    }
    default: throw new Error(`unknown case ${name}`);
  }
}

function finalize(name, { pcm, beats }) {
  return { name, sampleRate: SR, durationSec: DUR, pcm, beats };
}

const generators = [
  "steady-60", "steady-90", "steady-120", "steady-140", "steady-175",
  "kick-bass-melody", "loud-master", "quiet-master", "low-snr",
  "tempo-change", "syncopation", "silence", "white-noise", "steady-tone",
].map((name) => ({ name, build: () => build(name) }));

function buildCase(name) { return build(name); }

module.exports = { generators, buildCase, SR, DUR };
