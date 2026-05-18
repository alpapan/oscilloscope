// Browser-only. Loaded via plain <script> tag in index.html before main.js.
// Exposes `window.MobileUI` with helpers used by main.js when PLATFORM === "android".

(function () {
  if (typeof window === "undefined") return;

  const FFT_VALUES = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
  const VIEWS = ["waveform", "spectrum", "lissajous"];
  const VIEW_LABELS = { waveform: "Waveform", spectrum: "Spectrum", lissajous: "Lissajous" };

  let toastTimer = null;

  function showToast(text) {
    const el = document.getElementById("mobile-toast");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("visible");
    }, 1500);
  }

  function openDrawer() {
    document.body.classList.add("drawer-open");
  }
  function closeDrawer() {
    document.body.classList.remove("drawer-open");
  }
  function isDrawerOpen() {
    return document.body.classList.contains("drawer-open");
  }

  function cycleView(direction, state, applyState) {
    const i = VIEWS.indexOf(state.view);
    const next = (i + direction + VIEWS.length) % VIEWS.length;
    state.view = VIEWS[next];
    applyState();
    showToast(VIEW_LABELS[state.view]);
  }

  function refreshDrawer(state) {
    document.querySelectorAll("#mobile-theme-chips .chip").forEach(b => {
      b.classList.toggle("active", b.dataset.theme === state.theme);
    });
    const gain = document.getElementById("mobile-gain");
    if (gain) gain.value = state.sensitivity;
    const fftSpan = document.getElementById("mobile-fft-value");
    if (fftSpan) fftSpan.textContent = state.fftSize;
    const smooth = document.getElementById("mobile-smooth");
    if (smooth) smooth.value = state.smoothing;
  }

  function wireDrawer(state, applyState) {
    document.querySelectorAll("#mobile-theme-chips .chip").forEach(b => {
      b.addEventListener("click", () => {
        state.theme = b.dataset.theme;
        applyState();
        refreshDrawer(state);
      });
    });
    document.getElementById("mobile-gain").addEventListener("input", e => {
      state.sensitivity = parseFloat(e.target.value);
      applyState();
    });
    document.getElementById("mobile-fft-prev").addEventListener("click", () => {
      const i = FFT_VALUES.indexOf(state.fftSize);
      state.fftSize = FFT_VALUES[Math.max(0, i - 1)];
      applyState();
      refreshDrawer(state);
    });
    document.getElementById("mobile-fft-next").addEventListener("click", () => {
      const i = FFT_VALUES.indexOf(state.fftSize);
      state.fftSize = FFT_VALUES[Math.min(FFT_VALUES.length - 1, i + 1)];
      applyState();
      refreshDrawer(state);
    });
    document.getElementById("mobile-smooth").addEventListener("input", e => {
      state.smoothing = parseFloat(e.target.value);
      applyState();
    });
    document.getElementById("mobile-backdrop").addEventListener("click", closeDrawer);
  }

  function wireGestures(canvas, state, applyState) {
    // Touches are routed by stacking order. When the drawer is open the
    // backdrop (z=30) intercepts everything that would otherwise hit the
    // canvas (z=0), so the canvas-only handler can never see drawer-close
    // gestures. Attach the same swipe detection to the backdrop with a
    // drawer-aware action mapping.
    let x0 = 0, y0 = 0;
    function onStart(e) {
      const t = e.changedTouches[0];
      x0 = t.clientX;
      y0 = t.clientY;
    }
    function onEndCanvas(e) {
      const t = e.changedTouches[0];
      const dir = window.classifySwipe(x0, y0, t.clientX - x0, t.clientY - y0, {
        x0,
        canvasWidth: canvas.clientWidth,
      });
      if (dir === "right") cycleView(+1, state, applyState);
      else if (dir === "left") openDrawer();
    }
    function onEndBackdrop(e) {
      const t = e.changedTouches[0];
      const dir = window.classifySwipe(x0, y0, t.clientX - x0, t.clientY - y0, {
        x0,
        canvasWidth: window.innerWidth,
      });
      if (dir === "right") closeDrawer();
      // Swipe-left on backdrop is a no-op; the drawer is already open.
    }
    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchend", onEndCanvas, { passive: true });
    const backdrop = document.getElementById("mobile-backdrop");
    if (backdrop) {
      backdrop.addEventListener("touchstart", onStart, { passive: true });
      backdrop.addEventListener("touchend", onEndBackdrop, { passive: true });
    }
  }

  window.MobileUI = {
    showToast,
    openDrawer,
    closeDrawer,
    isDrawerOpen,
    cycleView,
    refreshDrawer,
    wireDrawer,
    wireGestures,
  };
})();
