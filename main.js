// Scope - Music Oscilloscope
// See docs/superpowers/specs/2026-05-16-music-oscilloscope-design.md

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

const state = {
  view: "waveform",       // "waveform" | "spectrum" | "lissajous"
  theme: "crt",           // "crt" | "neon" | "mono"
  sensitivity: 1.0,
  fftSize: 2048,
  smoothing: 0.8,
  running: false,
  channels: 2,            // detected at capture start
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
  audio: { bass: 0, mid: 0, treb: 0, bassAtt: 0, beat: false, beatPulse: 0, longAverage: 0 },
  screenLock: null,       // WakeLockSentinel; set by requestScreenLock
};

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
          hueCycleRadians: Math.PI / 12, hueShiftOnBeat: 0 },
  neon: { fg: 0x00e5ff, fgCss: "#00e5ff", decayAlpha: 1.0,  lineWidth: 2.0, filters: [],
          hueCycleRadians: Math.PI,      hueShiftOnBeat: Math.PI / 3 },
  mono: { fg: 0xffffff, fgCss: "#ffffff", decayAlpha: 1.0,  lineWidth: 1.0, filters: [],
          hueCycleRadians: 0,            hueShiftOnBeat: 0 },
};
const THICK_OFFSETS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
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

    state.running = true;
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

  state.running = false;
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

  state.running = true;
  setStatus("");
  document.getElementById("mobile-start").hidden = true;
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
  state.running = false;
  updateCaptureModeBadge();
  if (typeof document !== "undefined" && !(opts && opts.suppressMobileStartReshow)) {
    document.getElementById("mobile-start").hidden = false;
  }
}

function applyState() {
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
  pixi.fade.rect(0, 0, w, h).fill({ color: 0x000000, alpha: theme.decayAlpha });
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

function drawWaveform(g, analyser, theme, w, h) {
  if (!analyser) return;
  const raw = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(raw);
  const preSmooth = window.AudioFeatures
    ? window.AudioFeatures.pcmSmooth(raw, getPcmScratch("L", raw.length))
    : raw;
  const buf = smoothBuf("L", preSmooth, state.smoothing);

  const start = findZeroCrossing(buf);
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
  const preL = window.AudioFeatures
    ? window.AudioFeatures.pcmSmooth(rawL, getPcmScratch("L", n))
    : rawL;
  const preR = window.AudioFeatures
    ? window.AudioFeatures.pcmSmooth(rawR, getPcmScratch("R", n))
    : rawR;
  const bufL = smoothBuf("L", preL, state.smoothing);
  const bufR = smoothBuf("R", preR, state.smoothing);

  const radius = Math.min(w, h) * 0.4;
  const cx = w / 2;
  const cy = h / 2;
  const inv = 1 / Math.SQRT2;

  const points = new Array(n);
  for (let i = 0; i < n; i++) {
    const xr = (bufL[i] - bufR[i]) * radius * inv;
    const yr = (bufL[i] + bufR[i]) * radius * inv;
    points[i] = [cx + xr, cy - yr];
  }
  const now = performance.now() / 1000;
  strokeMultiOffset(g, points, theme, w, h, now, state.audio.beatPulse || 0);
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
      new PIXI.filters.CRTFilter({ curvature: 1, lineWidth: 1, vignetting: 0.3 }),
      new PIXI.BlurFilter({ strength: 2, quality: 2 }),
    ];
    themes.neon.filters = [
      new PIXI.filters.BloomFilter({ strength: { x: 8, y: 8 } }),
      new PIXI.BlurFilter({ strength: 2, quality: 2 }),
    ];
    themes.mono.filters = [
      new PIXI.BlurFilter({ strength: 2, quality: 2 }),
    ];

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
      // Defensive: start-screen is the desktop welcome card; it should never
      // be visible on Android. HTML now has it hidden by default so this is
      // belt-and-braces in case the attribute was cleared somewhere.
      document.getElementById("start-screen").hidden = true;
      document.getElementById("mobile-start").hidden = false;
      document.getElementById("mobile-capture").onclick = startCapture;
      document.getElementById("mobile-stop").onclick = stopCapture;
      MobileUI.wireDrawer(state, applyState);
      MobileUI.wireGestures(document.getElementById("stage"), state, applyState);
      // The PiP RemoteAction calls window.cycleView(1) via the Capacitor bridge.
      window.cycleView = function (direction) {
        MobileUI.cycleView(direction, state, applyState);
      };
      // Capacitor App backButton: drawer-close > stop-capture > confirm-exit.
      // Android 14+ edge-swipes commit to back-gesture early, so users
      // attempting to swipe-from-right to open the settings drawer can
      // accidentally trigger this. Show a confirmation banner before
      // committing to exit so an unintended swipe is recoverable.
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.addListener("backButton", () => {
          if (MobileUI.isDrawerOpen()) {
            MobileUI.closeDrawer();
            return;
          }
          if (state.running) {
            stopCapture();
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
      state.fftSize = parseInt(e.target.value, 10);
      applyState();
    });
    document.getElementById("smooth").addEventListener("input", (e) => {
      state.smoothing = parseFloat(e.target.value);
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

    document.addEventListener("keydown", (e) => {
      if (!state.running && e.key !== "Escape") return;
      if (e.key === "1") { state.view = "waveform";  applyState(); }
      if (e.key === "2") { state.view = "spectrum";  applyState(); }
      if (e.key === "3") {
        if (state.channels === 1) return;
        state.view = "lissajous"; applyState();
      }
      if (e.key === "t" || e.key === "T") {
        const order = ["crt", "neon", "mono"];
        const idx = order.indexOf(state.theme);
        state.theme = order[(idx + 1) % order.length];
        applyState();
      }
      if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
        }
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

if (typeof module !== "undefined") {
  module.exports = { freqToX, findZeroCrossing, nextCaptureModeBadgeProps, spectrumPolylinePoints };
}
