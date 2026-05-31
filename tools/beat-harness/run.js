// tools/beat-harness/run.js
// CLI: run the synthesized battery through the causal beat tracker and print
// per-case + aggregate F-measure scores.
//   node tools/beat-harness/run.js
const { generators } = require("./signal-gen.js");
const { runPipeline } = require("./pipeline.js");
const { scoreBeats } = require("./scorer.js");
const af = require("../../audio-features.js");

const SR = 48000, FFT = 2048;
const TRACKER_CFG = { frameDt: 1 / 60 };

function main() {
  const rows = [];
  let fSum = 0, fCount = 0, fpTotal = 0;
  for (const g of generators) {
    const c = g.build();
    const detected = runPipeline({
      pcm: c.pcm, sampleRate: SR, fftSize: FFT, detector: af.createBeatTracker(TRACKER_CFG),
    });
    const s = scoreBeats(c.beats, detected, { window: 0.07, trimStart: 5 });
    if (s.isNegativeControl) {
      rows.push(`${c.name.padEnd(18)}  control   fp=${s.falsePositives}`);
      fpTotal += s.falsePositives;
    } else {
      rows.push(
        `${c.name.padEnd(18)}  F=${s.f.toFixed(3)}  P=${s.precision.toFixed(3)}  ` +
        `R=${s.recall.toFixed(3)}  errMs=${s.meanAbsErrMs.toFixed(1)}  det=${s.nDet}/${s.nRef}`,
      );
      fSum += s.f; fCount += 1;
    }
  }
  process.stdout.write(`detector: causal tracker  config: ${JSON.stringify(TRACKER_CFG)}\n`);
  process.stdout.write(rows.join("\n") + "\n");
  process.stdout.write(`\naggregate F (non-control): ${(fSum / Math.max(1, fCount)).toFixed(3)}  ` +
    `total false positives: ${fpTotal}\n`);
}

main();
