// Journey-driver core: a small declarative step interpreter for exercising
// Scope's UI on an emulator. All I/O is injected as `ctx` so the logic is unit
// testable. `ctx` provides:
//   evaluate(jsExpr) -> any   (run JS in the WebView via CDP, returnByValue)
//   tap(x, y)                 (adb input tap - for NATIVE dialogs only)
//   focus() -> string         (current mCurrentFocus window, via adb)
//   screencap(name)           (save a screenshot for evidence)
//   sleep(ms)
//   serviceForeground(name) -> bool   (is <pkg>/<name> a running foreground service)
//   log(msg)
//
// WebView actions/assertions go through evaluate() (robust, by DOM id/selector);
// the native MediaProjection-consent and RECORD_AUDIO dialogs are not in the
// WebView, so they are handled by tap() gated on focus().

async function waitForFocus(ctx, needle, timeoutMs = 8000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const f = await ctx.focus();
    if (f && f.includes(needle)) return true;
    if (Date.now() >= deadline) return false;
    await ctx.sleep(intervalMs);
  }
}

export async function runStep(step, ctx) {
  try {
    if (step.eval !== undefined) {
      await ctx.evaluate(step.eval);
      return { ok: true, step };
    }
    if (step.assert !== undefined) {
      const v = await ctx.evaluate(step.assert);
      const ok = step.equals !== undefined ? v === step.equals : !!v;
      const detail = ok ? undefined : `${step.desc || step.assert} => ${JSON.stringify(v)} (want ${JSON.stringify(step.equals ?? 'truthy')})`;
      return { ok, step, detail };
    }
    if (step.nativeDialog) {
      const d = step.nativeDialog;
      const appeared = await waitForFocus(ctx, d.expectFocus, d.appearTimeout ?? 6000);
      if (!appeared) {
        if (d.optional) return { ok: true, step, detail: 'dialog did not appear (optional)' };
        return { ok: false, step, detail: `expected focus ${d.expectFocus} did not appear` };
      }
      await ctx.tap(d.tap[0], d.tap[1]);
      const back = await waitForFocus(ctx, d.thenFocus, d.settleTimeout ?? 8000);
      return { ok: back, step, detail: back ? undefined : `focus did not return to ${d.thenFocus}` };
    }
    if (step.service) {
      const isFg = await ctx.serviceForeground(step.service.name);
      const pass = step.service.foreground ? !!isFg : !isFg;
      const detail = pass ? undefined
        : step.service.foreground ? `${step.service.name} not foreground` : `${step.service.name} unexpectedly foreground`;
      return { ok: pass, step, detail };
    }
    if (step.screenshot !== undefined) {
      await ctx.screencap(step.screenshot);
      return { ok: true, step };
    }
    if (step.sleep !== undefined) {
      await ctx.sleep(step.sleep);
      return { ok: true, step };
    }
    return { ok: false, step, detail: `unknown step ${JSON.stringify(step)}` };
  } catch (e) {
    return { ok: false, step, detail: e?.message || String(e) };
  }
}

export async function runJourney(journey, ctx) {
  const results = [];
  for (const step of journey.steps) {
    ctx.log?.(`  - ${step.desc || step.eval || step.assert || step.screenshot || Object.keys(step)[0]}`);
    const r = await runStep(step, ctx);
    results.push(r);
    if (!r.ok) return { id: journey.id, pass: false, results, failedAt: step, failure: r.detail };
  }
  return { id: journey.id, pass: true, results };
}

// DOM helpers (kept as strings so they are easy to read and reuse).
const SEL = {
  captureActive: `document.getElementById('start-screen') ? document.getElementById('start-screen').hidden === true : true`,
  drawerOpen: `document.body.classList.contains('drawer-open')`,
  systemActive: `!!document.querySelector('.capture-opt[data-mic="false"].active')`,
  micActive: `!!document.querySelector('.capture-opt[data-mic="true"].active')`,
  connectTvShown: `(e => !!(e && e.offsetParent !== null))(document.getElementById('mobile-connect-tv'))`,
  pairSurface: `/Enter IP manually|Searching/i.test(document.body.innerText)`,
};
const CLICK = (id) => `document.getElementById(${JSON.stringify(id)}).click()`;
const CLICK_PILL = (mic) => `document.querySelector('.capture-opt[data-mic="${mic}"]').click()`;
const OPEN_DRAWER = `document.body.classList.add('drawer-open')`;

// Native-dialog templates (coords are for the fixed pixel_6 1080x2400 AVD).
const CONSENT = (optional = false) => ({ nativeDialog: { expectFocus: 'com.android.systemui', tap: [853, 1517], thenFocus: 'com.alpapan.scope', optional }, desc: 'MediaProjection consent -> Start now' });
const MIC_PERM = (optional = true) => ({ nativeDialog: { expectFocus: 'com.android.systemui', tap: [540, 1163], thenFocus: 'com.alpapan.scope', optional }, desc: 'RECORD_AUDIO permission -> While using the app' });

export const JOURNEYS = [
  {
    id: 'drawer-capture-toggle',
    emulator: true,
    steps: [
      { eval: CLICK('mobile-capture'), desc: 'tap Capture audio' },
      CONSENT(),
      { assert: SEL.captureActive, desc: 'capture active (start screen hidden)' },
      { screenshot: '01-canvas' },
      { eval: OPEN_DRAWER, desc: 'open settings drawer' },
      { assert: SEL.drawerOpen, desc: 'drawer open' },
      { assert: SEL.systemActive, desc: 'system pill active' },
      { screenshot: '02-drawer-system' },
      { eval: CLICK_PILL('true'), desc: 'tap mic pill' },
      MIC_PERM(),
      { assert: SEL.micActive, desc: 'mic pill active' },
      { screenshot: '03-mic-active' },
      { eval: CLICK_PILL('false'), desc: 'tap system pill' },
      CONSENT(true),
      { assert: SEL.systemActive, desc: 'system pill active again' },
      { screenshot: '04-system-again' },
    ],
  },
  {
    id: 'start-capture-mic',
    emulator: true,
    steps: [
      { eval: CLICK('mobile-capture-mic'), desc: 'tap Capture mic' },
      MIC_PERM(),
      { assert: SEL.captureActive, desc: 'capture active' },
      { assert: SEL.micActive, desc: 'mic mode active' },
      { service: { name: '.AudioCaptureService', foreground: true }, desc: 'foreground mic service running' },
      { screenshot: '01-mic-canvas' },
    ],
  },
  {
    id: 'tv-pair-discovery',
    emulator: true,
    steps: [
      { eval: CLICK('mobile-capture'), desc: 'tap Capture audio' },
      CONSENT(),
      { assert: SEL.captureActive, desc: 'capture active' },
      { eval: OPEN_DRAWER, desc: 'open settings drawer' },
      { assert: SEL.connectTvShown, desc: 'Connect to TV visible' },
      { eval: CLICK('mobile-connect-tv'), desc: 'tap Connect to TV' },
      { sleep: 1500 },
      { assert: SEL.pairSurface, desc: 'pair / discovery surface appeared' },
      { screenshot: '01-pair-surface' },
    ],
  },
];
