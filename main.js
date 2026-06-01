// Scope - Music Oscilloscope
// See docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md
/** @ts-check */

/**
 * @typedef {Object} AudioState
 * @property {number} bass
 * @property {number} mid
 * @property {number} treb
 * @property {number} bassAtt
 * @property {boolean} beat
 * @property {number} beatPulse
 * @property {number} longAverage
 * @property {number} rms
 * @property {number} rmsLongAverage
 * @property {number} bpm
 */

// =============================================================================
// Pure helpers (also testable in Node)
// =============================================================================

function freqToX(freq, width) {
  const minLog = Math.log(20);
  const maxLog = Math.log(20000);
  return (Math.log(freq) - minLog) / (maxLog - minLog) * width;
}

// Pure polyline of [x, y] tracing the top of the spectrum-view polygon over
// 20 Hz – 20 kHz on log-X / dB-Y. The first vertex is anchored at x=0 so the
// closed polygon (caller adds lineTo(w,h) / lineTo(0,h) / closePath) fills
// the full canvas width — otherwise the lowest audible bin (typically
// ~21-23 Hz) maps a few percent in from the left and leaves an empty strip.
// Returns [] when no bin lies in the audible range, so the caller can skip
// emitting a degenerate polygon.
function spectrumPolylinePoints(freqData, sampleRate, fftSize, w, h, minDb, maxDb) {
  const bins = freqData.length;
  const points = [];
  for (let i = 1; i < bins; i++) {
    const freq = (i * sampleRate) / fftSize;
    if (freq < 20 || freq > 20000) continue;
    const x = freqToX(freq, w);
    const mag = Math.max(0, Math.min(1, (freqData[i] - minDb) / (maxDb - minDb)));
    const y = h - mag * h;
    if (points.length === 0) points.push([0, y]);
    points.push([x, y]);
  }
  return points;
}

function findZeroCrossing(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] < 0 && buf[i + 1] >= 0) return i;
  }
  return 0;
}

// Pure (DOM-free, testable) projection of state -> badge props. Centralises
// the rule that the badge is hidden while not capturing, and that micMode is
// the single source of truth for which source the badge reflects.
function nextCaptureModeBadgeProps(s) {
  if (!s || !s.running) return { hidden: true, text: "", className: "" };
  if (s.micMode) return { hidden: false, text: "MIC", className: "badge-mic" };
  return { hidden: false, text: "SYSTEM", className: "badge-system" };
}

// =============================================================================
// Platform detection (Android via Capacitor vs desktop browser)
// =============================================================================

function detectPlatform() {
  if (typeof window === "undefined") return "node";
  if (typeof window.Capacitor !== "undefined"
      && window.Capacitor.getPlatform
      && window.Capacitor.getPlatform() === "android") {
    return "android";
  }
  return "desktop";
}

const PLATFORM = (typeof window !== "undefined") ? detectPlatform() : "node";

if (typeof document !== "undefined") {
  // Mark the body so CSS can swap UI variants. The class must be applied
  // before any paint that depends on it. In a Capacitor WebView main.js is
  // typically injected after DOMContentLoaded already fired, so the
  // synchronous branch is the common case; the listener branch is the
  // genuine edge case (script loaded eagerly in <head>).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.classList.toggle("mobile", PLATFORM === "android");
    }, { once: true });
  } else {
    document.body.classList.toggle("mobile", PLATFORM === "android");
  }
}

// =============================================================================
// Browser-only state, audio, render, views, controls
// =============================================================================

// Status surface - used by init() error handling, capture errors, and the
// silent-input detection. Pulled into scaffolding (not inside the audio
// section) because init() references it before the audio code is written.
// On Android we also mirror to the mobile-start screen's status element so
// the user sees error text even when the desktop start-screen is hidden.
function setStatus(text) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("status");
  if (el) el.textContent = text;
  const mel = document.getElementById("mobile-status");
  if (mel) mel.textContent = text;
}

/** @type {Object} */
const state = {
  view: "waveform",       // "waveform" | "spectrum" | "lissajous"
  theme: "crt",           // "crt" | "neon" | "mono"
  sensitivity: 1.0,
  fftSize: 2048,
  smoothing: 0.8,
  running: false,
  channels: 2,            // detected at capture start
  tempo: null,
  hueOffsetDeg: 0,
  lastHueBakeMs: 0,
  // Per-band visual EQ mix (linear gain). Affects the time-domain signal
  // feeding the Waveform and Lissajous analysers only; the Spectrum view
  // reads the original (un-EQd) signal so the user can see what they are
  // dialling. 1.0 = unity, 0.0 = mute that band.
  bandGain: { bass: 1.0, mid: 1.0, treb: 1.0 },
  autoGain: true,         // ON: envelope follower normalises; slider disabled
  keepScreenOn: true,     // ON: request Wake Lock + Android FLAG_KEEP_SCREEN_ON
  micMode: false,         // ON: capture via mic (works for DRM-flagged sources, degraded quality)
  micModeAuto: false,     // ON: auto-switch to mic when projection capture is silently filtered, no prompt
  audioAnalysis: null,    // createAudioAnalysis instance, set after analysers up
  /** @type {AudioState} */
  audio: { bass: 0, mid: 0, treb: 0, bassAtt: 0, beat: false, beatPulse: 0, longAverage: 0, rms: 0, rmsLongAverage: 0, bpm: 0 },
  screenLock: null,       // WakeLockSentinel; set by requestScreenLock
  // Android-only: track the immersive (system-bars-hidden) state ourselves
  // since the standard Fullscreen API does not hide the status/nav bars on
  // a Capacitor WebView. The native bridge call below does the actual hide.
  androidImmersive: false,
  tvMode: false,          // ON when running as the leanback TV receiver
  paired: false,          // ON when this device is the partner of a paired TV/phone
};
function setRunning(val) {
  state.running = !!val;
  if (!val) exitFullscreenIfActive();
  refreshFullscreenUI();
}

function isInFullscreen() {
  if (PLATFORM === "android") return state.androidImmersive;
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

function refreshFullscreenUI() {
  if (typeof document === "undefined") return;
  const inFs = isInFullscreen();
  for (const id of ["mobile-fullscreen", "fullscreen"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = !state.running;
    el.textContent = inFs ? "Exit fullscreen" : "Fullscreen";
  }
}

async function setAndroidImmersive(enabled) {
  if (PLATFORM !== "android") return;
  const audioPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScopeAudio;
  if (!audioPlugin || typeof audioPlugin.setImmersive !== "function") return;
  // Track intent unconditionally: if the bridge call fails we still want the
  // tracked state to match the user's last toggle so the next toggle does the
  // opposite (rather than firing the same direction again on stale state).
  try { await audioPlugin.setImmersive({ enabled: !!enabled }); } catch (_e) { /* best-effort */ }
  state.androidImmersive = !!enabled;
}

async function exitFullscreenIfActive() {
  if (PLATFORM === "android") {
    if (state.androidImmersive) await setAndroidImmersive(false);
  } else if (typeof document !== "undefined" && document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch (_e) { /* ignore */ }
  }
}

async function toggleFullscreen() {
  if (typeof document === "undefined") return;
  if (PLATFORM === "android") {
    await setAndroidImmersive(!state.androidImmersive);
  } else {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
    } catch (_e) { /* user denied or unsupported; ignore */ }
  }
  refreshFullscreenUI();
}
if (typeof window !== "undefined") window.toggleFullscreen = toggleFullscreen;

// Auto-gain constants (projectM-style clamp, see plan §UI changes).
const TARGET_LEVEL = 0.3;
const MIN_LONG = 1e-4;
const GAIN_MIN = 0.1;
const GAIN_MAX = 2.0;
// Mic-mode auto-gain range. Speaker -> phone-mic acoustic loop is much
// quieter and more variable across songs and volume settings than a direct
// system-audio tap, so the envelope follower needs more headroom.
const GAIN_MAX_MIC = 12.0;
const AUTO_GAIN_LERP = 0.05;

const audio = {
  ctx: null,
  stream: null,
  source: null,
  gain: null,
  splitter: null,
  analyserL: null,
  analyserR: null,
  // 3-band EQ chain: parallel filters → per-band gain → summed mix → second
  // analyser pair. Spectrum view reads analyserL/R (original); Waveform and
  // Lissajous read eqAnalyserL/R (EQd). See setupEqChain.
  bassFilter: null,
  midFilter: null,
  trebFilter: null,
  bassMix: null,
  midMix: null,
  trebMix: null,
  eqSum: null,
  eqSplitter: null,
  eqAnalyserL: null,
  eqAnalyserR: null,
  // Android-only:
  workletNode: null,
  silence: null,
  audioChunkHandle: null,
  silentCaptureHandle: null,
  unrestrictedHandle: null,
  captureLostHandle: null,
};

const pixi = {
  app: null,
  trail: null,            // PIXI.RenderTexture
  trailSprite: null,      // PIXI.Sprite
  current: null,          // PIXI.Graphics
  fade: null,             // PIXI.Graphics for the decay overlay
};

const themes = {
  crt:  { fg: 0x33ff66, fgCss: "#33ff66", decayAlpha: 0.12, lineWidth: 1.5, filters: [],
          hueCycleRadians: Math.PI / 12, hueShiftOnBeat: 0,
          ramp: [{ L: 0.78, C: 0.20, h: 145 }] },
  neon: { fg: 0x00e5ff, fgCss: "#00e5ff", decayAlpha: 1.0,  lineWidth: 2.0, filters: [],
          hueCycleRadians: Math.PI,      hueShiftOnBeat: Math.PI / 3,
          ramp: [{ L: 0.82, C: 0.13, h: 220 }] },
  mono: { fg: 0xffffff, fgCss: "#ffffff", decayAlpha: 1.0,  lineWidth: 1.0, filters: [],
          hueCycleRadians: 0,            hueShiftOnBeat: 0,
          ramp: [{ L: 1.0, C: 0.0, h: 0 }] },
  nebula: { fg: 0x764be5, fgCss: "#764be5", decayAlpha: 1.0, lineWidth: 2.0, filters: [],
          hueCycleRadians: 0, hueShiftOnBeat: 0, ramp: [
            { L: 0.08, C: 0.04, h: 270 }, { L: 0.20, C: 0.07, h: 265 },
            { L: 0.35, C: 0.17, h: 270 }, { L: 0.55, C: 0.22, h: 290 },
            { L: 0.72, C: 0.22, h: 320 }, { L: 0.85, C: 0.18, h: 345 },
            { L: 0.96, C: 0.03, h: 245 } ] },
  verdant: { fg: 0x1c882d, fgCss: "#1c882d", decayAlpha: 1.0, lineWidth: 2.0, filters: [],
          hueCycleRadians: 0, hueShiftOnBeat: 0, ramp: [
            { L: 0.20, C: 0.04, h: 145 }, { L: 0.32, C: 0.06, h: 50 },
            { L: 0.42, C: 0.12, h: 135 }, { L: 0.55, C: 0.16, h: 145 },
            { L: 0.70, C: 0.18, h: 95 },  { L: 0.72, C: 0.18, h: 25 },
            { L: 0.85, C: 0.08, h: 230 } ] },
  ember: { fg: 0xee5a00, fgCss: "#ee5a00", decayAlpha: 1.0, lineWidth: 2.0, filters: [],
          hueCycleRadians: 0, hueShiftOnBeat: 0, ramp: [
            { L: 0.15, C: 0.04, h: 30 }, { L: 0.35, C: 0.15, h: 25 },
            { L: 0.50, C: 0.22, h: 30 }, { L: 0.65, C: 0.22, h: 55 },
            { L: 0.80, C: 0.20, h: 80 }, { L: 0.92, C: 0.14, h: 95 },
            { L: 0.98, C: 0.02, h: 95 } ] },
  // tempoHue: tempo rotates this palette's single vivid hue through the wheel
  // (bpmToHueDeg). The fixed palettes above keep their designed hues.
  chroma: { fg: 0xff2db8, fgCss: "#ff2db8", decayAlpha: 1.0, lineWidth: 2.0, filters: [], tempoHue: true,
          hueCycleRadians: 0, hueShiftOnBeat: 0, ramp: [
            { L: 0.22, C: 0.16, h: 330 }, { L: 0.42, C: 0.24, h: 330 },
            { L: 0.62, C: 0.26, h: 330 }, { L: 0.80, C: 0.20, h: 330 },
            { L: 0.95, C: 0.07, h: 330 } ] },
  // --- Per-view exclusive palettes (one per view; not in the generic chip grid).
  phosphor:  { fg: 0xffb000, fgCss:"#ffb000", decayAlpha:1.0, lineWidth:2.0, filters:[],
               hueCycleRadians: Math.PI/14, hueShiftOnBeat: 0, ramp:[
                 {L:0.32,C:0.09,h:70},{L:0.55,C:0.15,h:75},{L:0.78,C:0.17,h:80},{L:0.93,C:0.07,h:88} ] },
  prism:     { fg: 0x19e3b1, fgCss:"#19e3b1", decayAlpha:1.0, lineWidth:2.0, filters:[],
               hueCycleRadians: 0, hueShiftOnBeat: 0, ramp:[
                 {L:0.60,C:0.20,h:25},{L:0.72,C:0.18,h:60},{L:0.82,C:0.17,h:100},{L:0.74,C:0.17,h:150},
                 {L:0.68,C:0.15,h:200},{L:0.55,C:0.20,h:260},{L:0.52,C:0.22,h:300} ] },
  stereo:    { fg: 0x2ee6e6, fgCss:"#2ee6e6", decayAlpha:1.0, lineWidth:2.0, filters:[],
               hueCycleRadians: Math.PI*0.6, hueShiftOnBeat: Math.PI/5, ramp:[
                 {L:0.46,C:0.13,h:195},{L:0.70,C:0.16,h:200},{L:0.90,C:0.04,h:250},{L:0.70,C:0.17,h:330},{L:0.54,C:0.20,h:320} ] },
  vortex:    { fg: 0xa855f7, fgCss:"#a855f7", decayAlpha:1.0, lineWidth:2.0, filters:[],
               hueCycleRadians: Math.PI, hueShiftOnBeat: Math.PI/3, ramp:[
                 {L:0.40,C:0.17,h:265},{L:0.56,C:0.21,h:290},{L:0.70,C:0.20,h:320},{L:0.64,C:0.17,h:215},{L:0.52,C:0.19,h:255} ] },
  orchid:    { fg: 0xff4f9a, fgCss:"#ff4f9a", decayAlpha:1.0, lineWidth:2.0, filters:[],
               hueCycleRadians: Math.PI/8, hueShiftOnBeat: Math.PI/6, ramp:[
                 {L:0.46,C:0.17,h:338},{L:0.62,C:0.21,h:352},{L:0.73,C:0.19,h:22},{L:0.83,C:0.15,h:65},{L:0.93,C:0.06,h:92} ] },
  voltage:   { fg: 0x9eff2e, fgCss:"#9eff2e", decayAlpha:1.0, lineWidth:2.0, filters:[],
               hueCycleRadians: Math.PI/3, hueShiftOnBeat: Math.PI/2, ramp:[
                 {L:0.50,C:0.17,h:250},{L:0.72,C:0.22,h:150},{L:0.86,C:0.21,h:120},{L:0.96,C:0.09,h:105} ] },
  supernova: { fg: 0xffcf3f, fgCss:"#ffcf3f", decayAlpha:1.0, lineWidth:2.0, filters:[],
               hueCycleRadians: Math.PI/6, hueShiftOnBeat: Math.PI/3, ramp:[
                 {L:0.95,C:0.05,h:230},{L:0.85,C:0.13,h:200},{L:0.80,C:0.18,h:90},{L:0.70,C:0.20,h:45},{L:0.58,C:0.22,h:25} ] },
  plasma:    { fg: 0xd6249f, fgCss:"#d6249f", decayAlpha:1.0, lineWidth:2.0, filters:[],
               hueCycleRadians: Math.PI, hueShiftOnBeat: Math.PI/2, ramp:[
                 {L:0.42,C:0.19,h:290},{L:0.58,C:0.23,h:325},{L:0.66,C:0.23,h:12},{L:0.78,C:0.19,h:48},{L:0.95,C:0.08,h:72} ] },
};
const THICK_OFFSETS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
// Per-view feedback-trail override (mixed look): the flowier shapes leave a
// Milkdrop-style smear; everything else uses the palette's decayAlpha.
const VIEW_DECAY = { spiral: 0.42, lasso: 0.45, nova: 0.40 };
// Lissajous holds horizontal (base PI/2) and sways gently around it, never
// swinging to vertical. It crosses exact horizontal every ~10 s.
const LISSAJOUS_SWAY = Math.PI / 9;     // amplitude, ~20 deg either side
const LISSAJOUS_SWAY_PERIOD = 20;       // seconds for a full sway cycle
// Filters are populated inside init() once PIXI globals are available
// (they reference new PIXI.filters.GlowFilter etc.; instantiating them at
// module top-level would crash under node --test).

async function startCapture() {
  if (state.running) return;
  if (PLATFORM === "android") {
    return startCaptureAndroid();
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("This visualiser needs Chrome, Edge, or Brave. Firefox cannot capture tab audio.");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    if (err.name === "NotAllowedError") {
      setStatus("Capture cancelled. Click Start again to try once more.");
    } else {
      setStatus(`Capture failed: ${err.message}`);
    }
    return;
  }

  try {
    // Drop the video track immediately. We never use it; the audio track keeps
    // the screen-share session alive so the browser's "Sharing" indicator stays.
    stream.getVideoTracks().forEach(t => t.stop());

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setStatus("No audio in the shared stream. Re-share the tab and tick 'Share tab audio'.");
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    const audioTrack = audioTracks[0];
    state.channels = audioTrack.getSettings().channelCount ?? 2;

    audioTrack.onended = () => {
      setStatus("Sharing ended.");
      stopCapture();
    };

    audio.stream = stream;
    audio.ctx = new AudioContext();
    if (audio.ctx.state === "suspended") {
      await audio.ctx.resume();
    }
    audio.source = audio.ctx.createMediaStreamSource(stream);
    audio.gain = audio.ctx.createGain();
    audio.gain.gain.value = state.sensitivity;
    audio.splitter = audio.ctx.createChannelSplitter(2);
    audio.analyserL = audio.ctx.createAnalyser();
    audio.analyserR = audio.ctx.createAnalyser();
    audio.analyserL.fftSize = state.fftSize;
    audio.analyserR.fftSize = state.fftSize;
    audio.analyserL.smoothingTimeConstant = state.smoothing;
    audio.analyserR.smoothingTimeConstant = state.smoothing;

    audio.source.connect(audio.gain);
    audio.gain.connect(audio.splitter);
    audio.splitter.connect(audio.analyserL, 0);
    audio.splitter.connect(audio.analyserR, 1);
    setupEqChain();
    // Deliberately do NOT connect to ctx.destination: the user already hears
    // the source tab; routing through here would cause feedback.

    if (window.AudioFeatures) {
      state.audioAnalysis = window.AudioFeatures.createAudioAnalysis({
        analyserL: audio.analyserL,
        analyserR: audio.analyserR,
        sampleRate: audio.ctx.sampleRate,
        fftSize: state.fftSize,
      });
    }
    requestScreenLock();

    setRunning(true);
    setStatus("");
    document.getElementById("start-screen").hidden = true;
    document.getElementById("controls").hidden = false;

    applyState();
    requestAnimationFrame(frame);
  } catch (err) {
    setStatus(`Capture failed: ${err.message}`);
    stream.getTracks().forEach(t => t.stop());
  }
}

// Build the parallel 3-band EQ chain that feeds Waveform + Lissajous.
// Lowpass / bandpass / highpass filters each fed by `audio.gain`, each
// multiplied by a per-band GainNode (state.bandGain), summed into eqSum,
// then split into per-channel analysers used by drawWaveform/drawLissajous.
function setupEqChain() {
  const ctx = audio.ctx;
  audio.bassFilter = ctx.createBiquadFilter();
  audio.bassFilter.type = "lowpass";
  audio.bassFilter.frequency.value = 250;
  audio.midFilter = ctx.createBiquadFilter();
  audio.midFilter.type = "bandpass";
  audio.midFilter.frequency.value = 1000;  // log-centre of [250, 4000]
  audio.midFilter.Q.value = 0.5;           // wide so 250-4000 Hz passes
  audio.trebFilter = ctx.createBiquadFilter();
  audio.trebFilter.type = "highpass";
  audio.trebFilter.frequency.value = 4000;

  audio.bassMix = ctx.createGain();
  audio.midMix  = ctx.createGain();
  audio.trebMix = ctx.createGain();
  audio.bassMix.gain.value = state.bandGain.bass;
  audio.midMix.gain.value  = state.bandGain.mid;
  audio.trebMix.gain.value = state.bandGain.treb;

  audio.eqSum = ctx.createGain();
  audio.eqSplitter = ctx.createChannelSplitter(2);
  audio.eqAnalyserL = ctx.createAnalyser();
  audio.eqAnalyserR = ctx.createAnalyser();
  audio.eqAnalyserL.fftSize = state.fftSize;
  audio.eqAnalyserR.fftSize = state.fftSize;
  audio.eqAnalyserL.smoothingTimeConstant = state.smoothing;
  audio.eqAnalyserR.smoothingTimeConstant = state.smoothing;

  audio.gain.connect(audio.bassFilter);
  audio.bassFilter.connect(audio.bassMix);
  audio.bassMix.connect(audio.eqSum);
  audio.gain.connect(audio.midFilter);
  audio.midFilter.connect(audio.midMix);
  audio.midMix.connect(audio.eqSum);
  audio.gain.connect(audio.trebFilter);
  audio.trebFilter.connect(audio.trebMix);
  audio.trebMix.connect(audio.eqSum);

  audio.eqSum.connect(audio.eqSplitter);
  audio.eqSplitter.connect(audio.eqAnalyserL, 0);
  audio.eqSplitter.connect(audio.eqAnalyserR, 1);
}

async function requestScreenLock() {
  if (!state.keepScreenOn) return;
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    // Capacitor WebView on older Android versions may lack this; the native
    // FLAG_KEEP_SCREEN_ON path picks up the slack. Don't spam the user.
    return;
  }
  try {
    state.screenLock = await navigator.wakeLock.request("screen");
    state.screenLock.addEventListener("release", () => { state.screenLock = null; });
  } catch (err) {
    setStatus(`Wake lock unavailable: ${err.message || err}`);
  }
}

async function releaseScreenLock() {
  try { await state.screenLock?.release(); } catch { /* already gone */ }
  state.screenLock = null;
}

function setKeepScreenOnAndroid(enabled) {
  const plugin = window.Capacitor?.Plugins?.ScopeAudio;
  if (!plugin || !plugin.setKeepScreenOn) return;
  plugin.setKeepScreenOn({ enabled }).catch(() => { /* best-effort */ });
}

function stopCapture() {
  if (PLATFORM === "android") {
    stopCaptureAndroid();
    return;
  }
  // Idempotent: safe to call when already stopped.
  if (!state.running && !audio.stream && !audio.ctx) return;

  releaseScreenLock();

  if (audio.stream) {
    audio.stream.getTracks().forEach(t => t.stop());
    audio.stream = null;
  }
  if (audio.ctx) {
    audio.ctx.close().catch(() => {});
    audio.ctx = null;
  }
  audio.source = audio.gain = audio.splitter = audio.analyserL = audio.analyserR = null;
  audio.bassFilter = audio.midFilter = audio.trebFilter = null;
  audio.bassMix = audio.midMix = audio.trebMix = null;
  audio.eqSum = audio.eqSplitter = audio.eqAnalyserL = audio.eqAnalyserR = null;
  state.audioAnalysis = null;

  setRunning(false);
  // Note: we don't cancelAnimationFrame here. The in-flight rAF tick (if
  // any) will call `frame()`, see `!state.running`, and exit immediately
  // without scheduling another tick. No leaked timer; no need for a
  // stored rAF handle.
  document.getElementById("start-screen").hidden = false;
  document.getElementById("controls").hidden = true;
}

async function startCaptureAndroid() {
  // Lazy-lookup the registered plugin. Capacitor exposes registered native
  // plugins as window.Capacitor.Plugins.<Name>.
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScopeAudio;
  if (!plugin) {
    setStatus("Audio plugin not available. Reinstall the APK.");
    return;
  }

  // Build the AudioContext + worklet graph BEFORE asking for MediaProjection
  // permission, so the click gesture is still valid for autoplay-policy
  // purposes. If the dialog returns and the gesture has expired,
  // audio.ctx.resume() may fail and the analysers will see zeros.
  try {
    audio.ctx = new AudioContext({ sampleRate: 48000 });
    if (audio.ctx.state === "suspended") {
      await audio.ctx.resume();
    }
    await audio.ctx.audioWorklet.addModule("audio-worklet-processor.js");
  } catch (err) {
    setStatus(`Audio init failed: ${err.message || err}`);
    if (audio.ctx) { try { await audio.ctx.close(); } catch (_e) {} audio.ctx = null; }
    return;
  }

  // Pick source: mic-mode bypasses AudioPlaybackCapture (and the
  // FLAG_NO_MEDIA_PROJECTION opt-out apps set on their tracks). System mode
  // uses MediaProjection (better quality, blocked by opt-out apps).
  try {
    if (state.micMode) {
      await plugin.startMicCapture();
    } else {
      await plugin.startCapture();
    }
  } catch (err) {
    setStatus(`Capture denied: ${err.message || "permission rejected"}`);
    if (audio.ctx) { try { await audio.ctx.close(); } catch (_e) {} audio.ctx = null; }
    return;
  }

  try {
    // Guard against rare mono-only output devices: fall back to single channel
    // if the destination cannot do stereo. The worklet's process() writes only
    // outputs[0], so the right channel is just silently dropped in mono mode;
    // the Lissajous view falls back to a vertical line (the rotated convention
    // already handles mono correctly).
    const outChannels = (audio.ctx.destination.maxChannelCount >= 2) ? 2 : 1;
    state.channels = outChannels;
    audio.workletNode = new AudioWorkletNode(audio.ctx, "scope-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [outChannels],
    });
    audio.gain = audio.ctx.createGain();
    audio.gain.gain.value = state.sensitivity;
    audio.splitter = audio.ctx.createChannelSplitter(2);
    audio.analyserL = audio.ctx.createAnalyser();
    audio.analyserR = audio.ctx.createAnalyser();
    audio.analyserL.fftSize = state.fftSize;
    audio.analyserR.fftSize = state.fftSize;
    audio.analyserL.smoothingTimeConstant = state.smoothing;
    audio.analyserR.smoothingTimeConstant = state.smoothing;

    // Zero-gain sink - drives the rendering thread without audible output.
    audio.silence = audio.ctx.createGain();
    audio.silence.gain.value = 0;

    audio.workletNode.connect(audio.gain);
    audio.gain.connect(audio.splitter);
    audio.splitter.connect(audio.analyserL, 0);
    audio.splitter.connect(audio.analyserR, 1);
    setupEqChain();
    audio.analyserL.connect(audio.silence);
    audio.analyserR.connect(audio.silence);
    audio.eqAnalyserL.connect(audio.silence);
    audio.eqAnalyserR.connect(audio.silence);
    audio.silence.connect(audio.ctx.destination);

    // Subscribe to PCM events. Removed in stopCaptureAndroid.
    // Capacitor contract: addListener returns Promise<PluginListenerHandle>
    // where the handle has remove(): Promise<void>. Both calls awaited.
    audio.audioChunkHandle = await plugin.addListener("audioChunk", onAudioChunkAndroid);
    // Native service notifies us when projection-mode capture stays silent
    // while another app is actively playing (FLAG_NO_MEDIA_PROJECTION) or,
    // in mic mode, when an unflagged source becomes available again.
    audio.silentCaptureHandle = await plugin.addListener("silentCapture", onSilentCapture);
    audio.unrestrictedHandle = await plugin.addListener("unrestrictedAvailable", onUnrestrictedAvailable);
    audio.captureLostHandle = await plugin.addListener("captureLost", onCaptureLost);
  } catch (err) {
    setStatus(`Graph wire-up failed: ${err.message || err}`);
    if (audio.ctx) { try { await audio.ctx.close(); } catch (_e) {} audio.ctx = null; }
    return;
  }

  if (window.AudioFeatures) {
    state.audioAnalysis = window.AudioFeatures.createAudioAnalysis({
      analyserL: audio.analyserL,
      analyserR: audio.analyserR,
      sampleRate: audio.ctx.sampleRate,
      fftSize: state.fftSize,
    });
  }
  requestScreenLock();
  setKeepScreenOnAndroid(state.keepScreenOn);

  setRunning(true);
  setStatus("");
  document.getElementById("mobile-start").hidden = true;
  document.body.classList.remove("pre-capture");
  applyState();
  updateCaptureModeBadge();
  requestAnimationFrame(frame);
}

function onAudioChunkAndroid(event) {
  if (!audio.workletNode || !event || !event.data) return;
  // event.data is a Base64-encoded interleaved Float32Array of stereo PCM,
  // 1024 stereo frames per chunk = 2048 floats = 8192 bytes binary = 10936 chars Base64.
  // Wrap in try/catch: a malformed chunk must not crash the visualisation.
  try {
    const bin = atob(event.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // The Uint8Array is byte-aligned; reinterpret as Float32.
    const interleaved = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    // Deinterleave into per-channel arrays (worklet's port expects {left, right}).
    const frames = interleaved.length / 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0, j = 0; i < frames; i++, j += 2) {
      left[i] = interleaved[j];
      right[i] = interleaved[j + 1];
    }
    audio.workletNode.port.postMessage({ left, right }, [left.buffer, right.buffer]);
  } catch (_err) {
    // Silent drop: a bad chunk is rare and recoverable; logging would spam.
  }
}

// Called by native service when projection-mode capture is silent (zero PCM
// for ~1s) while another app is actively playing matching audio. The track
// is opted out via FLAG_NO_MEDIA_PROJECTION. Offer mic-mode fallback (or
// auto-switch if the user has opted into that in settings).
// Called by native service when MediaProjection.Callback.onStop fires:
// (a) user tapped our notification's "Stop" action; (b) user tapped Android's
// own "Stop sharing" notification; (c) audio routing change invalidated the
// mix; (d) system-imposed token expiry. Capture is dead at the native layer;
// route through the regular stopCapture flow so the JS state (UI buttons,
// audio nodes, listeners) is fully synchronised, then surface the reason.
function onCaptureLost(_e) {
  if (state.running || audio.stream || audio.ctx) {
    stopCapture();
  }
  setStatus("Capture stopped. Tap Capture audio or Capture mic to start again.");
  window.MobileUI?.showToast?.("Capture stopped");
}

function onSilentCapture() {
  if (state.micModeAuto) {
    autoSwitchToMode(true, "Switched to microphone (source is DRM-protected)");
    return;
  }
  showCaptureBanner({
    text: "This audio source can't be captured by Scope (DRM-protected). Use the phone's microphone instead?",
    accept: "Use microphone",
    onAccept: () => {
      hideCaptureBanner();
      autoSwitchToMode(true, "Switched to microphone");
    },
  });
}

// Called by native service when mic-mode polling finds an unflagged source.
function onUnrestrictedAvailable() {
  if (!state.micMode) return;
  if (state.micModeAuto) {
    autoSwitchToMode(false, "Switched back to system audio (unrestricted source available)");
    return;
  }
  showCaptureBanner({
    text: "An unrestricted audio source is now playing. Switch back to higher-quality system audio?",
    accept: "Switch back",
    onAccept: () => {
      hideCaptureBanner();
      autoSwitchToMode(false, "Switched to system audio");
    },
  });
}

// Switch between projection and mic mode without re-opening the consent
// dialog more than necessary. Stops capture, flips state.micMode, restarts.
// Always surfaces a toast so the user knows the source changed under them.
// The 50ms gap between stop and start lets the previous foreground service
// finish its onDestroy before we ask the system to start a fresh one - the
// native stopService() is async and racing it has produced double-source
// chunk delivery in testing.
async function autoSwitchToMode(micMode, toastText) {
  state.micMode = micMode;
  showCaptureToast(toastText, 2000);
  // Pass suppressMobileStartReshow=true so the welcome card stays hidden
  // during the stop->start gap; otherwise the user sees it flash. The
  // suppression is scoped to this call only - if the user taps Stop
  // directly from another path during the gap, that path goes through
  // the default behaviour and the welcome card returns as expected.
  await stopCaptureAndroid({ suppressMobileStartReshow: true });
  await new Promise(resolve => setTimeout(resolve, 50));
  await startCaptureAndroid();
  // (startCaptureAndroid already calls updateCaptureModeBadge after
  // flipping state.running, so no explicit call needed here.)
}

// Persistent "SYSTEM" / "MIC" pill in the top-right that shows which source
// the visualisation is reading from. Hidden when capture is not running.
function updateCaptureModeBadge() {
  let el = document.getElementById("capture-mode-badge");
  if (!el) {
    el = document.createElement("div");
    el.id = "capture-mode-badge";
    document.body.appendChild(el);
  }
  const props = nextCaptureModeBadgeProps(state);
  el.hidden = props.hidden;
  if (!props.hidden) {
    el.textContent = props.text;
    el.className = props.className;
  }
}

let captureToastTimer = null;
function showCaptureToast(text, ms) {
  let el = document.getElementById("capture-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "capture-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  if (captureToastTimer) clearTimeout(captureToastTimer);
  captureToastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function showCaptureBanner({ text, accept, onAccept }) {
  let el = document.getElementById("capture-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "capture-banner";
    document.body.appendChild(el);
  }
  el.textContent = "";
  const msg = document.createElement("span");
  msg.textContent = text;
  msg.className = "capture-banner-msg";
  const btn = document.createElement("button");
  btn.textContent = accept;
  btn.className = "capture-banner-accept";
  btn.addEventListener("click", onAccept);
  const dismiss = document.createElement("button");
  dismiss.textContent = "×";
  dismiss.className = "capture-banner-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.addEventListener("click", hideCaptureBanner);
  el.appendChild(msg);
  el.appendChild(btn);
  el.appendChild(dismiss);
  el.hidden = false;
}

function hideCaptureBanner() {
  const el = document.getElementById("capture-banner");
  if (el) el.hidden = true;
}

async function stopCaptureAndroid(opts) {
  releaseScreenLock();
  setKeepScreenOnAndroid(false);

  if (audio.audioChunkHandle && audio.audioChunkHandle.remove) {
    await audio.audioChunkHandle.remove();
    audio.audioChunkHandle = null;
  }
  if (audio.silentCaptureHandle && audio.silentCaptureHandle.remove) {
    await audio.silentCaptureHandle.remove();
    audio.silentCaptureHandle = null;
  }
  if (audio.unrestrictedHandle && audio.unrestrictedHandle.remove) {
    await audio.unrestrictedHandle.remove();
    audio.unrestrictedHandle = null;
  }
  if (audio.captureLostHandle && audio.captureLostHandle.remove) {
    await audio.captureLostHandle.remove();
    audio.captureLostHandle = null;
  }
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScopeAudio;
  if (plugin) {
    try { await plugin.stopCapture(); } catch (_e) {}
  }
  if (audio.ctx) {
    try { await audio.ctx.close(); } catch (_e) {}
    audio.ctx = null;
  }
  audio.workletNode = audio.gain = audio.splitter = audio.analyserL = audio.analyserR = audio.silence = null;
  audio.bassFilter = audio.midFilter = audio.trebFilter = null;
  audio.bassMix = audio.midMix = audio.trebMix = null;
  audio.eqSum = audio.eqSplitter = audio.eqAnalyserL = audio.eqAnalyserR = null;
  state.audioAnalysis = null;
  setRunning(false);
  updateCaptureModeBadge();
  if (typeof document !== "undefined" && !(opts && opts.suppressMobileStartReshow)) {
    document.getElementById("mobile-start").hidden = false;
    document.body.classList.add("pre-capture");
  }
}

// ---- TV mode: a receive-only renderer fed by analysis frames from a paired
// phone. The phone captures + computes the requested arrays natively (screen
// can be off); the TV runs the existing audio-features + draw pipeline against
// a duck-typed AnalyserNode shim backed by the decoded frame. ----

let tvFrame = null;
let tvPairCode = null;   // latest code, kept so it persists across disconnects (plan I3)
let tvLanIp = null;      // this TV's LAN IPv4, shown so a phone can type it manually
const TV_PORT = 8765;    // receiver port; matches TvReceiverService.PORT

function base64ToArrayBuffer(b64) {
  const s = atob(b64), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}

// Nearest-pick resample of `src` into the caller-sized `out`; fills with `fb`
// when no frame has arrived yet so the draw loop has defined buffers.
function fillResample(out, src, fb) {
  if (!src || !src.length) { out.fill(fb); return; }
  const n = out.length, m = src.length;
  if (m === 1 || n === 1) { out.fill(src[0]); return; }
  // Linear interpolation (not nearest-pick) so a low-point-count frame upsized
  // to the draw buffer is smooth, not staircased.
  for (let i = 0; i < n; i++) {
    const pos = i * (m - 1) / (n - 1);
    const lo = pos | 0, hi = Math.min(m - 1, lo + 1), t = pos - lo;
    out[i] = src[lo] * (1 - t) + src[hi] * t;
  }
}

// Minimal AnalyserNode surface the draws + audio-features actually use:
// getFloatTimeDomainData (waveform/lissajous + silence probe + RMS),
// getFloatFrequencyData (spectrum, dB), getByteFrequencyData (bass/mid/treb).
function makeTvAnalyser(getTime, getFreq) {
  return {
    fftSize: state.fftSize,
    frequencyBinCount: state.fftSize >> 1,
    smoothingTimeConstant: state.smoothing,
    getFloatTimeDomainData(out) { fillResample(out, getTime(), 0); },
    getFloatFrequencyData(out) { fillResample(out, getFreq(), -140); },
    getByteFrequencyData(out) {
      const f = getFreq();
      if (!f || !f.length) { out.fill(0); return; }
      const n = out.length, m = f.length;
      for (let i = 0; i < n; i++) {
        const db = f[Math.min(m - 1, (i * m / n) | 0)];   // dB in [-100, 0]
        const v = Math.round((db + 100) * 2.55);          // -> [0, 255]
        out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    },
  };
}

// Pure: builds the two overlay lines. `main` is the pair code (or a status
// message); `sub` is the LAN address a phone can type when discovery fails.
function pairOverlayLines({ text, ip, port }) {
  const isCode = /^\d{4}$/.test(String(text));
  const main = isCode ? `Pair code: ${text}` : String(text);
  const sub = ip ? `${ip}:${port}` : "";
  return { main, sub };
}

function showPairOverlay(text) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("tv-pair-overlay");
  if (!el) return;
  const { main, sub } = pairOverlayLines({ text, ip: tvLanIp, port: TV_PORT });
  el.innerHTML = "";
  const m = document.createElement("div");
  m.className = "tv-pair-main";
  m.textContent = main;
  el.appendChild(m);
  if (sub) {
    const s = document.createElement("div");
    s.className = "tv-pair-sub";
    s.textContent = sub;
    el.appendChild(s);
  }
  el.hidden = false;
}
function hidePairOverlay() {
  const el = document.getElementById("tv-pair-overlay");
  if (el) el.hidden = true;
}

// TV view switching from the remote: D-pad right / OK cycles forward, left back.
// cycleView updates state.view + calls applyState, which (in TV mode) sends the
// new render-request to the paired phone so it adapts what it computes.
function wireTvRemote() {
  if (typeof document === "undefined") return;
  document.addEventListener("keydown", (e) => {
    const dispatch = (direction) => {
      if (state.paired) {
        // Round-trip via phone: compute the new view locally (without mutating
        // state.view) and ask the phone to apply. The phone will mirror back
        // and our tvRenderRequest listener (above) will then set state.view.
        const order = window.ViewIds.VIEW_ORDER;
        const idx = order.indexOf(state.view);
        const next = order[(idx + direction + order.length) % order.length];
        const v = window.ViewIds.viewToId(next);
        window.Capacitor?.Plugins?.ScopeAudio?.sendRenderRequest({
          type: "remote-view-request", view: v,
        });
      } else {
        // Standalone TV mode (no phone paired): preserve the current cycle behaviour.
        window.MobileUI?.cycleView(direction, state, applyState);
      }
    };
    if (e.key === "ArrowRight" || e.key === "Enter") dispatch(+1);
    else if (e.key === "ArrowLeft") dispatch(-1);
  });
}

async function startTvMode() {
  const plugin = window.Capacitor?.Plugins?.ScopeAudio;
  if (!plugin) return;
  audio.analyserL = makeTvAnalyser(() => tvFrame && tvFrame.waveform, () => tvFrame && tvFrame.fft);
  audio.analyserR = makeTvAnalyser(() => tvFrame && (tvFrame.waveformR || tvFrame.waveform), () => tvFrame && tvFrame.fft);
  if (window.AudioFeatures) {
    state.audioAnalysis = window.AudioFeatures.createAudioAnalysis({
      analyserL: audio.analyserL, analyserR: audio.analyserR, sampleRate: 48000, fftSize: state.fftSize,
    });
  }
  await plugin.addListener("tvAnalysisFrame", e => {
    try { tvFrame = window.decodeAnalysisFrame(base64ToArrayBuffer(e.data)); } catch (_e) { /* drop bad frame */ }
  });
  await plugin.addListener("tvPairCode", e => { tvPairCode = e.code; showPairOverlay(e.code); });
  await plugin.addListener("tvConnected", () => {
    hidePairOverlay();
    sendTvRenderRequest();
    state.paired = true;
  });
  // On disconnect the code is still valid and the TV re-advertises, so keep it
  // on screen (with a hint) rather than hiding it - a returning phone needs it.
  await plugin.addListener("tvDisconnected", () => {
    showPairOverlay(tvPairCode || "Waiting for phone...");
    state.paired = false;
  });
  // TV-side: phone-pushed mirror state. Update state.view + state.theme then
  // re-render via applyState (which also re-issues a render-request back to
  // the phone so the phone computes the right analysis for the new view).
  await plugin.addListener("tvRenderRequest", (e) => {
    let payload;
    try { payload = JSON.parse(e.json); } catch (_err) { return; }
    if (payload && payload.type === "mirror-state") {   // forward-compat: unknown types ignored
      const { view, theme } = payload;
      state.view = window.ViewIds.idToView(view);
      if (themes[theme]) state.theme = theme;
      applyState();
    }
  });
  wireTvRemote();
  const res = await plugin.startTvReceiver();
  tvPairCode = res.code;
  tvLanIp = res.ip || null;
  showPairOverlay(res.code);
  setRunning(true);
  requestAnimationFrame(frame);
}

// Tell the phone which arrays to compute for the current view.
function sendTvRenderRequest() {
  const v = window.ViewIds.viewToId(state.view);
  window.Capacitor?.Plugins?.ScopeAudio?.sendRenderRequest({
    type: "render-request", view: v, waveformPoints: state.fftSize, fftBins: state.fftSize >> 1, channels: (v === 2 || v >= 6) ? 2 : 1, fftSize: state.fftSize,
  });
}

// ---- Phone side: discover + pair to a TV, then stream from capture. ----

function renderTvList(found) {
  if (typeof document === "undefined") return;
  let modal = document.getElementById("tv-connect-modal");
  if (!modal) { modal = document.createElement("div"); modal.id = "tv-connect-modal"; document.body.appendChild(modal); }
  modal.innerHTML = "";
  const title = document.createElement("div");
  title.className = "tv-connect-title";
  title.textContent = found.length ? "Tap a TV to pair" : "Searching for TVs...";
  modal.appendChild(title);
  for (const tv of found) {
    const b = document.createElement("button");
    b.className = "tv-connect-item";
    b.textContent = `${tv.name} (${tv.host})`;
    b.addEventListener("click", () => pairWithTv(tv.host, tv.port));
    modal.appendChild(b);
  }
  const manual = document.createElement("button");
  manual.className = "tv-connect-item";
  manual.textContent = "Enter IP manually";
  manual.addEventListener("click", () => {
    const hp = window.prompt("TV address (host:port)", "192.168.0.6:8765");
    if (!hp) return;
    const idx = hp.lastIndexOf(":");
    const host = idx >= 0 ? hp.slice(0, idx).trim() : hp.trim();
    const port = idx >= 0 ? parseInt(hp.slice(idx + 1), 10) : 8765;
    pairWithTv(host, port);
  });
  modal.appendChild(manual);
  const cancel = document.createElement("button");
  cancel.className = "tv-connect-item tv-connect-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => modal.remove());
  modal.appendChild(cancel);
}

// Keep only digits, capped at 4 - the pairing code is always 4 digits.
function sanitizePairCode(raw) {
  return String(raw == null ? "" : raw).replace(/\D/g, "").slice(0, 4);
}

// In-DOM numeric code entry. window.prompt cannot request a numeric keyboard
// or reliably autofocus, so build a small modal whose input raises the digits
// soft-keyboard on focus. Resolves to the 4-digit string, or null on cancel.
function promptPairCode() {
  return new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(null); return; }
    const modal = document.createElement("div");
    modal.id = "tv-code-modal";
    const title = document.createElement("div");
    title.className = "tv-connect-title";
    title.textContent = "Enter the 4-digit code shown on the TV";
    const input = document.createElement("input");
    input.id = "tv-code-input";
    input.type = "tel";
    input.inputMode = "numeric";
    input.maxLength = 4;
    input.setAttribute("pattern", "[0-9]*");
    input.setAttribute("autocomplete", "one-time-code");
    input.addEventListener("input", () => { input.value = sanitizePairCode(input.value); });
    let settled = false;
    const done = (val) => { if (settled) return; settled = true; modal.remove(); resolve(val); };
    const ok = document.createElement("button");
    ok.className = "tv-connect-item";
    ok.textContent = "Pair";
    ok.addEventListener("click", () => done(sanitizePairCode(input.value)));
    const cancel = document.createElement("button");
    cancel.className = "tv-connect-item tv-connect-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => done(null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(sanitizePairCode(input.value)); });
    modal.appendChild(title); modal.appendChild(input); modal.appendChild(ok); modal.appendChild(cancel);
    document.body.appendChild(modal);
    // Focus synchronously within the originating tap so Android raises the
    // numeric soft keyboard immediately.
    input.focus();
  });
}

async function pairWithTv(host, port) {
  const code = await promptPairCode();
  if (!code) return;
  document.getElementById("tv-connect-modal")?.remove();
  try { await window.Capacitor?.Plugins?.ScopeAudio?.connectTv({ host, port, code }); }
  catch (_e) { window.MobileUI?.showToast("Pairing failed"); }
}

async function connectToTv() {
  const plugin = window.Capacitor?.Plugins?.ScopeAudio;
  if (!plugin) return;
  window.MobileUI?.closeDrawer();
  const found = [];
  await plugin.addListener("tvFound", e => {
    if (!found.some(t => t.host === e.host && t.port === e.port)) { found.push(e); renderTvList(found); }
  });
  await plugin.addListener("tvConnected", () => {
    window.MobileUI?.showToast("Streaming to TV");
    state.paired = true;
    sendPhoneMirror();   // initial sync: TV picks up the phone's current view + theme immediately
  });
  await plugin.addListener("tvDisconnected", () => {
    window.MobileUI?.showToast("TV disconnected");
    state.paired = false;
  });
  // Phone-side: TV remote D-pad arrived (round-trip-via-phone). Update view
  // locally and re-render; applyState's mirror gating will then push the
  // resolved view back to the TV.
  await plugin.addListener("phoneViewRequest", (e) => {
    const view = e?.view;
    if (typeof view !== "number" || view < 0 || view >= window.ViewIds.VIEW_ORDER.length) return;
    state.view = window.ViewIds.idToView(view);
    applyState();
  });
  renderTvList(found);
  await plugin.discoverTvs();
}
if (typeof window !== "undefined") window.connectToTv = connectToTv;

// Phone-side: push the current view + theme to the paired TV so the TV mirrors
// the phone's visual state. No-op when not paired - the JS-side state.paired
// gates the call (the Kotlin side also no-ops when the socket is not connected).
function sendPhoneMirror() {
  const v = window.ViewIds.viewToId(state.view);
  window.Capacitor?.Plugins?.ScopeAudio?.sendPhoneMirror({
    type: "mirror-state", view: v, theme: state.theme,
  });
}

function applyState() {
  if (window.PaletteSets) state.theme = window.PaletteSets.reconcileTheme(state.view, state.theme);
  // When Auto-gain is ON, the per-frame envelope follower writes gain
  // directly; don't clobber it from the slider value.
  if (audio.gain && !state.autoGain) {
    audio.gain.gain.value = state.sensitivity;
  }
  if (audio.analyserL && audio.analyserR) {
    audio.analyserL.fftSize = state.fftSize;
    audio.analyserR.fftSize = state.fftSize;
    audio.analyserL.smoothingTimeConstant = state.smoothing;
    audio.analyserR.smoothingTimeConstant = state.smoothing;
  }
  if (state.tvMode && audio.analyserL && audio.analyserR) {
    audio.analyserL.frequencyBinCount = state.fftSize >> 1;
    audio.analyserR.frequencyBinCount = state.fftSize >> 1;
    sendTvRenderRequest();   // tell the phone what the new view needs
  }
  // Phone-side mirror: when paired and NOT the TV, push view + theme to TV.
  if (!state.tvMode && state.paired) sendPhoneMirror();
  if (audio.eqAnalyserL && audio.eqAnalyserR) {
    audio.eqAnalyserL.fftSize = state.fftSize;
    audio.eqAnalyserR.fftSize = state.fftSize;
    audio.eqAnalyserL.smoothingTimeConstant = state.smoothing;
    audio.eqAnalyserR.smoothingTimeConstant = state.smoothing;
  }
  if (audio.bassMix) audio.bassMix.gain.value = state.bandGain.bass;
  if (audio.midMix)  audio.midMix.gain.value  = state.bandGain.mid;
  if (audio.trebMix) audio.trebMix.gain.value = state.bandGain.treb;
  if (pixi.trailSprite) {
    pixi.trailSprite.filters = themes[state.theme].filters;
  }
  document.documentElement.style.setProperty("--fg", themes[state.theme].fgCss);

  // Sync UI controls to state (so hotkeys reflect in the dropdowns).
  const viewSel = document.getElementById("view");
  const themeSel = document.getElementById("theme");
  const gainEl = document.getElementById("gain");
  const fftEl = document.getElementById("fft");
  const smoothEl = document.getElementById("smooth");
  if (viewSel) viewSel.value = state.view;
  if (themeSel) themeSel.value = state.theme;
  if (gainEl) {
    gainEl.value = String(state.sensitivity);
    gainEl.disabled = !!state.autoGain;
  }
  if (fftEl) fftEl.value = String(state.fftSize);
  if (smoothEl) smoothEl.value = String(state.smoothing);
  const autoEl = document.getElementById("autogain");
  if (autoEl) autoEl.checked = !!state.autoGain;
  const keepEl = document.getElementById("keepawake");
  if (keepEl) keepEl.checked = !!state.keepScreenOn;
  const bassEl = document.getElementById("eq-bass");
  if (bassEl) bassEl.value = String(state.bandGain.bass);
  const midEl = document.getElementById("eq-mid");
  if (midEl) midEl.value = String(state.bandGain.mid);
  const trebEl = document.getElementById("eq-treb");
  if (trebEl) trebEl.value = String(state.bandGain.treb);

  // Mono guard for the Lissajous tab.
  if (viewSel) {
    const lissOpt = viewSel.querySelector('option[value="lissajous"]');
    if (lissOpt) {
      lissOpt.disabled = state.channels === 1;
      lissOpt.title = state.channels === 1 ? "Source is mono - no stereo to plot." : "";
    }
  }

  if (PLATFORM === "android" && window.MobileUI) {
    window.MobileUI.refreshDrawer(state);
  }
}

let silentMs = 0;
let lastFrameTime = 0;
const SILENT_THRESHOLD = 0.005;
const SILENT_TIMEOUT_MS = 3000;
const SILENT_MESSAGE = "No signal detected. Is the source playing?";

function frame() {
  if (!state.running) return;
  try {
    frameBody();
  } catch (err) {
    // A silent throw inside frame() previously killed the rAF chain and left
    // the user staring at solid black. Surface the message and keep trying:
    // the next tick may succeed if it was a transient WebGL hiccup.
    setStatus(`Render error: ${err.message || err}`);
  }
  requestAnimationFrame(frame);
}

function frameBody() {
  const now = performance.now();
  const dt = lastFrameTime === 0 ? 0 : now - lastFrameTime;
  lastFrameTime = now;

  // Run the projectM-derived envelope follower + beat detector before
  // anything downstream consumes state.audio (silent-threshold scan uses
  // peak independently; auto-gain math, mesh-warp, palette-color, and
  // hue-on-beat all read state.audio).
  if (state.audioAnalysis) {
    state.audio = state.audioAnalysis.update(dt / 1000, now);
  }
  if (state.tempo && state.audio.beat) state.tempo.beat(now);
  if (state.tempo && now - state.lastHueBakeMs > 60000) {
    state.lastHueBakeMs = now;
    state.hueOffsetDeg = window.AudioFeatures.bpmToHueDeg(state.tempo.avgBpm());
    if (window.PaletteColor) {
      for (const key of Object.keys(themes)) window.PaletteColor.bakeRamp(themes[key], state.hueOffsetDeg);
    }
  }

  if (audio.analyserL) {
    const probe = new Float32Array(audio.analyserL.fftSize);
    audio.analyserL.getFloatTimeDomainData(probe);
    let peak = 0;
    for (let i = 0; i < probe.length; i++) {
      const v = Math.abs(probe[i]);
      if (v > peak) peak = v;
    }
    if (peak < SILENT_THRESHOLD) silentMs += dt;
    else silentMs = 0;
    if (silentMs > SILENT_TIMEOUT_MS) {
      setStatus(SILENT_MESSAGE);
    } else {
      const statusEl = document.getElementById("status");
      if (statusEl && statusEl.textContent === SILENT_MESSAGE) {
        setStatus("");
      }
    }
  }

  // Auto-gain: normalise time-domain RMS (matches the units the gain node
  // operates on) toward TARGET_LEVEL. Using bass-band FFT sum here was a
  // unit mismatch that drove gain to the floor on first frame.
  if (state.autoGain && audio.gain && state.audio.rmsLongAverage > 0) {
    const longAvg = Math.max(MIN_LONG, state.audio.rmsLongAverage);
    const gainCeil = state.micMode ? GAIN_MAX_MIC : GAIN_MAX;
    let targetGain = TARGET_LEVEL / longAvg;
    if (targetGain < GAIN_MIN) targetGain = GAIN_MIN;
    else if (targetGain > gainCeil) targetGain = gainCeil;
    const current = audio.gain.gain.value;
    audio.gain.gain.value = current + (targetGain - current) * AUTO_GAIN_LERP;
  }

  const theme = themes[state.theme];
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Step 1: decay (or full clear) on the trail texture.
  pixi.fade.clear();
  const decayAlpha = VIEW_DECAY[state.view] ?? theme.decayAlpha;
  pixi.fade.rect(0, 0, w, h).fill({ color: 0x000000, alpha: decayAlpha });
  pixi.app.renderer.render(pixi.fade, { renderTexture: pixi.trail, clear: false });

  // Step 2: build this frame's fresh trace. mesh-warp is applied to the
  // trail sprite each frame; bassAtt scales the rotation amplitude.
  if (pixi.trailSprite && window.MeshWarp) {
    const { scale, rotation } = window.MeshWarp.meshTransform(
      state.audio.bassAtt || 0, now / 1000
    );
    pixi.trailSprite.scale.set(scale);
    pixi.trailSprite.rotation = rotation;
  }

  pixi.current.clear();
  if (state.view === "waveform")  drawWaveform(pixi.current, audio.eqAnalyserL || audio.analyserL, theme, w, h);
  if (state.view === "spectrum")  drawSpectrum(pixi.current, audio.analyserL, theme, w, h);
  if (state.view === "lissajous") drawLissajous(pixi.current,
    audio.eqAnalyserL || audio.analyserL,
    audio.eqAnalyserR || audio.analyserR,
    theme, w, h);
  if (state.view === "cosmos") drawCosmos(pixi.current, theme, w, h);
  if (state.view === "grove") drawGrove(pixi.current, audio.eqAnalyserL || audio.analyserL, theme, w, h);
  if (state.view === "firebird") drawFirebird(pixi.current, theme, w, h);
  if (state.view === "spiral") drawSpiral(pixi.current, audio.eqAnalyserL || audio.analyserL, audio.eqAnalyserR || audio.analyserR, theme, w, h);
  if (state.view === "bloom") drawBloom(pixi.current, audio.eqAnalyserL || audio.analyserL, audio.eqAnalyserR || audio.analyserR, theme, w, h);
  if (state.view === "lasso") drawLasso(pixi.current, audio.eqAnalyserL || audio.analyserL, audio.eqAnalyserR || audio.analyserR, theme, w, h);
  if (state.view === "starburst") drawStarburst(pixi.current, audio.eqAnalyserL || audio.analyserL, audio.eqAnalyserR || audio.analyserR, theme, w, h);
  if (state.view === "nova") drawNova(pixi.current, audio.eqAnalyserL || audio.analyserL, audio.eqAnalyserR || audio.analyserR, theme, w, h);

  // Step 3: bake current onto the trail texture.
  pixi.app.renderer.render(pixi.current, { renderTexture: pixi.trail, clear: false });

  // PixiJS automatically presents the stage (which contains trailSprite) on the next tick.
}

// Persistent buffers for temporal smoothing across frames. AnalyserNode's
// smoothingTimeConstant only affects getFloatFrequencyData (FFT bins), not
// getFloatTimeDomainData - so we apply a manual lerp on top of the raw
// time-domain data using state.smoothing as the lerp coefficient. This
// makes the smoothing control visibly affect waveform and Lissajous, not
// just the spectrum view.
const smoothedTime = { L: null, R: null };

function smoothBuf(slot, raw, alpha) {
  if (alpha <= 0) return raw;
  const prev = smoothedTime[slot];
  if (!prev || prev.length !== raw.length) {
    const fresh = new Float32Array(raw);
    smoothedTime[slot] = fresh;
    return fresh;
  }
  for (let i = 0; i < raw.length; i++) {
    prev[i] = prev[i] * alpha + raw[i] * (1 - alpha);
  }
  return prev;
}

// Scratch buffers reused frame-to-frame for projectM's PCM 2-tap pre-smoother.
// Allocated lazily per-channel so fftSize changes at runtime do not crash.
const pcmScratch = { L: null, R: null };

function getPcmScratch(slot, n) {
  if (!pcmScratch[slot] || pcmScratch[slot].length !== n) {
    pcmScratch[slot] = new Float32Array(n);
  }
  return pcmScratch[slot];
}

function strokeMultiOffset(g, points, theme, w, h, time, beatPulse) {
  // Draw the polyline at 4 diagonal corner offsets at half alpha, then once
  // centred at full alpha. Adapted from projectM's waveThick (Waveform.cpp).
  const color = window.PaletteColor
    ? window.PaletteColor.currentColor(theme, time, beatPulse)
    : theme.fg;
  for (let o = 0; o < THICK_OFFSETS.length; o++) {
    const [dx, dy] = THICK_OFFSETS[o];
    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i];
      if (i === 0) g.moveTo(px + dx, py + dy);
      else g.lineTo(px + dx, py + dy);
    }
    g.stroke({ color, width: theme.lineWidth, alpha: 0.5 });
  }
  for (let i = 0; i < points.length; i++) {
    const [px, py] = points[i];
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke({ color, width: theme.lineWidth, alpha: 1.0 });
}

// Gradient stroke: colour each segment by its position along the curve using
// the palette's baked ramp (PaletteColor.colorAt). Falls back to fg for ramp-less
// (generic) palettes, so a shape view under e.g. Neon is single-colour.
// Pixi v8: stroke() applies only to geometry added since the last stroke()/fill(),
// so each moveTo/lineTo/stroke() colours one segment independently (same path-flush
// mechanism strokeMultiOffset relies on for its 5 passes).
function strokeGradient(g, points, theme) {
  const n = points.length;
  if (n < 2) return;
  const PC = window.PaletteColor;
  const glow = PC ? PC.colorAt(theme, 0.5) : theme.fg;
  for (let i = 0; i < n - 1; i++) { g.moveTo(points[i][0], points[i][1]); g.lineTo(points[i+1][0], points[i+1][1]); }
  g.stroke({ color: glow, width: theme.lineWidth * 3, alpha: 0.18 });
  for (let i = 0; i < n - 1; i++) {
    const color = PC ? PC.colorAt(theme, i / (n - 1)) : theme.fg;
    g.moveTo(points[i][0], points[i][1]);
    g.lineTo(points[i+1][0], points[i+1][1]);
    g.stroke({ color, width: theme.lineWidth, alpha: 1.0 });
  }
}

function drawWaveform(g, analyser, theme, w, h) {
  if (!analyser) return;
  const raw = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(raw);
  let buf, start;
  if (state.tvMode) {
    // Phone-side prep (5a) already ran pcmSmooth + smoothBuf + findZeroCrossing
    // + trim before encoding the wire frame. Re-running those here would either
    // double-smooth or re-trim to a later cycle's crossing (visible cycle jumps).
    buf = raw;
    start = 0;
  } else {
    const preSmooth = window.AudioFeatures
      ? window.AudioFeatures.pcmSmooth(raw, getPcmScratch("L", raw.length))
      : raw;
    buf = smoothBuf("L", preSmooth, state.smoothing);
    start = findZeroCrossing(buf);
  }
  const len = buf.length - start;
  if (len < 2) return;

  const points = new Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * w;
    const y = h / 2 - buf[start + i] * (h / 2) * 0.9;
    points[i] = [x, y];
  }
  const now = performance.now() / 1000;
  strokeMultiOffset(g, points, theme, w, h, now, state.audio.beatPulse || 0);
}

function drawSpectrum(g, analyser, theme, w, h) {
  if (!analyser) return;
  const bins = analyser.frequencyBinCount;
  const buf = new Float32Array(bins);
  analyser.getFloatFrequencyData(buf);

  const points = spectrumPolylinePoints(
    buf, audio.ctx.sampleRate, analyser.fftSize, w, h, -100, -30
  );
  if (points.length === 0) return;

  const color = window.PaletteColor
    ? window.PaletteColor.currentColor(theme, performance.now() / 1000, state.audio.beatPulse || 0)
    : theme.fg;

  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill({ color, alpha: 0.5 });
  g.stroke({ color, width: theme.lineWidth });
}

function drawLissajous(g, analyserL, analyserR, theme, w, h) {
  if (!analyserL || !analyserR) return;
  const n = analyserL.fftSize;
  const rawL = new Float32Array(n);
  const rawR = new Float32Array(n);
  analyserL.getFloatTimeDomainData(rawL);
  analyserR.getFloatTimeDomainData(rawR);
  let bufL, bufR;
  if (state.tvMode) {
    // Phone-side prep (5a) already smoothed both channels. Skip to avoid double-smoothing.
    bufL = rawL;
    bufR = rawR;
  } else {
    const preL = window.AudioFeatures
      ? window.AudioFeatures.pcmSmooth(rawL, getPcmScratch("L", n))
      : rawL;
    const preR = window.AudioFeatures
      ? window.AudioFeatures.pcmSmooth(rawR, getPcmScratch("R", n))
      : rawR;
    bufL = smoothBuf("L", preL, state.smoothing);
    bufR = smoothBuf("R", preR, state.smoothing);
  }

  const radius = Math.min(w, h) * 0.4;
  const cx = w / 2;
  const cy = h / 2;
  const inv = 1 / Math.SQRT2;

  // Base PI/2 swaps the vertical L+R dominant axis to horizontal; the figure
  // then sways gently around horizontal (never reaching vertical).
  const now = performance.now() / 1000;
  const theta = Math.PI / 2 + LISSAJOUS_SWAY * Math.sin((2 * Math.PI / LISSAJOUS_SWAY_PERIOD) * now);
  const points = new Array(n);
  for (let i = 0; i < n; i++) {
    const xr = (bufL[i] - bufR[i]) * radius * inv;
    const yr = (bufL[i] + bufR[i]) * radius * inv;
    const [rx, ry] = window.ViewGeometry.rotateXY(xr, yr, theta);
    points[i] = [cx + rx, cy - ry];
  }
  strokeMultiOffset(g, points, theme, w, h, now, state.audio.beatPulse || 0);
}

const cosmos = { rings: [], lastT: 0, sinceSpawn: 0 };

// Tempo-driven concentric rings: one ring is born per beat-period (from the
// avgBpm tracker), expands to a screen-fitting radius over ~2 beats, then
// fades at the rim. No waveform wrapping - that read as chaos; the rhythm
// follows the music's tempo instead. A subtle bass pulse adds life; a ring
// born on a detected beat is drawn brighter/thicker as an accent.
function drawCosmos(g, theme, w, h) {
  const now = performance.now() / 1000;
  const dt = cosmos.lastT ? Math.min(0.05, now - cosmos.lastT) : 0.016;
  cosmos.lastT = now;

  const a = state.audio || {};
  const bp = a.beatPulse || 0;                            // 0..1, spikes per beat
  const att = Math.max(0, (a.bassAtt || 1) - 1);          // excess bass, 0 baseline
  const bpm = state.tempo ? state.tempo.avgBpm() : 120;   // clamped 40..200
  const beatPeriod = 60 / bpm;
  const speed = (1 / (2.2 * beatPeriod)) * (1 + att * 0.6);  // bass drives the travel

  for (const r of cosmos.rings) r.depth += speed * dt;
  cosmos.rings = cosmos.rings.filter(r => r.depth < 1);

  // A bright ring emanates on every detected beat; a steady tempo-paced ring
  // fills in if no beat has landed for a beat-period so it never stalls.
  cosmos.sinceSpawn += dt;
  if (a.beat && cosmos.rings.length < 24) {
    cosmos.rings.push({ depth: 0.001, accent: true });
    cosmos.sinceSpawn = 0;
  } else if (cosmos.sinceSpawn >= beatPeriod && cosmos.rings.length < 24) {
    cosmos.sinceSpawn -= beatPeriod;
    cosmos.rings.push({ depth: 0.001, accent: false });
  }

  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(w, h) * 0.46;          // largest ring stays on-screen
  const pulse = 1 + bp * 0.12;                  // whole field pulses on the beat
  const PC = window.PaletteColor;
  for (const r of cosmos.rings) {
    const t = r.depth;
    const radius = (6 + maxR * t) * pulse;
    const color = PC ? PC.colorAt(theme, t) : theme.fg;
    const alpha = Math.min(1, (1 - t) * 1.5) * (r.accent ? 1 : 0.55);
    g.circle(cx, cy, radius).stroke({
      color, width: r.accent ? theme.lineWidth * 2.5 : theme.lineWidth, alpha,
    });
  }
}

const grove = { leaves: null, edge: null, lastT: 0, sinceSpawn: 0 };

function drawGrove(g, analyser, theme, w, h) {
  if (!analyser) return;
  const raw = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(raw);
  const now = performance.now() / 1000;
  const dt = grove.lastT ? Math.min(0.05, now - grove.lastT) : 0.016;
  grove.lastT = now;

  const a = state.audio || {};
  const N = 40;
  if (!grove.edge || grove.edge.length !== N) grove.edge = new Float32Array(N);
  // Downsample with local averaging (spatial smoothing) + a temporal EMA so the
  // canopy silhouette undulates gently instead of tracing raw waveform noise.
  const step = raw.length / N;
  for (let i = 0; i < N; i++) {
    const base = Math.floor(i * step);
    const span = Math.max(1, Math.floor(step));
    let s = 0;
    for (let k = 0; k < span; k++) s += raw[Math.min(raw.length - 1, base + k)];
    grove.edge[i] = grove.edge[i] * 0.82 + (s / span) * 0.18;
  }

  const VG = window.ViewGeometry, PC = window.PaletteColor;
  const baseY = h * 0.42;
  const amp = h * 0.06 * (1 + (a.bassAtt || 0) * 0.5);   // calmer than before
  const poly = VG.canopyEdge(grove.edge, { w, h, baseY, amp });

  const foliage = PC ? PC.colorAt(theme, 0.45) : theme.fg;
  g.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
  g.closePath();
  g.fill({ color: foliage, alpha: 0.85 });

  // Trunks at a fixed 20/40/60/80% spread.
  const bark = PC ? PC.colorAt(theme, 0.18) : theme.fg;
  for (let i = 1; i <= 4; i++) {
    const x = (i / 5) * w;
    const yTop = baseY - grove.edge[Math.floor((i / 5) * N)] * amp;
    g.moveTo(x, yTop); g.lineTo(x, h);
    g.stroke({ color: bark, width: 6, alpha: 0.9 });
  }

  // Falling fruit: a ripe coral fruit drops on every detected beat (so the
  // music visibly shakes them loose), plus a slow tempo-paced gold leaf so the
  // canopy never looks dead between beats. Both fall the full screen height,
  // visible the whole way down, and are large enough to read clearly.
  if (!grove.leaves && window.Particles) grove.leaves = window.Particles.createParticleField(40);
  if (grove.leaves) {
    const bpm = state.tempo ? state.tempo.avgBpm() : 120;
    const beatPeriod = 60 / bpm;
    const dropAt = (tone) => {
      const fall = h * (0.18 + Math.random() * 0.1);        // px/sec, scaled to screen
      grove.leaves.spawn({
        x: (0.08 + Math.random() * 0.84) * w, y: baseY,
        vx: (Math.random() - 0.5) * 24, vy: fall,
        life: (h - baseY) / fall + 0.5, t: tone,
      });
    };
    if (a.beat) dropAt(0.74);                                // beat -> coral fruit
    grove.sinceSpawn += dt;
    if (grove.sinceSpawn >= beatPeriod * 1.5) {              // steady gold leaf filler
      grove.sinceSpawn -= beatPeriod * 1.5;
      dropAt(0.62);
    }
    grove.leaves.update(dt);
    for (const p of grove.leaves.alive()) {
      const fade = p.age > p.life - 0.6 ? Math.max(0, (p.life - p.age) / 0.6) : 1;
      g.circle(p.x, p.y, 6).fill({ color: PC ? PC.colorAt(theme, p.t) : theme.fg, alpha: fade });
    }
  }
}

const firebird = { sparks: null, lastT: 0, phase: 0, sinceSpawn: 0 };

// Flame-bird: a rising flame body with a white-hot heart, two symmetric filled
// wings that flap in tempo (one flap per beat, flaring wider on a detected
// beat), and rising embers. Driven by normalised state.audio (beatPulse,
// bassAtt) + tempo, not the raw lissajous (that produced a chaotic spindle).
function drawFirebird(g, theme, w, h) {
  const now = performance.now() / 1000;
  const dt = firebird.lastT ? Math.min(0.05, now - firebird.lastT) : 0.016;
  firebird.lastT = now;

  const a = state.audio || {};
  const bp = a.beatPulse || 0;                            // 0..1, spikes per beat
  const att = Math.max(0, (a.bassAtt || 1) - 1);          // excess bass, 0 baseline
  const bpm = state.tempo ? state.tempo.avgBpm() : 120;
  const PC = window.PaletteColor;
  const col = (t) => (PC ? PC.colorAt(theme, t) : theme.fg);
  const cx = w / 2, cy = h * 0.52, unit = Math.min(w, h);

  firebird.phase += dt * (bpm / 60) * Math.PI * 2;        // one flap per beat
  const flap = 0.5 + 0.5 * Math.sin(firebird.phase);      // 0 folded .. 1 spread
  const open = Math.min(1, 0.4 + 0.45 * flap + bp * 0.25);   // flaps + flares on beat
  const thrust = 1 + Math.min(1, att) * 0.5;

  const shoulderY = cy - unit * 0.03;
  const span = unit * 0.34 * open;            // wingtip horizontal reach
  const rise = unit * 0.22 * open * thrust;   // wingtip lift
  const drop = unit * 0.16;                    // trailing-edge drop

  // ---- filled wings, mirrored ----
  for (const side of [-1, 1]) {
    const tipX = cx + side * span, tipY = shoulderY - rise;
    const lowX = cx + side * span * 0.42, lowY = shoulderY + drop;
    g.moveTo(cx, shoulderY);
    g.quadraticCurveTo(cx + side * span * 0.5, tipY - unit * 0.03, tipX, tipY);
    g.quadraticCurveTo(cx + side * span * 0.7, shoulderY + unit * 0.01, lowX, lowY);
    g.quadraticCurveTo(cx + side * span * 0.12, shoulderY + drop * 0.4, cx, shoulderY);
    g.fill({ color: col(0.42), alpha: 0.8 });
  }

  // ---- rising embers, tempo-paced, few ----
  if (!firebird.sparks && window.Particles) firebird.sparks = window.Particles.createParticleField(60);
  if (firebird.sparks) {
    const halfBeat = 30 / bpm;
    firebird.sinceSpawn += dt;
    let n = 0;
    if (firebird.sinceSpawn >= halfBeat) { firebird.sinceSpawn -= halfBeat; n = 1; }
    if (a.beat) n += 3;
    for (let i = 0; i < n; i++) {
      firebird.sparks.spawn({
        x: cx + (Math.random() - 0.5) * unit * 0.05, y: cy - unit * 0.02,
        vx: (Math.random() - 0.5) * unit * 0.04, vy: -unit * (0.12 + Math.random() * 0.08),
        life: 1.2 + Math.random() * 0.8, t: 0.62 + Math.random() * 0.36,
      });
    }
    firebird.sparks.update(dt);
    for (const p of firebird.sparks.alive()) {
      g.circle(p.x, p.y, 2.2).fill({ color: col(p.t), alpha: Math.max(0, 1 - p.age / p.life) });
    }
  }
}

function shapePcm(L, R) {
  const n = L.fftSize;
  const a = new Float32Array(n), b = new Float32Array(n);
  L.getFloatTimeDomainData(a);
  (R || L).getFloatTimeDomainData(b);
  return [a, b];
}
function shapeOpts(w, h) {
  const aud = state.audio || {};
  return { w, h, time: performance.now() / 1000,
    bpm: state.tempo ? state.tempo.avgBpm() : 120,
    bassAtt: aud.bassAtt || 0, rms: aud.rms || 0 };
}
function drawSpiral(g, L, R, theme, w, h) {
  if (!L) return;
  const [a, b] = shapePcm(L, R);
  strokeGradient(g, window.ViewGeometry.spiral(a, b, shapeOpts(w, h)), theme);
}
function drawBloom(g, L, R, theme, w, h) {
  if (!L) return; const [a, b] = shapePcm(L, R);
  strokeGradient(g, window.ViewGeometry.bloom(a, b, shapeOpts(w, h)), theme);
}
function drawLasso(g, L, R, theme, w, h) {
  if (!L) return; const [a, b] = shapePcm(L, R);
  strokeGradient(g, window.ViewGeometry.lasso(a, b, shapeOpts(w, h)), theme);
}
function drawStarburst(g, L, R, theme, w, h) {
  if (!L) return; const [a, b] = shapePcm(L, R);
  strokeGradient(g, window.ViewGeometry.starburst(a, b, shapeOpts(w, h)), theme);
}
function drawNova(g, L, R, theme, w, h) {
  if (!L) return; const [a, b] = shapePcm(L, R);
  strokeGradient(g, window.ViewGeometry.nova(a, b, shapeOpts(w, h)), theme);
}

// Fetch the native app version once and fill any present version labels
// (TV bottom-right, phone settings drawer). Blank in a browser with no plugin.
async function loadVersionLabels() {
  if (typeof document === "undefined") return;
  const plugin = window.Capacitor?.Plugins?.ScopeAudio;
  let version = "";
  try { version = (await plugin?.getAppVersion?.())?.version || ""; } catch (_e) { /* browser / no plugin */ }
  const label = formatVersionLabel(version);
  for (const id of ["tv-version", "mobile-version"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  }
}

async function init() {
  try {
    // Restore persistent settings from the previous session before any UI
    // wires up, so toggles reflect the saved state on first paint.
    try {
      if (typeof localStorage !== "undefined") {
        if (localStorage.getItem("scope.micModeAuto") === "true") state.micModeAuto = true;
      }
    } catch (_e) { /* private mode etc. - ignore */ }

    if (PLATFORM === "desktop" && !navigator.mediaDevices?.getDisplayMedia) {
      setStatus("This visualiser needs Chrome, Edge, or Brave. Firefox cannot capture tab audio.");
      const captureBtn = document.getElementById("capture");
      if (captureBtn) captureBtn.disabled = true;
      return;
    }
    pixi.app = new PIXI.Application();
    await pixi.app.init({
      canvas: document.getElementById("stage"),
      resizeTo: window,
      background: 0x000000,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    const w = window.innerWidth;
    const h = window.innerHeight;
    pixi.trail = PIXI.RenderTexture.create({
      width: w,
      height: h,
      resolution: window.devicePixelRatio || 1,
    });
    pixi.trailSprite = new PIXI.Sprite(pixi.trail);
    pixi.app.stage.addChild(pixi.trailSprite);

    pixi.fade = new PIXI.Graphics();
    pixi.current = new PIXI.Graphics();
    // pixi.fade and pixi.current are deliberately NOT added to app.stage.
    // The spec's §5 scene graph shows `current` as a stage child for
    // illustrative purposes; this implementation renders them into the
    // trail texture explicitly via `renderer.render(graphics, { renderTexture: trail, clear: false })`
    // each frame (see Task 7). Adding `current` to stage would cause the
    // fresh trace to be drawn twice per frame - once baked into the trail
    // texture (with decay over time) and once live on stage (with no
    // decay), producing a doubled trace on the CRT theme. Do not "fix"
    // this by adding them to stage.

    // Populate theme filters now that PIXI.filters is available.
    // The pixi-filters@6 browser bundle exposes filter classes on
    // PIXI.filters (GlowFilter, CRTFilter, BloomFilter). If a future
    // version moves them to the top-level PIXI namespace, swap the
    // constructor lookups accordingly.
    // BlurFilter is core PixiJS v8 (top-level, not under PIXI.filters); the
    // pixi-shim re-exports it from window.PIXI. Appended last so it softens
    // any preceding bloom/glow halos rather than being re-sharpened by them.
    themes.crt.filters = [
      new PIXI.filters.GlowFilter({ distance: 8, outerStrength: 1.5, color: 0x33ff66 }),
      new PIXI.filters.CRTFilter({ curvature: 1, lineWidth: 1, vignetting: 0 }),
      new PIXI.BlurFilter({ strength: 2, quality: 2 }),
    ];
    themes.neon.filters = [
      new PIXI.filters.BloomFilter({ strength: { x: 8, y: 8 } }),
      new PIXI.BlurFilter({ strength: 2, quality: 2 }),
    ];
    themes.mono.filters = [
      new PIXI.BlurFilter({ strength: 2, quality: 2 }),
    ];

    // Bake palette ramps into RGB LUTs (one-time; re-baked per minute by the
    // tempo tick in the frame loop). Multi-stop ramps only; 1-stop are mono.
    if (window.PaletteColor) {
      for (const key of Object.keys(themes)) window.PaletteColor.bakeRamp(themes[key], 0);
    }
    if (window.AudioFeatures) state.tempo = window.AudioFeatures.createTempoTracker();

    // Apply default theme to trailSprite so the first frame already has filters.
    pixi.trailSprite.filters = themes[state.theme].filters;

    // Resize handling: rebuild trail on viewport change. window resize is
    // fine here because the canvas is fixed to the viewport
    // (`position: fixed; inset: 0`); a ResizeObserver on a sized
    // container would be the alternative if the canvas were not viewport-bound.
    const resize = () => {
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      pixi.trail.destroy(true);
      pixi.trail = PIXI.RenderTexture.create({
        width: newW,
        height: newH,
        resolution: window.devicePixelRatio || 1,
      });
      pixi.trailSprite.texture = pixi.trail;
    };
    window.addEventListener("resize", resize);

    // Visibility / lifecycle: when the WebView comes back to foreground
    // (after PiP exit, after launcher backgrounding, after lock-unlock), the
    // AudioContext is often left in "suspended" state and the WebGL context
    // may have been dropped. Resume audio and rebuild the trail texture so
    // the canvas does not stay black.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      // Wake Lock API auto-releases on page hide; re-acquire on return so
      // Keep-screen-on survives a tab switch or PiP-exit lifecycle.
      if (state.running && state.keepScreenOn) requestScreenLock();
      if (audio.ctx && audio.ctx.state === "suspended") {
        audio.ctx.resume().catch(() => {});
      }
      if (pixi.app && pixi.trail && pixi.trailSprite) {
        try {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          pixi.trail.destroy(true);
          pixi.trail = PIXI.RenderTexture.create({
            width: vw,
            height: vh,
            resolution: window.devicePixelRatio || 1,
          });
          pixi.trailSprite.texture = pixi.trail;
        } catch (_e) {}
      }
      if (state.running) requestAnimationFrame(frame);
    });

    if (PLATFORM === "android") {
      document.body.classList.add("mobile");
      await loadVersionLabels();   // fills TV + phone version labels (both apks)
      // Form-factor split: the SAME apk runs on phones and on Android TV. The
      // TV reports leanback/uiMode television; it does no capture - it receives
      // analysis frames from a paired phone and draws them. One activity, two
      // boot paths (resolves the two-launcher-activity review finding).
      const ff = await window.Capacitor?.Plugins?.ScopeAudio?.getFormFactor?.();
      state.tvMode = !!(ff && ff.formFactor === "tv");
      if (state.tvMode) {
        document.body.classList.add("tv");
        document.getElementById("start-screen").hidden = true;
        document.getElementById("mobile-start").hidden = true;
        await startTvMode();
        return;   // receive-only; skip all phone capture UI wiring below
      }
      // Defensive: start-screen is the desktop welcome card; it should never
      // be visible on Android. HTML now has it hidden by default so this is
      // belt-and-braces in case the attribute was cleared somewhere.
      document.getElementById("start-screen").hidden = true;
      document.body.classList.add("pre-capture");
      document.getElementById("mobile-start").hidden = false;
      document.getElementById("mobile-capture").onclick = () => { state.micMode = captureSourceMicMode("audio"); startCapture(); };
      document.getElementById("mobile-capture-mic").onclick = () => { state.micMode = captureSourceMicMode("mic"); startCapture(); };
      document.getElementById("mobile-stop").onclick = stopCapture;
      MobileUI.wireDrawer(state, applyState);
      window.Capacitor?.Plugins?.ScopeAudio?.setSmoothingAlpha?.({value: state.smoothing});   // initial sync of slider value into phone-side prep pipeline
      MobileUI.wireGestures(document.getElementById("stage"), state, applyState);
      // The PiP RemoteAction calls window.cycleView(1) via the Capacitor bridge.
      window.cycleView = function (direction) {
        MobileUI.cycleView(direction, state, applyState);
      };
      // Capacitor App backButton: privacy-overlay > drawer-close > block-during-capture > confirm-exit.
      // The Android 14+ system back-gesture (edge swipe from the screen
      // edge) dispatches as this event. Priority:
      //   1. Privacy overlay open -> dismiss it.
      //   2. Settings drawer open -> close it.
      //   3. Capture is running with drawer + overlay both closed ->
      //      SILENT NO-OP. The edge swipe must not exit and must not
      //      stop capture; an accidental swipe while watching the
      //      visualisation would otherwise interrupt the session.
      //      Explicit Stop is reachable via the drawer's Stop button
      //      and the foreground-service notification's Stop action.
      //      Explicit Exit is reachable via the drawer's Exit button.
      //   4. No capture running (start screen) -> confirm-exit dialog.
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.addListener("backButton", () => {
          const overlay = document.getElementById("privacy-overlay");
          if (overlay && !overlay.classList.contains("hidden")) {
            if (typeof window.closePrivacyOverlay === "function") {
              window.closePrivacyOverlay();
            } else {
              overlay.classList.add("hidden");
            }
            return;
          }
          if (MobileUI.isDrawerOpen()) {
            MobileUI.closeDrawer();
            return;
          }
          if (state.running) {
            // Block the edge-swipe during active capture. Do nothing.
            return;
          }
          // Use the native modal confirm so the exit prompt is unambiguously
          // a dialog (not another full-page "screen" stacked on mobile-start).
          if (typeof window.confirm === "function" && window.confirm("Exit Scope?")) {
            window.Capacitor.Plugins.App.exitApp();
          }
        });
      }
      return;
    }

    // Desktop flow: reveal the welcome card (HTML has it hidden by default
    // so the Android path can guarantee it never paints over mobile-start).
    document.getElementById("start-screen").hidden = false;
    document.getElementById("capture").addEventListener("click", startCapture);
    document.getElementById("stop").addEventListener("click", stopCapture);

    document.getElementById("view").addEventListener("change", (e) => {
      state.view = e.target.value;
      applyState();
    });

    document.getElementById("theme").addEventListener("change", (e) => {
      state.theme = e.target.value;
      applyState();
    });

    document.getElementById("gain").addEventListener("input", (e) => {
      state.sensitivity = parseFloat(e.target.value);
      applyState();
    });
    document.getElementById("fft").addEventListener("change", (e) => {
      state.fftSize = Math.min(parseInt(e.target.value, 10), 16384);
      applyState();
    });
    document.getElementById("smooth").addEventListener("input", (e) => {
      state.smoothing = parseFloat(e.target.value);
      window.Capacitor?.Plugins?.ScopeAudio?.setSmoothingAlpha?.({value: state.smoothing});
      applyState();
    });
    const autoEl = document.getElementById("autogain");
    if (autoEl) {
      autoEl.addEventListener("change", (e) => {
        state.autoGain = !!e.target.checked;
        applyState();
      });
    }
    for (const band of ["bass", "mid", "treb"]) {
      const el = document.getElementById(`eq-${band}`);
      if (el) {
        el.addEventListener("input", (e) => {
          state.bandGain[band] = parseFloat(e.target.value);
          applyState();
        });
      }
    }
    const eqResetEl = document.getElementById("eq-reset");
    if (eqResetEl) {
      eqResetEl.addEventListener("click", () => {
        state.bandGain.bass = 1.0;
        state.bandGain.mid  = 1.0;
        state.bandGain.treb = 1.0;
        applyState();
      });
    }
    const keepEl = document.getElementById("keepawake");
    if (keepEl) {
      keepEl.addEventListener("change", (e) => {
        state.keepScreenOn = !!e.target.checked;
        if (state.keepScreenOn && state.running) requestScreenLock();
        else releaseScreenLock();
        setKeepScreenOnAndroid(state.keepScreenOn);
      });
    }
    // Mobile drawer change handler hook (mobile-ui.js calls this).
    window.onKeepScreenOnChange = (enabled) => {
      if (enabled && state.running) requestScreenLock();
      else releaseScreenLock();
      setKeepScreenOnAndroid(enabled);
    };

    document.addEventListener("fullscreenchange", refreshFullscreenUI);

    const fsBtn = document.getElementById("fullscreen");
    if (fsBtn) fsBtn.addEventListener("click", toggleFullscreen);

    document.addEventListener("keydown", (e) => {
      if (!state.running && e.key !== "Escape") return;
      const digit = parseInt(e.key, 10);
      if (!Number.isNaN(digit) && e.key.length === 1) {
        // "1".."9" -> idx 0..8 (waveform..lasso); "0" -> idx 9 (starburst);
        // nova (idx 10) is reachable via the view dropdown / cycle only.
        const idx = digit === 0 ? 9 : digit - 1;
        const v = window.ViewIds.VIEW_ORDER[idx];
        if (v) {
          if (v === "lissajous" && state.channels === 1) return;
          state.view = v; applyState();
        }
      }
      if (e.key === "t" || e.key === "T") {
        state.theme = window.PaletteSets.nextPalette(state.view, state.theme, +1);
        applyState();
      }
      if (e.key === "f" || e.key === "F") {
        if (state.running || isInFullscreen()) toggleFullscreen();
      }
      if (e.key === "Escape") stopCapture();
    });

    let idleTimer = null;
    const controlsEl = document.getElementById("controls");
    const markActive = () => {
      controlsEl.classList.remove("idle");
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controlsEl.classList.add("idle"), 3000);
    };
    document.addEventListener("mousemove", (e) => {
      if (e.clientY < 100) markActive();
    });
    // A second keydown listener is intentional: markActive must fire on
    // ALL keypresses (to keep the panel visible during interaction),
    // including keys the main handler ignores (`!state.running` early
    // return, unmapped keys, etc.). Do not consolidate this into the
    // main keydown handler - that would skip the idle-reset for keys
    // that early-return.
    document.addEventListener("keydown", markActive);
    markActive();
  } catch (err) {
    setStatus(`Visualiser failed to start: ${err.message}. WebGL may be unavailable in this browser.`);
    const captureBtn = document.getElementById("capture");
    if (captureBtn) captureBtn.disabled = true;
    throw err;   // Re-throw so DevTools shows the underlying error too.
  }
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

// "mic" -> microphone capture (works for DRM apps e.g. Spotify); any other
// value -> system-audio (MediaProjection) capture.
function captureSourceMicMode(source) { return source === "mic"; }

// "0.3.3" -> "v0.3.3"; empty/missing -> "" (so the label simply stays blank
// in a browser where the native getAppVersion plugin call is unavailable).
function formatVersionLabel(v) {
  if (!v) return "";
  const s = String(v);
  return s.startsWith("v") ? s : `v${s}`;
}

if (typeof module !== "undefined") {
  module.exports = { freqToX, findZeroCrossing, nextCaptureModeBadgeProps, spectrumPolylinePoints, captureSourceMicMode, pairOverlayLines, formatVersionLabel, fillResample, sanitizePairCode };
}
