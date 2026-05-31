// tests/beat-signal-gen.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { generators, buildCase } = require("../tools/beat-harness/signal-gen.js");

test("generators: the battery covers every required category", () => {
  const names = generators.map((g) => g.name);
  for (const required of [
    "steady-60", "steady-90", "steady-120", "steady-140", "steady-175",
    "kick-bass-melody", "loud-master", "quiet-master", "low-snr",
    "tempo-change", "syncopation", "silence", "white-noise", "steady-tone",
  ]) {
    assert.ok(names.includes(required), `missing case ${required}`);
  }
});

test("buildCase: steady-120 has beats every 0.5s and correct pcm length", () => {
  const c = buildCase("steady-120");
  assert.equal(c.sampleRate, 48000);
  assert.equal(c.pcm.length, Math.round(c.durationSec * 48000));
  for (let i = 1; i < c.beats.length; i++) {
    assert.ok(Math.abs((c.beats[i] - c.beats[i - 1]) - 0.5) < 1e-9, "interval should be 0.5s");
  }
  assert.ok(c.beats.length >= 30, `expected many beats, got ${c.beats.length}`);
});

test("buildCase: negative controls declare zero beats", () => {
  for (const name of ["silence", "white-noise", "steady-tone"]) {
    const c = buildCase(name);
    assert.equal(c.beats.length, 0, `${name} should have no ground-truth beats`);
  }
});

test("buildCase: silence pcm is actually silent", () => {
  const c = buildCase("silence");
  let peak = 0;
  for (let i = 0; i < c.pcm.length; i++) peak = Math.max(peak, Math.abs(c.pcm[i]));
  assert.equal(peak, 0);
});

test("buildCase: noise cases are deterministic for the same seed", () => {
  const a = buildCase("white-noise");
  const b = buildCase("white-noise");
  assert.equal(a.pcm.length, b.pcm.length);
  for (let i = 0; i < a.pcm.length; i += 997) assert.equal(a.pcm[i], b.pcm[i]);
});

test("buildCase: tempo-change switches interval at the midpoint", () => {
  const c = buildCase("tempo-change"); // 120 -> 140 bpm
  const mid = c.durationSec / 2;
  const early = c.beats.filter((t) => t < mid - 1);
  const late = c.beats.filter((t) => t > mid + 1);
  const di = early[1] - early[0];
  const dl = late[1] - late[0];
  assert.ok(Math.abs(di - 0.5) < 1e-6, `early interval ${di}`);
  assert.ok(Math.abs(dl - 60 / 140) < 1e-6, `late interval ${dl}`);
});
