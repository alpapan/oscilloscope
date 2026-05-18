// Audio feature extractors adapted from projectM (Milkdrop visualizer).
//
// pcmSmooth        - 2-tap pre-smoothing of raw PCM, per Audio/PCM.cpp.
// sumBand          - integrate FFT bin magnitudes over a frequency range.
// createLoudnessTracker - asymmetric EMA with FPS-adjusted decay
//                   (rate^secondsSinceLastFrame). Drives auto-gain and beat
//                   detection. Source: Audio/Loudness.cpp.
// createBeatDetector    - thin wrapper: ratio > threshold + refractory window.
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

function createBeatDetector(tracker, { threshold, refractoryMs }) {
  let lastBeatMs = -Infinity;

  function update(value, dt, nowMs) {
    const { ratio } = tracker.update(value, dt);
    if (ratio > threshold && nowMs - lastBeatMs > refractoryMs) {
      lastBeatMs = nowMs;
      return true;
    }
    return false;
  }

  return { update };
}

function createAudioAnalysis({ analyserL, analyserR, sampleRate, fftSize }) {
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
  const beatD  = createBeatDetector(bassT, { threshold: 1.5, refractoryMs: 200 });
  let beatPulse = 0;

  function update(dt, nowMs) {
    if (!analyserL) {
      return {
        bass: 0, mid: 0, treb: 0, bassAtt: 0, beat: false, beatPulse: 0,
        longAverage: 0, rms: 0, rmsLongAverage: 0,
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

    const beat = beatD.update(bass, dt, nowMs);
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
    };
  }

  return { update };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    pcmSmooth,
    sumBand,
    createLoudnessTracker,
    createBeatDetector,
    createAudioAnalysis,
  };
}
if (typeof globalThis !== "undefined") {
  globalThis.AudioFeatures = {
    pcmSmooth,
    sumBand,
    createLoudnessTracker,
    createBeatDetector,
    createAudioAnalysis,
  };
}
