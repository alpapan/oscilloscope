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

function findZeroCrossing(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] < 0 && buf[i + 1] >= 0) return i;
  }
  return 0;
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
function setStatus(text) {
  const el = typeof document !== "undefined" ? document.getElementById("status") : null;
  if (el) el.textContent = text;
}

const state = {
  view: "waveform",       // "waveform" | "spectrum" | "lissajous"
  theme: "crt",           // "crt" | "neon" | "mono"
  sensitivity: 1.0,
  fftSize: 2048,
  smoothing: 0.6,
  running: false,
  channels: 2,            // detected at capture start
};

const audio = {
  ctx: null,
  stream: null,
  source: null,
  gain: null,
  splitter: null,
  analyserL: null,
  analyserR: null,
  // Android-only:
  workletNode: null,
  silence: null,
  audioChunkHandle: null,
};

const pixi = {
  app: null,
  trail: null,            // PIXI.RenderTexture
  trailSprite: null,      // PIXI.Sprite
  current: null,          // PIXI.Graphics
  fade: null,             // PIXI.Graphics for the decay overlay
};

const themes = {
  crt:  { fg: 0x33ff66, fgCss: "#33ff66", decayAlpha: 0.12, lineWidth: 1.5, filters: [] },
  neon: { fg: 0x00e5ff, fgCss: "#00e5ff", decayAlpha: 1.0,  lineWidth: 2.0, filters: [] },
  mono: { fg: 0xffffff, fgCss: "#ffffff", decayAlpha: 1.0,  lineWidth: 1.0, filters: [] },
};
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
    // Deliberately do NOT connect to ctx.destination: the user already hears
    // the source tab; routing through here would cause feedback.

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

function stopCapture() {
  if (PLATFORM === "android") {
    stopCaptureAndroid();
    return;
  }
  // Idempotent: safe to call when already stopped.
  if (!state.running && !audio.stream && !audio.ctx) return;

  if (audio.stream) {
    audio.stream.getTracks().forEach(t => t.stop());
    audio.stream = null;
  }
  if (audio.ctx) {
    audio.ctx.close().catch(() => {});
    audio.ctx = null;
  }
  audio.source = audio.gain = audio.splitter = audio.analyserL = audio.analyserR = null;

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

  try {
    await plugin.startCapture();
  } catch (err) {
    setStatus(`Capture denied: ${err.message || "permission rejected"}`);
    return;
  }

  audio.ctx = new AudioContext({ sampleRate: 48000 });
  if (audio.ctx.state === "suspended") {
    await audio.ctx.resume();
  }
  await audio.ctx.audioWorklet.addModule("audio-worklet-processor.js");
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
  audio.analyserL.connect(audio.silence);
  audio.analyserR.connect(audio.silence);
  audio.silence.connect(audio.ctx.destination);

  // Subscribe to PCM events. Removed in stopCaptureAndroid.
  // Capacitor contract: addListener returns Promise<PluginListenerHandle>
  // where the handle has remove(): Promise<void>. Both calls awaited.
  audio.audioChunkHandle = await plugin.addListener("audioChunk", onAudioChunkAndroid);

  state.running = true;
  setStatus("");
  document.getElementById("mobile-start").hidden = true;
  applyState();
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

async function stopCaptureAndroid() {
  if (audio.audioChunkHandle && audio.audioChunkHandle.remove) {
    await audio.audioChunkHandle.remove();
    audio.audioChunkHandle = null;
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
  state.running = false;
  if (typeof document !== "undefined") {
    document.getElementById("mobile-start").hidden = false;
  }
}

function applyState() {
  if (audio.gain) {
    audio.gain.gain.value = state.sensitivity;
  }
  if (audio.analyserL && audio.analyserR) {
    audio.analyserL.fftSize = state.fftSize;
    audio.analyserR.fftSize = state.fftSize;
    audio.analyserL.smoothingTimeConstant = state.smoothing;
    audio.analyserR.smoothingTimeConstant = state.smoothing;
  }
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
  if (gainEl) gainEl.value = String(state.sensitivity);
  if (fftEl) fftEl.value = String(state.fftSize);
  if (smoothEl) smoothEl.value = String(state.smoothing);

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
  const now = performance.now();
  const dt = lastFrameTime === 0 ? 0 : now - lastFrameTime;
  lastFrameTime = now;
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

  const theme = themes[state.theme];
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Step 1: decay (or full clear) on the trail texture.
  pixi.fade.clear();
  pixi.fade.rect(0, 0, w, h).fill({ color: 0x000000, alpha: theme.decayAlpha });
  pixi.app.renderer.render(pixi.fade, { renderTexture: pixi.trail, clear: false });

  // Step 2: build this frame's fresh trace.
  pixi.current.clear();
  if (state.view === "waveform")  drawWaveform(pixi.current, audio.analyserL, theme, w, h);
  if (state.view === "spectrum")  drawSpectrum(pixi.current, audio.analyserL, theme, w, h);
  if (state.view === "lissajous") drawLissajous(pixi.current, audio.analyserL, audio.analyserR, theme, w, h);

  // Step 3: bake current onto the trail texture.
  pixi.app.renderer.render(pixi.current, { renderTexture: pixi.trail, clear: false });

  // PixiJS automatically presents the stage (which contains trailSprite) on the next tick.
  requestAnimationFrame(frame);
}

function drawWaveform(g, analyser, theme, w, h) {
  if (!analyser) return;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);

  const start = findZeroCrossing(buf);
  const len = buf.length - start;
  if (len < 2) return;

  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * w;
    const y = h / 2 - buf[start + i] * (h / 2) * 0.9;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke({ color: theme.fg, width: theme.lineWidth });
}

function drawSpectrum(g, analyser, theme, w, h) {
  if (!analyser) return;
  const bins = analyser.frequencyBinCount;
  const buf = new Float32Array(bins);
  analyser.getFloatFrequencyData(buf);

  const sampleRate = audio.ctx.sampleRate;
  const minDb = -100;
  const maxDb = -30;

  // Walk the audible range (20 Hz – 20 kHz), mapping bins to log-X / dB-Y.
  let started = false;
  for (let i = 1; i < bins; i++) {
    const freq = (i * sampleRate) / analyser.fftSize;
    if (freq < 20 || freq > 20000) continue;
    const x = freqToX(freq, w);
    const mag = Math.max(0, Math.min(1, (buf[i] - minDb) / (maxDb - minDb)));
    const y = h - mag * h;
    if (!started) {
      g.moveTo(x, h);
      g.lineTo(x, y);
      started = true;
    } else {
      g.lineTo(x, y);
    }
  }
  // Close the ribbon back to the baseline. The baseline stroke is
  // intentional framing; split into separate fill/stroke passes if it
  // reads as cluttered under the CRT glow filter.
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill({ color: theme.fg, alpha: 0.5 });
  g.stroke({ color: theme.fg, width: theme.lineWidth });
}

function drawLissajous(g, analyserL, analyserR, theme, w, h) {
  if (!analyserL || !analyserR) return;
  const n = analyserL.fftSize;
  const bufL = new Float32Array(n);
  const bufR = new Float32Array(n);
  analyserL.getFloatTimeDomainData(bufL);
  analyserR.getFloatTimeDomainData(bufR);

  const radius = Math.min(w, h) * 0.4;
  const cx = w / 2;
  const cy = h / 2;
  const inv = 1 / Math.SQRT2;

  for (let i = 0; i < n; i++) {
    const xr = (bufL[i] - bufR[i]) * radius * inv;
    const yr = (bufL[i] + bufR[i]) * radius * inv;
    const x = cx + xr;
    const y = cy - yr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke({ color: theme.fg, width: theme.lineWidth });
}

async function init() {
  try {
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
    themes.crt.filters = [
      new PIXI.filters.GlowFilter({ distance: 8, outerStrength: 1.5, color: 0x33ff66 }),
      new PIXI.filters.CRTFilter({ curvature: 1, lineWidth: 1, vignetting: 0.3 }),
    ];
    themes.neon.filters = [
      new PIXI.filters.BloomFilter({ strength: { x: 8, y: 8 } }),
    ];
    themes.mono.filters = [];

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

    if (PLATFORM === "android") {
      document.body.classList.add("mobile");
      document.getElementById("mobile-start").hidden = false;
      document.getElementById("mobile-capture").onclick = startCapture;
      document.getElementById("mobile-stop").onclick = stopCapture;
      MobileUI.wireDrawer(state, applyState);
      MobileUI.wireGestures(document.getElementById("stage"), state, applyState);
      // The PiP RemoteAction calls window.cycleView(1) via the Capacitor bridge.
      window.cycleView = function (direction) {
        MobileUI.cycleView(direction, state, applyState);
      };
      // Capacitor App backButton: drawer-close > stop-capture > exit.
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
          window.Capacitor.Plugins.App.exitApp();
        });
      }
      return;
    }

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
  module.exports = { freqToX, findZeroCrossing };
}
