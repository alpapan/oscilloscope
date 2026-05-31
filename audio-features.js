// Audio feature extractors adapted from projectM (Milkdrop visualizer).
//
// pcmSmooth        - 2-tap pre-smoothing of raw PCM, per Audio/PCM.cpp.
// sumBand          - integrate FFT bin magnitudes over a frequency range.
// createLoudnessTracker - asymmetric EMA with FPS-adjusted decay
//                   (rate^secondsSinceLastFrame). Drives auto-gain and the
//                   bassAtt ratio. Source: Audio/Loudness.cpp.
// spectralFlux     - half-wave-rectified bin-to-bin magnitude rise over a band.
// estimateTempo    - autocorrelation tempo + a periodicity-confidence measure.
// createBeatTracker - causal spectral-flux onset -> autocorrelation tempo ->
//                   phase-locked beat prediction. Online, lookahead-free, and
//                   validated offline by tools/beat-harness/.
// createAudioAnalysis   - factory that bundles all of the above with an
//                   analyserNode pair; one update(dt, nowMs) per frame.
//
// All functions are pure-JS, no Web Audio dependency. Node-testable.

function pcmSmooth(input, scratch) {
  const n = input.length;
  scratch[0] = input[0];
  for (let i = 1; i < n; i++) {
    scratch[i] = 0.5 * (input[i - 1] + input[i]);
  }
  return scratch;
}

function sumBand(bins, sampleRate, fMin, fMax) {
  // FFT bin spacing: AnalyserNode.frequencyBinCount = fftSize / 2, so
  // fftSize = bins.length * 2 and binWidth = sampleRate / fftSize.
  const binWidth = sampleRate / (bins.length * 2);
  const iMin = Math.ceil(fMin / binWidth);
  const iMax = Math.floor(fMax / binWidth);
  if (iMax < iMin) return 0;
  let s = 0;
  const lo = Math.max(0, iMin);
  const hi = Math.min(bins.length - 1, iMax);
  for (let i = lo; i <= hi; i++) s += bins[i];
  return s;
}

function createLoudnessTracker({ attack, release, longRate }) {
  let average = 0;
  let longAverage = 0;
  let current = 0;
  let initialized = false;

  function update(value, dt) {
    current = value;
    if (!initialized) {
      // Seed averages with first sample so ratio starts at 1.0; otherwise
      // first-frame ratio = value / 0 spikes huge and the beat detector
      // fires spuriously on every cold start.
      average = value;
      longAverage = value;
      initialized = true;
    } else if (dt > 0) {
      const alpha = value > average ? attack : release;
      const effA = Math.pow(alpha, dt);
      const effL = Math.pow(longRate, dt);
      average = average * effA + value * (1 - effA);
      longAverage = longAverage * effL + value * (1 - effL);
    }
    const ratio = longAverage > 1e-9 ? current / longAverage : 0;
    return { current, average, longAverage, ratio };
  }

  return { update };
}

function createAudioAnalysis({ analyserL, sampleRate, fftSize }) {
  const timeBuf = new Float32Array(fftSize);
  const freqBins = new Uint8Array(fftSize / 2);
  const freqLin = new Float32Array(fftSize / 2);
  const bassT  = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const midT   = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  const trebT  = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  // RMS is computed on the time-domain signal directly (same units as the
  // gain node's input), so auto-gain can target a real amplitude rather
  // than an arbitrary FFT-bin-sum scale.
  const rmsT   = createLoudnessTracker({ attack: 0.2, release: 0.5, longRate: 0.992 });
  // Causal spectral-flux + tempo + phase-lock beat tracker, fed the full
  // freqLin spectrum (it band-limits internally to the kick band).
  const beatTracker = createBeatTracker({ frameDt: 1 / 60, sampleRate });
  let beatPulse = 0;

  function update(dt, nowMs) {
    if (!analyserL) {
      return {
        bass: 0, mid: 0, treb: 0, bassAtt: 0, beat: false, beatPulse: 0,
        longAverage: 0, rms: 0, rmsLongAverage: 0, bpm: 0,
      };
    }
    analyserL.getByteFrequencyData(freqBins);
    for (let i = 0; i < freqBins.length; i++) freqLin[i] = freqBins[i] / 255;
    const bass = sumBand(freqLin, sampleRate, 20, 250);
    const mid  = sumBand(freqLin, sampleRate, 250, 4000);
    const treb = sumBand(freqLin, sampleRate, 4000, 20000);

    analyserL.getFloatTimeDomainData(timeBuf);
    let sq = 0;
    for (let i = 0; i < timeBuf.length; i++) sq += timeBuf[i] * timeBuf[i];
    const rms = Math.sqrt(sq / timeBuf.length);

    const tracked = beatTracker.update(freqLin, dt, nowMs);
    const beat = tracked.beat;
    midT.update(mid, dt);
    trebT.update(treb, dt);
    const rmsState = rmsT.update(rms, dt);
    const bassState = bassT.update(bass, 0);  // re-read post-beat update (no double-update)
    if (beat) beatPulse = 1;
    else if (dt > 0) beatPulse *= Math.exp(-dt * 1000 / 250);
    return {
      bass, mid, treb,
      bassAtt: bassState.ratio,
      beat,
      beatPulse,
      longAverage: bassState.longAverage,
      rms: rmsState.current,
      rmsLongAverage: rmsState.longAverage,
      bpm: tracked.bpm,
    };
  }

  return { update };
}

// Tempo tracker: average BPM over a trailing window of inter-beat intervals.
// Pure: caller passes a monotonic-ms timestamp to beat().
function createTempoTracker(windowMs = 60000) {
  const intervals = [];
  let lastBeatMs = null;
  function beat(nowMs) {
    if (lastBeatMs !== null) {
      const ms = nowMs - lastBeatMs;
      if (ms > 0) intervals.push({ at: nowMs, ms });
    }
    lastBeatMs = nowMs;
    while (intervals.length && nowMs - intervals[0].at > windowMs) intervals.shift();
  }
  function avgBpm() {
    if (!intervals.length) return 40;
    let s = 0;
    for (const it of intervals) s += it.ms;
    const bpm = 60000 / (s / intervals.length);
    return Math.max(40, Math.min(200, bpm));
  }
  return { beat, avgBpm };
}

// Stateless, deterministic tempo -> absolute hue offset in degrees.
function bpmToHueDeg(avgBpm) {
  const b = Math.max(40, Math.min(200, avgBpm));
  return ((b - 40) / 160) * 360;
}

// Spectral flux onset function: half-wave-rectified bin-to-bin magnitude rise,
// summed over bins [loBin, hiBin). cur/prev are normalized magnitude spectra
// (freqLin). The default range is all bins; the beat tracker restricts it to a
// low band so the kick/bass pulse dominates broadband hats, melody, and noise.
function spectralFlux(cur, prev, loBin = 0, hiBin = cur.length) {
  let s = 0;
  const lo = Math.max(0, loBin);
  const hi = Math.min(Math.min(cur.length, prev.length), hiBin);
  for (let k = lo; k < hi; k++) {
    const d = cur[k] - prev[k];
    if (d > 0) s += d;
  }
  return s;
}

// Tempo via autocorrelation of a flux buffer, restricted to [minBpm, maxBpm]
// and weighted by a log-normal prior on lag centered at priorBpm (suppresses
// octave errors). Returns the best lag in frames and its bpm.
function estimateTempo(flux, frameDt, { minBpm = 50, maxBpm = 200, priorBpm = 120, priorWidth = 0.9 } = {}) {
  const n = flux.length;
  const minLag = Math.max(1, Math.floor(60 / maxBpm / frameDt));
  const maxLag = Math.min(n - 1, Math.ceil(60 / minBpm / frameDt));
  const priorLag = 60 / priorBpm / frameDt;
  let bestLag = minLag, bestScore = -Infinity;
  let maxRaw = 0, sumRaw = 0, cnt = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += flux[i] * flux[i - lag];
    s /= (n - lag);
    if (s > maxRaw) maxRaw = s;
    sumRaw += s; cnt += 1;
    const oct = Math.log2(lag / priorLag);
    const w = Math.exp(-0.5 * (oct / priorWidth) * (oct / priorWidth));
    const score = s * w;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // confidence = peakiness of the autocorrelation (peak / mean). A real periodic
  // pulse gives a sharp peak (>> 1); white noise gives a flat curve (~1). The
  // tracker uses this to refuse to lock onto non-rhythmic input.
  const meanRaw = cnt ? sumRaw / cnt : 0;
  const confidence = meanRaw > 1e-12 ? maxRaw / meanRaw : 0;
  return { bpm: 60 / (bestLag * frameDt), periodFrames: bestLag, score: bestScore, confidence };
}

// Causal beat tracker: streaming spectral flux -> adaptive normalization ->
// sliding-window autocorrelation tempo -> phase-locked beat prediction. Online
// and lookahead-free, so the harness-validated behavior is the shipped
// behavior. update(freqLin, dt, nowMs) -> { beat, bpm }.
function createBeatTracker({
  frameDt = 1 / 60, historySeconds = 6, minBpm = 50, maxBpm = 200, priorBpm = 120,
  tempoUpdateSec = 0.25, windowFrac = 0.18, fluxFloor = 1.5, lockSeconds = 2.0,
  sampleRate = 48000, fluxLoHz = 20, fluxHiHz = 180, fluxLoBin = null, fluxHiBin = null,
  priorWidth = 0.9, confMin = 1.8,
} = {}) {
  const histLen = Math.max(16, Math.round(historySeconds / frameDt));
  const hist = new Float64Array(histLen);
  let head = 0, filled = 0;
  let prevLin = null;
  let loBin = 1, hiBin = 0, binsInit = false; // low flux band, set on first frame
  // Adaptive flux normalization (running mean/std), same idea as the old
  // energy detector but on full-band flux.
  let mean = 0, variance = 0, statInit = false;
  const avgRate = 0.04;

  let periodFrames = Math.round(60 / priorBpm / frameDt);
  let bpm = priorBpm;
  let confidence = 0; // autocorrelation peakiness from the last tempo estimate
  let lastTempoMs = -Infinity;
  let nextBeatMs = null;
  let lastBeatMs = -Infinity;
  let lastOnsetMs = -Infinity; // last frame whose normalized flux cleared fluxFloor
  let firedThisCycle = false;
  let anchorMs = 0; // phase anchor: actual onset time when one fired, else center

  function pushHist(v) {
    hist[head] = v;
    head = (head + 1) % histLen;
    if (filled < histLen) filled += 1;
  }

  function histChrono() {
    // Return the buffer in chronological order for autocorrelation.
    const out = new Float64Array(filled);
    for (let i = 0; i < filled; i++) out[i] = hist[(head - filled + i + histLen) % histLen];
    return out;
  }

  function update(freqLin, dt, nowMs) {
    // 1) flux (restricted to the low band) + adaptive normalization
    if (!binsInit) {
      if (fluxLoBin !== null && fluxHiBin !== null) {
        loBin = fluxLoBin; hiBin = fluxHiBin;
      } else {
        const binWidth = sampleRate / (2 * freqLin.length);
        loBin = Math.max(1, Math.floor(fluxLoHz / binWidth));
        hiBin = Math.min(freqLin.length, Math.ceil(fluxHiHz / binWidth));
      }
      binsInit = true;
    }
    let flux = 0;
    if (prevLin) flux = spectralFlux(freqLin, prevLin, loBin, hiBin);
    if (!prevLin || prevLin.length !== freqLin.length) prevLin = new Float64Array(freqLin.length);
    prevLin.set(freqLin);

    let norm = 0;
    if (!statInit) { mean = flux; variance = 0; statInit = true; }
    else {
      const std = Math.sqrt(Math.max(0, variance));
      norm = std > 1e-9 ? (flux - mean) / std : 0;
      if (dt > 0) {
        const a = Math.pow(avgRate, dt);
        const prevMean = mean;
        mean = mean * a + flux * (1 - a);
        variance = variance * a + (flux - prevMean) * (flux - mean) * (1 - a);
      }
    }
    if (norm < 0) norm = 0;
    pushHist(norm);

    // 2) periodic tempo re-estimation once enough history exists
    if (nowMs - lastTempoMs >= tempoUpdateSec * 1000 && filled >= Math.round(2 / frameDt)) {
      lastTempoMs = nowMs;
      const buf = histChrono();
      const est = estimateTempo(buf, frameDt, { minBpm, maxBpm, priorBpm, priorWidth });
      periodFrames = est.periodFrames;
      bpm = est.bpm;
      confidence = est.confidence;
    }
    const periodMs = periodFrames * frameDt * 1000;
    const winMs = windowFrac * periodMs;

    // 3) beat decision. At most ONE beat per cycle (gated by firedThisCycle):
    // either an in-window onset (fires at the onset frame, re-anchors phase) or,
    // if the predicted center is reached with no onset yet, a predicted beat at
    // the center (keeps the grid alive through gaps, accurate timestamp). The
    // window-close advances the phase from anchorMs (the onset when one fired,
    // else the center) by one period. firedThisCycle prevents the double-fire.
    let beat = false;
    const isOnset = norm > fluxFloor;
    if (isOnset) lastOnsetMs = nowMs;
    // Beats require recent onset evidence. onsetActive tolerates one fully
    // missed beat (predicted), then goes false so the tracker never fires into
    // silence and unlocks when the music stops.
    const onsetActive = nowMs - lastOnsetMs < 2 * periodMs;
    // confident = the autocorrelation has a real periodic peak. White noise and
    // silence give a flat autocorrelation (low confidence), so the tracker
    // refuses to lock or fire on them.
    const confident = confidence >= confMin;
    if (nextBeatMs !== null && !confident) { nextBeatMs = null; firedThisCycle = false; }
    const locked = nowMs >= lockSeconds * 1000 && nextBeatMs !== null;

    if (!locked) {
      // Pre-lock fallback: fire on clear onsets, but only once the signal is
      // already rhythmic (confident), with a refractory ~half period.
      if (confident && isOnset && nowMs - lastBeatMs > periodMs * 0.5) {
        beat = true; lastBeatMs = nowMs;
      }
      // Lock only with rhythmic confidence and recent onset evidence; never lock
      // onto silence or noise. Anchor the grid to the most recent real onset (a
      // kick), NOT to the arbitrary lock moment, so the predicted phase lands on
      // the beat; then advance to the next future grid point.
      if (nextBeatMs === null && nowMs >= lockSeconds * 1000 && confident && onsetActive) {
        anchorMs = lastOnsetMs > 0 ? lastOnsetMs : nowMs;
        nextBeatMs = anchorMs + periodMs;
        while (nextBeatMs < nowMs - winMs) nextBeatMs += periodMs;
      }
    } else {
      const inWindow = nowMs >= nextBeatMs - winMs && nowMs <= nextBeatMs + winMs;
      if (!firedThisCycle && inWindow && isOnset) {
        // Real onset inside the tolerance window: fire here; re-anchor phase.
        beat = true; firedThisCycle = true; lastBeatMs = nowMs; anchorMs = nowMs;
      } else if (!firedThisCycle && nowMs >= nextBeatMs) {
        if (onsetActive) {
          // Reached the predicted center with no in-window onset, but the music
          // is still going: emit a predicted beat at the center to sustain the
          // grid through a one-beat gap. Anchor stays on the center.
          beat = true; firedThisCycle = true; lastBeatMs = nextBeatMs; anchorMs = nextBeatMs;
        } else {
          // No real onset for >2 periods: the music stopped. Unlock and stop
          // predicting rather than firing phantom beats into silence.
          nextBeatMs = null; firedThisCycle = false;
        }
      }
      if (nextBeatMs !== null && nowMs > nextBeatMs + winMs) {
        nextBeatMs = anchorMs + periodMs; // advance one period from the anchor
        firedThisCycle = false;           // open the gate for the next cycle
      }
    }
    return { beat, bpm };
  }

  return { update };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    pcmSmooth,
    sumBand,
    createLoudnessTracker,
    createAudioAnalysis,
    createTempoTracker,
    bpmToHueDeg,
    spectralFlux,
    estimateTempo,
    createBeatTracker,
  };
}
if (typeof globalThis !== "undefined") {
  globalThis.AudioFeatures = {
    pcmSmooth,
    sumBand,
    createLoudnessTracker,
    createAudioAnalysis,
    createTempoTracker,
    bpmToHueDeg,
    spectralFlux,
    estimateTempo,
    createBeatTracker,
  };
}
