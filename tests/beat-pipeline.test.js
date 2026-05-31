// tests/beat-pipeline.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { runPipeline, HOP } = require("../tools/beat-harness/pipeline.js");

test("runPipeline: maps a fired frame to time = frameIndex * hop / sampleRate", () => {
  const sampleRate = 48000;
  const pcm = new Float64Array(sampleRate * 3); // 3 s of silence is fine for timing
  // Frame index starts at 0; the Nth update() call is frame N-1. Fire on the
  // 100th call => frame 99 => time = 99 * HOP / sampleRate, asserted EXACTLY.
  const fireOnCall = 100;
  const detector = {
    n: 0,
    update() { this.n += 1; return this.n === fireOnCall; },
  };
  const detected = runPipeline({ pcm, sampleRate, detector });
  assert.equal(detected.length, 1);
  const expected = ((fireOnCall - 1) * HOP) / sampleRate;
  assert.ok(Math.abs(detected[0] - expected) < 1e-9, `got ${detected[0]}, expected ${expected}`);
});

test("runPipeline: first-frame dt is 0, later frames dt = hop/sampleRate", () => {
  const sampleRate = 48000;
  const pcm = new Float64Array(sampleRate); // 1 s
  const dts = [];
  const detector = { update(_lin, dt) { dts.push(dt); return false; } };
  runPipeline({ pcm, sampleRate, detector });
  assert.equal(dts[0], 0);
  assert.ok(Math.abs(dts[1] - HOP / sampleRate) < 1e-12, `dt[1]=${dts[1]}`);
});

test("runPipeline: feeds freqLin of length fftSize/2 in [0,1]", () => {
  const sampleRate = 48000;
  const pcm = new Float64Array(sampleRate);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 200 * i) / sampleRate);
  let seenLen = 0, inRange = true;
  const detector = {
    update(lin) {
      seenLen = lin.length;
      for (let k = 0; k < lin.length; k++) if (lin[k] < 0 || lin[k] > 1) inRange = false;
      return false;
    },
  };
  runPipeline({ pcm, sampleRate, fftSize: 2048 });
  runPipeline({ pcm, sampleRate, fftSize: 2048, detector });
  assert.equal(seenLen, 1024);
  assert.ok(inRange, "freqLin must be normalized to [0,1]");
});

test("runPipeline: object-returning detector uses .beat, not object truthiness", () => {
  // createBeatTracker returns { beat, bpm }. A naive `if (update())` would treat
  // every frame's object as truthy and report a beat every frame. Only frame
  // with beat:true must be counted.
  const sampleRate = 48000;
  const pcm = new Float64Array(sampleRate); // 1 s -> 60 frames
  const detector = {
    n: 0,
    update() { this.n += 1; return { beat: this.n === 30, bpm: 120 }; },
  };
  const detected = runPipeline({ pcm, sampleRate, detector });
  assert.equal(detected.length, 1, `expected exactly one beat, got ${detected.length}`);
});
