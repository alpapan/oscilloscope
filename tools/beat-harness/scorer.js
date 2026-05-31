// tools/beat-harness/scorer.js
// mir_eval-style beat F-measure: trim the lead-in, match detected to reference
// one-to-one within a tolerance window, and report precision/recall/F plus mean
// absolute timing error. Empty-reference cases are scored as negative controls.
// Constants verified against mir_eval/beat.py: f_measure_threshold = 0.07 s,
// trim min_beat_time = 5.0 s, util.match_events one-to-one nearest matching.
function trim(events, trimStart) {
  return events.filter((t) => t >= trimStart).sort((a, b) => a - b);
}

// Greedy one-to-one nearest matching within +/- window. Returns matched pairs
// [{ ref, det }]. Each reference and each detection is used at most once.
function matchEvents(reference, detected, window) {
  const ref = reference.slice().sort((a, b) => a - b);
  const det = detected.slice().sort((a, b) => a - b);
  const usedDet = new Array(det.length).fill(false);
  const pairs = [];
  for (let i = 0; i < ref.length; i++) {
    let best = -1, bestErr = Infinity;
    for (let j = 0; j < det.length; j++) {
      if (usedDet[j]) continue;
      const err = Math.abs(det[j] - ref[i]);
      if (err <= window && err < bestErr) { bestErr = err; best = j; }
    }
    if (best >= 0) { usedDet[best] = true; pairs.push({ ref: ref[i], det: det[best] }); }
  }
  return pairs;
}

function scoreBeats(reference, detected, { window = 0.07, trimStart = 5 } = {}) {
  const ref = trim(reference, trimStart);
  const det = trim(detected, trimStart);
  if (ref.length === 0) {
    return { isNegativeControl: true, falsePositives: det.length, nDet: det.length, nRef: 0 };
  }
  const pairs = matchEvents(ref, det, window);
  const matched = pairs.length;
  const precision = det.length ? matched / det.length : 0;
  const recall = matched / ref.length;
  const f = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  let errSum = 0;
  for (const p of pairs) errSum += Math.abs(p.det - p.ref);
  const meanAbsErrMs = matched ? (errSum / matched) * 1000 : 0;
  return { isNegativeControl: false, precision, recall, f, meanAbsErrMs, matched, nDet: det.length, nRef: ref.length };
}

module.exports = { matchEvents, scoreBeats };
