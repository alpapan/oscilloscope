// Browser-only. Loaded via plain <script> tag in index.html before main.js.
// Exposes `window.MobileUI` with helpers used by main.js when PLATFORM === "android".

(function () {
  if (typeof window === "undefined") return;

  const FFT_VALUES = [128, 256, 512, 1024, 2048, 4096, 8192, 16384];

  // Render the integer fftSize as a "k"-shorthand label for the mobile picker
  // (matches the desktop <select> options in index.html).
  // 128 -> "0.125k", 256 -> "0.25k", 512 -> "0.5k", 2048 -> "2k".
  function fftSizeLabel(n) {
    // (n / 1024).toString() drops trailing zeros for clean labels:
    //   128 -> "0.125", 256 -> "0.25", 512 -> "0.5",
    //   1024 -> "1", 2048 -> "2", 16384 -> "16".
    return (n / 1024).toString() + "k";
  }
  const VIEWS = (typeof window !== "undefined" && window.ViewIds)
    ? window.ViewIds.VIEW_ORDER.slice()
    : ["waveform","spectrum","lissajous","cosmos","grove","firebird","spiral","bloom","lasso","starburst","nova","nowplaying"];
  const VIEW_LABELS = { waveform: "Waveform", spectrum: "Spectrum", lissajous: "Lissajous", cosmos: "Cosmos", grove: "Grove", firebird: "Firebird", spiral: "Spiral", bloom: "Bloom", lasso: "Lasso", starburst: "Starburst", nova: "Nova", nowplaying: "Now Playing" };

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
    // now-playing is excluded from the cycle in mic mode (viewsFor).
    const views = (typeof window !== "undefined" && window.ViewIds && window.ViewIds.viewsFor)
      ? window.ViewIds.viewsFor(state.micMode)
      : VIEWS;
    const cur = views.indexOf(state.view);
    const i = cur < 0 ? 0 : (cur + direction + views.length) % views.length;
    state.view = views[i];
    applyState();
    showToast(VIEW_LABELS[state.view]);
  }

  function refreshDrawer(state) {
    const ex = window.PaletteSets ? window.PaletteSets.EXCLUSIVE[state.view] : null;
    document.querySelectorAll("#mobile-theme-chips .chip").forEach(b => {
      b.classList.toggle("active", b.dataset.theme === state.theme);
    });
    const sns = document.getElementById("mobile-sns-chip");
    if (sns) sns.classList.toggle("active", state.theme === ex);
    const viewSel = document.getElementById("mobile-view");
    if (viewSel) viewSel.value = state.view;
    const gain = document.getElementById("mobile-gain");
    if (gain) {
      gain.value = state.sensitivity;
      gain.disabled = !!state.autoGain;
    }
    const fftSpan = document.getElementById("mobile-fft-value");
    if (fftSpan) fftSpan.textContent = fftSizeLabel(state.fftSize);
    const smooth = document.getElementById("mobile-smooth");
    if (smooth) smooth.value = state.smoothing;
    const auto = document.getElementById("mobile-autogain");
    if (auto) auto.checked = !!state.autoGain;
    const keep = document.getElementById("mobile-keepawake");
    if (keep) keep.checked = !!state.keepScreenOn;
    for (const band of ["bass", "mid", "treb"]) {
      const el = document.getElementById(`mobile-eq-${band}`);
      if (el) el.value = String(state.bandGain[band]);
    }
  }

  function wireDrawer(state, applyState, onMicToggle) {
    document.querySelectorAll("#mobile-theme-chips .chip").forEach(b => {
      b.addEventListener("click", () => {
        state.theme = b.dataset.theme;
        applyState();
        refreshDrawer(state);
      });
    });
    const snsChip = document.getElementById("mobile-sns-chip");
    if (snsChip) snsChip.addEventListener("click", () => {
      state.theme = window.PaletteSets.EXCLUSIVE[state.view];   // signature palette in place
      applyState();
      refreshDrawer(state);
    });
    const mobileView = document.getElementById("mobile-view");
    if (mobileView) {
      mobileView.innerHTML = "";                       // populate from the single VIEWS source
      for (const v of VIEWS) {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = VIEW_LABELS[v];
        mobileView.appendChild(opt);
      }
      mobileView.addEventListener("change", e => {
        state.view = e.target.value;
        applyState();
        refreshDrawer(state);
        showToast(VIEW_LABELS[state.view]);
      });
    }
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
    const autoToggle = document.getElementById("mobile-autogain");
    if (autoToggle) {
      autoToggle.addEventListener("change", e => {
        state.autoGain = !!e.target.checked;
        applyState();
        refreshDrawer(state);
      });
    }
    const keepToggle = document.getElementById("mobile-keepawake");
    if (keepToggle) {
      keepToggle.addEventListener("change", e => {
        state.keepScreenOn = !!e.target.checked;
        if (typeof window.onKeepScreenOnChange === "function") {
          window.onKeepScreenOnChange(state.keepScreenOn);
        }
      });
    }
    const micToggle = document.getElementById("mobile-micmode");
    if (micToggle) {
      micToggle.checked = !!state.micMode;
      micToggle.addEventListener("change", e => {
        // While capturing this switches the source live (and redirects away
        // from now-playing); pre-capture it just records the preference.
        if (onMicToggle) onMicToggle(!!e.target.checked);
        else { state.micMode = !!e.target.checked; applyState(); }
      });
    }
    const micAutoToggle = document.getElementById("mobile-micmode-auto");
    if (micAutoToggle) {
      micAutoToggle.checked = !!state.micModeAuto;
      micAutoToggle.addEventListener("change", e => {
        state.micModeAuto = !!e.target.checked;
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("scope.micModeAuto", state.micModeAuto ? "true" : "false");
          }
        } catch (_e) { /* private mode etc. */ }
      });
    }
    for (const band of ["bass", "mid", "treb"]) {
      const el = document.getElementById(`mobile-eq-${band}`);
      if (el) {
        el.addEventListener("input", e => {
          state.bandGain[band] = parseFloat(e.target.value);
          applyState();
        });
      }
    }
    const eqResetBtn = document.getElementById("mobile-eq-reset");
    if (eqResetBtn) {
      eqResetBtn.addEventListener("click", () => {
        state.bandGain.bass = 1.0;
        state.bandGain.mid  = 1.0;
        state.bandGain.treb = 1.0;
        applyState();
        refreshDrawer(state);
      });
    }
    const fsBtn = document.getElementById("mobile-fullscreen");
    if (fsBtn && typeof window.toggleFullscreen === "function") {
      fsBtn.addEventListener("click", window.toggleFullscreen);
    }
    document.getElementById("mobile-backdrop").addEventListener("click", closeDrawer);
    const closeBtn = document.getElementById("mobile-drawer-close");
    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
    const connectTvBtn = document.getElementById("mobile-connect-tv");
    if (connectTvBtn) {
      connectTvBtn.addEventListener("click", () => {
        if (typeof window.connectToTv === "function") window.connectToTv();
      });
    }
    // Privacy-policy overlay toggle. Same-page overlay (no navigation),
    // so the AudioWorklet keeps running while the user reads the policy.
    // Dismissal: bottom Close button, top-right X, system back-gesture
    // (handled in main.js's backButton listener), or a left-to-right
    // swipe across the overlay surface (mirrors the drawer's
    // swipe-LTR-on-backdrop pattern).
    const privacyBtn = document.getElementById("mobile-privacy");
    const privacyOverlay = document.getElementById("privacy-overlay");
    const privacyCloseBtn = document.getElementById("privacy-close");
    const privacyCloseX = document.getElementById("privacy-close-x");
    function closePrivacyOverlay() {
      if (privacyOverlay) privacyOverlay.classList.add("hidden");
    }
    // Expose so main.js's backButton listener can dismiss the overlay
    // at top priority without re-grepping the DOM each press.
    window.closePrivacyOverlay = closePrivacyOverlay;
    if (privacyBtn && privacyOverlay) {
      privacyBtn.addEventListener("click", () => {
        privacyOverlay.classList.remove("hidden");
        closeDrawer();
      });
    }
    if (privacyCloseBtn) {
      privacyCloseBtn.addEventListener("click", closePrivacyOverlay);
    }
    if (privacyCloseX) {
      privacyCloseX.addEventListener("click", closePrivacyOverlay);
    }
    if (privacyOverlay) {
      // Swipe LTR across the overlay closes it. Reuses the same
      // classifySwipe helper the canvas/backdrop gestures use.
      let px0 = 0, py0 = 0;
      privacyOverlay.addEventListener("touchstart", (e) => {
        const t = e.changedTouches[0];
        px0 = t.clientX; py0 = t.clientY;
      }, { passive: true });
      privacyOverlay.addEventListener("touchend", (e) => {
        const t = e.changedTouches[0];
        const dx = t.clientX - px0;
        const dy = t.clientY - py0;
        const dir = window.classifySwipe(px0, py0, dx, dy, {
          x0: px0,
          canvasWidth: window.innerWidth,
        });
        if (dir === "right") closePrivacyOverlay();
      }, { passive: true });
    }
    const exitBtn = document.getElementById("mobile-exit");
    if (exitBtn) {
      exitBtn.addEventListener("click", () => {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
          window.Capacitor.Plugins.App.exitApp();
        }
      });
    }
  }

  function wireGestures(canvas, state, applyState) {
    // Canvas gestures:
    //   - Double-tap: cycle view (replaced earlier swipe-right which fought
    //     the Android system back gesture from the screen edge).
    //   - Single-tap: cycle palette.
    //   - Swipe-left: open the settings drawer. Edge deadzone in
    //     classifySwipe rejects swipes starting near either screen edge so
    //     the system back-gesture wins uncontested in that zone.
    // Backdrop gestures (drawer open): tap closes the drawer; swipes are
    // ignored because the backdrop tap handler is already wired.
    let x0 = 0, y0 = 0;
    let lastTapTime = 0;
    let lastTapX = 0, lastTapY = 0;
    let singleTapTimer = null;
    const DOUBLE_TAP_MS = 300;
    const DOUBLE_TAP_PX = 50;
    const TAP_MAX_DISTANCE_PX = 10;

    function onStart(e) {
      const t = e.changedTouches[0];
      x0 = t.clientX;
      y0 = t.clientY;
    }

    function onEndCanvas(e) {
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      const dist = Math.hypot(dx, dy);

      // Tap (negligible movement): single-tap cycles palette, double-tap cycles view.
      if (dist < TAP_MAX_DISTANCE_PX) {
        const now = Date.now();
        if (now - lastTapTime < DOUBLE_TAP_MS &&
            Math.abs(t.clientX - lastTapX) < DOUBLE_TAP_PX &&
            Math.abs(t.clientY - lastTapY) < DOUBLE_TAP_PX) {
          if (singleTapTimer) { clearTimeout(singleTapTimer); singleTapTimer = null; }
          cycleView(+1, state, applyState);   // double-tap: next view
          lastTapTime = 0;
        } else {
          lastTapTime = now; lastTapX = t.clientX; lastTapY = t.clientY;
          if (singleTapTimer) clearTimeout(singleTapTimer);
          singleTapTimer = setTimeout(() => {   // single-tap (confirmed): cycle palette
            singleTapTimer = null;
            state.theme = window.PaletteSets.nextPalette(state.view, state.theme, +1);
            applyState();
            refreshDrawer(state);
            showToast(state.theme);
          }, DOUBLE_TAP_MS);
        }
        return;
      }

      // Real swipe: only swipe-left to open drawer is recognised on canvas.
      const dir = window.classifySwipe(x0, y0, dx, dy, {
        x0,
        canvasWidth: canvas.clientWidth,
      });
      if (dir === "left") openDrawer();
    }

    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchend", onEndCanvas, { passive: true });

    // The start card overlays the canvas before capture, swallowing the
    // canvas swipe. Bind swipe-left -> open drawer on the start card too, so
    // pre-capture settings (mic mode is now a button) are reachable.
    const startCard = document.getElementById("mobile-start");
    if (startCard) {
      function onEndStart(e) {
        const t = e.changedTouches[0];
        const dx = t.clientX - x0;
        const dy = t.clientY - y0;
        const dir = window.classifySwipe(x0, y0, dx, dy, { x0, canvasWidth: window.innerWidth });
        if (dir === "left") openDrawer();
      }
      startCard.addEventListener("touchstart", onStart, { passive: true });
      startCard.addEventListener("touchend", onEndStart, { passive: true });
    }

    // Backdrop (visible while drawer is open): swipe LTR closes the drawer,
    // mirroring the swipe-RTL-opens gesture on the canvas. Same edge-deadzone
    // discipline so the Android system back-gesture wins near screen edges.
    const backdrop = document.getElementById("mobile-backdrop");
    if (backdrop) {
      function onEndBackdrop(e) {
        const t = e.changedTouches[0];
        const dx = t.clientX - x0;
        const dy = t.clientY - y0;
        const dir = window.classifySwipe(x0, y0, dx, dy, {
          x0,
          canvasWidth: window.innerWidth,
        });
        if (dir === "right") closeDrawer();
      }
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
