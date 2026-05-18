# Restore visualisation and add render canary test - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the visualisation that goes solid-black after Start by re-enabling the three features that the previous Claude session disabled in the working tree (mesh-warp, multi-offset stroke, BlurFilter), fixing the underlying bug that those features expose, and adding a Playwright canary test that reproduces the regression as a real failing test before the fix.

**Architecture:** Add Playwright Chromium as a thin browser-harness runner alongside the existing `node --test` unit suite. One canary test stubs `navigator.mediaDevices.getDisplayMedia` with a synthetic `OscillatorNode -> MediaStreamAudioDestinationNode` stream, clicks `#capture`, waits ~30 rAF ticks, screenshots the canvas, and asserts non-black pixel count above threshold. The same canary then drives a test-led bisection of the three re-enabled features in commit-history order until exactly one feature flips the canary RED. A narrower Playwright test pins the precise API misuse for that feature, the fix is applied, both tests pass, the diagnostic try/catch is removed, full suite is green, then code-review.

**Tech Stack:** PixiJS v8 (UMD via cdn.jsdelivr.net, shimmed for ESM consumers), pixi-filters@6 (ESM via esm.sh), Capacitor 7 (Android wrapper), Node 20+, `node --test` (existing), `@playwright/test` (new), `http-server` (new dev dep).

---

## Context

Commit `40a9bc2` ("feat: projectM-derived visualisation algorithms + screen-wake toggle") introduced four features at once: mesh-warp affine transform on the trail sprite, a 4-corner multi-offset thick-line stroke pattern in `strokeMultiOffset`, BlurFilter as a last entry on every theme's filter array, and palette-color hue cycling. After this commit the visualisation shows solid black with no trace after the user clicks Start. A previous Claude session attempted to bisect the bug by disabling three of these features in the working tree (visible as the uncommitted `main.js` diff: wrapped `frame()` in try/catch, commented out the mesh-warp call, replaced the multi-offset stroke with a single centred stroke, removed BlurFilter from all three themes' filter arrays). That session did not write a test. The user has confirmed:

1. The shotgun-disable bisection was undisciplined and must be undone.
2. The fix must be tracked via a failing test (TDD discipline).
3. The bug predates the EQ chain commit `20b31b8`; it is in `40a9bc2` (or earlier).

The current test suite (45 tests under `tests/`, all pure-JS unit tests with mocked `AnalyserNode` and zero PIXI / WebGL / DOM coverage) cannot detect this class of regression. This plan adds the missing canary and uses it to bisect, then fix.

## Files affected

- Create: `tests/render-canary.spec.js` - Playwright canary
- Create: `tests/render-diagnostic.spec.js` - narrower test (content depends on Task 4 outcome)
- Create: `playwright.config.js`
- Modify: `package.json` - add `@playwright/test` and `http-server` devDeps, add `test:e2e` script
- Modify: `tests/sync-www.test.js` - exclude `*.spec.js` from the file-inventory check
- Modify: `main.js` - revert the three disabled blocks, fix the actual root cause, remove the diagnostic try/catch wrapper
- Possibly modify: `pixi-shim.js` or `index.html` script order - if the BlurFilter hypothesis is confirmed

Do not touch `audio-features.js`, the EQ chain, `setupEqChain`, or any audio-graph code; the user has ruled the EQ chain out.

## Task 1: Install Playwright and configure the browser harness

**Files:**
- Modify: `/home/alexie/software/oscilloscope/package.json`
- Create: `/home/alexie/software/oscilloscope/playwright.config.js`

- [ ] **Step 1: Add Playwright + http-server as dev deps**

```bash
cd /home/alexie/software/oscilloscope
npm install --save-dev @playwright/test http-server
npx playwright install chromium
```

This atomically updates `devDependencies` in `package.json` and writes `package-lock.json`. Do not hand-edit those sections; let npm do it. The next step touches only the `scripts` block.

- [ ] **Step 2: Edit `package.json` `scripts` block only**

After edit, `scripts` reads:

```json
"scripts": {
  "test": "node --test tests/*.test.js",
  "test:e2e": "playwright test",
  "sync-www": "./sync-www.sh",
  "presync": "npm run sync-www",
  "sync": "cap sync android",
  "prebuild:android": "npm run sync-www",
  "build:android": "cap sync android && cd android && ./gradlew :app:assembleRelease"
}
```

- [ ] **Step 3: Write `playwright.config.js`**

```javascript
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js',
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'npx http-server -p 8765 -c-1 -s',
    port: 8765,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://localhost:8765',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
});
```

- [ ] **Step 4: Inspect `tests/sync-www.test.js` and confirm the new files are out of scope**

Read the file with the Read tool. The reviewer flagged that the filter at roughly line 33 reads `!name.endsWith(".test.js")`. The inventory check operates on root-directory `.js` files (`main.js`, `audio-features.js`, etc.), not files under `tests/`. New files added by this plan:

| File | Location | In inventory scope? |
| --- | --- | --- |
| `tests/render-canary.spec.js` | `tests/` | No (subdirectory excluded) |
| `tests/render-diagnostic.spec.js` | `tests/` | No |
| `playwright.config.js` | repo root | Maybe - see below |

Run:

```bash
node -e "console.log(require('fs').readdirSync('.').filter(f => f.endsWith('.js') && !f.endsWith('.test.js')))"
```

Compare the printed list against the assertions in `tests/sync-www.test.js`. If `playwright.config.js` is in the list and the test asserts every entry must appear in `sync-www.sh` and `index.html`, add an explicit exclusion: `f !== 'playwright.config.js'`. If the test already uses a positive whitelist (only files explicitly required to ship in the APK), no edit needed. Document which case obtains at execution time and apply the minimum edit.

- [ ] **Step 5: Confirm existing unit suite still green**

```bash
npm test
```

Expected: 45 passing.

(No commit at this point. Per CLAUDE.md "one commit per whole feature", all changes from Tasks 1-6 are staged and committed together in Task 9 after manual verification and code review.)

## Task 2: Write the failing render canary (RED)

**Files:**
- Create: `/home/alexie/software/oscilloscope/tests/render-canary.spec.js`

- [ ] **Step 1: Write the test**

```javascript
const { test, expect } = require('@playwright/test');

test('canvas renders a non-black trace after Start with synthetic audio', async ({ page }) => {
  // The try/catch wrapper around frameBody is already in the working tree
  // (the previous bisection added it as a diagnostic instrument). It
  // surfaces silent throws via #status. This canary reads #status before
  // taking the screenshot and fails loudly if a render exception was
  // caught.
  //
  // CAVEAT: this canary runs in headless Chromium with ANGLE-on-SwiftShader,
  // a CPU-based GL rasterizer. It does NOT exercise the same shader path
  // as Android WebView running on the device's GLES driver. A PASS here
  // does not prove the visualisation works on Android; Task 7 covers that
  // via manual APK install.

  // Stub getDisplayMedia with a 440 Hz OscillatorNode piped into a
  // MediaStreamAudioDestinationNode, plus a 1x1 white video track
  // (Chromium requires at least one video track on a display capture).
  // The 30 FPS captureStream rate is arbitrary; the consumer in main.js
  // only reads the audio track and ignores video.
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, 1, 1);
      const videoTrack = c.captureStream(30).getVideoTracks()[0];
      return new MediaStream([
        dest.stream.getAudioTracks()[0],
        videoTrack,
      ]);
    };
  });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[browser error]', msg.text());
  });

  await page.goto('/');
  await page.click('#capture');

  // Ready check: the `#controls` div has the `hidden` attribute removed
  // by main.js after audio capture succeeds (index.html:26 vs. main.js's
  // post-Start handler). Waiting for this is the proxy for "the app is
  // running" without exposing module-scoped `state` on `window`.
  await page.waitForSelector('#controls:not([hidden])', { timeout: 5000 });

  // Then give the rAF loop ~30 ticks at 60 FPS to fill the trail.
  await page.waitForTimeout(500);

  const status = (await page.locator('#status').textContent()) || '';
  if (status.includes('Render error')) {
    // Fail with the exception text so the cause is visible in CI output.
    throw new Error(`render exception surfaced: ${status}`);
  }

  // Screenshot the canvas and count pixels brighter than near-black.
  const png = await page.locator('#stage').screenshot();
  const nonBlackPixels = await page.evaluate(async (pngBytes) => {
    const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const oc = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = oc.getContext('2d');
    cx.drawImage(bmp, 0, 0);
    const data = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 24) n++;
    }
    return n;
  }, Array.from(png));

  expect(nonBlackPixels).toBeGreaterThan(500);
});
```

**Verify the ready-check selector is correct.** Before running the canary, grep main.js for the line that removes the `hidden` attribute from `#controls` after Start succeeds; if the actual selector differs (for example the code uses a CSS class swap instead of the `hidden` attribute, or removes hidden on a different element such as `#mobile-drawer` for the Android path), adjust the `waitForSelector` accordingly. On Android the path is `#mobile-capture`, not `#capture`, but the headless test runs the desktop path only.

- [ ] **Step 2: Run the canary against the current (bisected) working tree**

```bash
npx playwright test tests/render-canary.spec.js
```

Expected outcome A (most likely): **PASS**. The three disabled features were exactly the latent symptom carriers, so with them disabled the trace renders normally.

Expected outcome B: **FAIL**. There is a second bug not yet identified. Stop, paste the screenshot + status text into the next step, and re-investigate before proceeding to Task 3.

- [ ] **Step 3: Confirm the canary correctly distinguishes black from non-black (calibration - MANDATORY, do not skip)**

The pixel threshold (`> 24` per pixel, `> 500` total) is load-bearing for the rest of the plan: too low and the test passes on a near-black canvas, too high and the test flakes on slower CI runners. Run the calibration:

1. Insert `pixi.app.canvas.style.visibility = 'hidden';` after canvas creation in `main.js`'s `init()` block.
2. Re-run the canary.
3. Observe the test FAILS with `nonBlackPixels` at or near 0.
4. Revert the temporary edit.
5. Re-run the canary, observe PASS.

If step 3 does not fail (pixels above threshold appear even when the canvas is hidden), the threshold is wrong. Investigate `screenshot()` semantics (is it capturing the DOM behind the canvas?) before continuing.

- [ ] **Step 4: Do not commit yet.**

Per CLAUDE.md "one commit per whole feature", the canary stays in the unstaged working tree alongside the rest of Tasks 1-6's output. Commit happens in Task 9 after code review.

## Task 3: Re-enable the three disabled features (introduce the test failure)

**Files:**
- Modify: `/home/alexie/software/oscilloscope/main.js`

The user's working-tree diff currently disables four blocks in `main.js`. The try/catch wrapper around `frameBody` (block 1) is already present in the working tree and stays untouched through Task 2 and Task 3; it is the diagnostic instrument that surfaces silent throws via `setStatus`. **Restore blocks 2, 3, 4** (mesh-warp, multi-offset stroke, BlurFilter) to the state they were in immediately after commit `40a9bc2`. The wrapper is removed in Task 6 after the bug is fixed.

- [ ] **Step 1: Restore the mesh-warp call in `frameBody`** (currently around lines 626-633 in the working tree)

Replace the commented placeholder with:

```javascript
  // Step 2: build this frame's fresh trace. mesh-warp is applied to the
  // trail sprite each frame; bassAtt scales the rotation amplitude.
  if (pixi.trailSprite && window.MeshWarp) {
    const { scale, rotation } = window.MeshWarp.meshTransform(
      state.audio.bassAtt || 0, now / 1000
    );
    pixi.trailSprite.scale.set(scale);
    pixi.trailSprite.rotation = rotation;
  }
```

- [ ] **Step 2: Restore the multi-offset stroke in `strokeMultiOffset`** (currently around lines 682-697)

Replace the single-stroke body with:

```javascript
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
```

- [ ] **Step 3: Restore BlurFilter on every theme's filter array in `init()`** (currently around lines 838-845)

Append `new PIXI.BlurFilter({ strength: 2, quality: 2 })` as the last filter on each of `themes.crt.filters`, `themes.neon.filters`, `themes.mono.filters`. The exact insertion looks like:

```javascript
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
```

- [ ] **Step 4: Keep the try/catch wrapper around `frameBody`** unchanged. It will be removed in Task 6.

- [ ] **Step 5: Run the canary**

```bash
npx playwright test tests/render-canary.spec.js
```

Expected: **FAIL**. The canary reproduces the original bug. The test output should print the `Render error: ...` line from `#status` if any feature throws synchronously; if the screen is black without an error in `#status` the failure is silent (no exception, just no visible geometry).

**Do not commit yet.** The working tree is in a known-broken state on purpose; the fix in Task 5 plus the cleanup in Task 6 ship together.

## Task 4: Bisect the three re-enabled features using the canary

The canary is RED. Use it to identify which of the three features is responsible. The diff comments left by the previous session name BlurFilter as the strongest suspect ("shader compile failed silently and killed the trail texture"), so try BlurFilter first. If a feature is not the culprit, re-enable it before testing the next.

- [ ] **Step 1: Disable BlurFilter only, keep mesh-warp + multi-offset enabled**

Remove the `BlurFilter` entries from all three theme arrays. Run the canary.

```bash
npx playwright test tests/render-canary.spec.js
```

If PASS: BlurFilter is the culprit. Re-enable it (so the canary is RED again) and jump to Task 5 Variant A.
If FAIL: BlurFilter is not the only culprit. Restore BlurFilter on all three themes, go to Step 2.

- [ ] **Step 2: Disable multi-offset stroke only**

Reduce `strokeMultiOffset` back to the single-stroke version (per the user's working-tree diff). Run the canary.

If PASS: multi-offset stroke is the culprit. Restore it and jump to Task 5 Variant B.
If FAIL: not the culprit. Restore the multi-offset block, go to Step 3.

- [ ] **Step 3: Disable mesh-warp only**

Comment out the `MeshWarp.meshTransform` call. Run the canary.

If PASS: mesh-warp is the culprit. Restore it and jump to Task 5 Variant C.
If FAIL: more than one feature is broken simultaneously - record this finding and execute Variants A, B, C in sequence, fixing each in its own commit.

- [ ] **Step 4: Record `#status` exception text (if any)**

Each canary run in Steps 1-3 already produces `test-results/<test-name>/test-failed-*.png` (from `screenshot: 'only-on-failure'` in playwright.config.js) and `trace.zip` (from `trace: 'retain-on-failure'`). Inspect the most recent failing artifact in `test-results/` to tell exception-failure (status contains `Render error: ...`, screenshot shows black canvas plus visible error text) from silent-failure (status empty, screenshot shows pure black canvas).

If the failure is silent and no `Render error` ever appears, the bug is not a throw - it is a logic error that produces no visible geometry (degenerate transform, zero alpha, offscreen draw). Re-run with the headed inspector:

```bash
npx playwright test tests/render-canary.spec.js --headed --debug
```

Step through the rAF loop and inspect `pixi.trailSprite.scale`, `pixi.trailSprite.position`, and the `Graphics` geometry buffer before render. Whichever value is unexpected is the proximate cause.

Record the precise failure mode (exception text or "silent, no status, observed degeneracy in <field>") as the input to Task 5.

## Task 5: Write the narrower failing test, fix the bug, verify green

**Files:**
- Create: `/home/alexie/software/oscilloscope/tests/render-diagnostic.spec.js`
- Modify: `main.js` and/or `pixi-shim.js` per the diagnosed cause

Execute only the variant matching the feature identified in Task 4. Each variant follows TDD red-green: write the narrow test, watch it fail for the right reason, write the minimum fix, watch it pass.

### Variant A: BlurFilter constructor or shader

- [ ] **A1: Write the failing test**

```javascript
const { test, expect } = require('@playwright/test');

test('PIXI.BlurFilter constructs and applies on a sprite without throwing', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(async () => {
    try {
      const PIXI = window.PIXI;
      if (!PIXI || !PIXI.BlurFilter) {
        return { ok: false, reason: 'PIXI.BlurFilter is undefined' };
      }
      const f = new PIXI.BlurFilter({ strength: 2, quality: 2 });
      const app = new PIXI.Application();
      await app.init({ width: 64, height: 64, background: 0x000000 });
      const tex = PIXI.Texture.WHITE;
      const sp = new PIXI.Sprite(tex);
      sp.width = 64;
      sp.height = 64;
      sp.filters = [f];
      app.stage.addChild(sp);
      app.renderer.render(app.stage);
      const url = app.canvas.toDataURL();
      app.destroy(true);
      return { ok: true, url };
    } catch (err) {
      return { ok: false, reason: err.message, stack: err.stack };
    }
  });
  expect(out.ok, JSON.stringify(out)).toBe(true);
});
```

- [ ] **A2: Run, verify it fails for the expected reason**

```bash
npx playwright test tests/render-diagnostic.spec.js
```

Read the `reason` string. Likely candidates:
- `PIXI.BlurFilter is undefined` - the v8 build at `https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js` does not expose `BlurFilter` at the top level under that exact name. Inspect the bundle via `await fetch(url).then(r => r.text())` and grep for `BlurFilter`; the actual export name may be `PIXI.filters.BlurFilter`, `PIXI.BlurFilterPass`, or scoped under a deferred subpackage.
- Constructor signature mismatch: v8 may expect a single options object whose keys are different from what the code passes.
- GL shader compile error surfacing from the renderer when the filter is appended after `GlowFilter` + `CRTFilter` (the filter stack saturates the texture pool).

- [ ] **A3: Fix at the root**

Concrete fix depends on A2. Examples (apply only the one that matches):
- If `PIXI.BlurFilter` is at `PIXI.filters.BlurFilter` in v8 UMD: update `pixi-shim.js` to read `PIXI.filters?.BlurFilter ?? PIXI.BlurFilter` and update `main.js` to use the same accessor.
- If the constructor signature is wrong: change `new PIXI.BlurFilter({ strength: 2, quality: 2 })` to the correct v8 form (verify against the actual bundle source).
- If the filter stack is the problem: drop `BlurFilter` from `themes.crt` and `themes.neon` (those already have heavy glow/bloom), keep it only on `themes.mono`.

- [ ] **A4: Run diagnostic, verify PASS**
- [ ] **A5: Run canary, verify PASS**
- [ ] **A6: Run unit suite, verify still 45 green**

```bash
npm test
```

### Variant B: PIXI v8 Graphics.stroke() semantics on accumulating sub-paths

- [ ] **B0: Verify PIXI v8 Graphics API surface before writing the test**

Different fix shapes depend on which methods exist. Run:

```bash
cd /home/alexie/software/oscilloscope
grep -rn -E "closePath|beginPath|moveTo|lineTo|stroke" node_modules/pixi.js/lib/scene/graphics/shared/Graphics.* 2>/dev/null | head -40
node -e "const P = require('pixi.js'); const g = new P.Graphics(); console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(g)).filter(n => /path|stroke|move/i.test(n)).sort());"
```

The second command may fail if pixi.js is not Node-runnable; treat that as evidence that the API surface must be probed inside Playwright (in the test page) rather than via Node. Record which methods (`closePath`, `beginPath`, `moveTo`, `lineTo`, `stroke`) exist; the fix in B3 picks the one that is present.

- [ ] **B1: Write the failing test that distinguishes "all 5 strokes worked" from "only the last stroke worked"**

The trap the previous Claude session described is subtle: the 4 offset polylines plus 1 centred polyline must be visually distinguishable from a single polyline. A naive non-black-pixel count cannot tell them apart because the offsets are only 1 px each. The test below compares two Graphics objects: one with a single stroke, one with the projectM multi-offset pattern. The multi-offset version must produce at least 1.5x more non-black pixels (because the 1 px offsets thicken the visible line), AND no `console.error` is emitted during rendering.

```javascript
const { test, expect } = require('@playwright/test');

test('strokeMultiOffset pattern produces thicker line than single stroke and no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/');

  const result = await page.evaluate(async () => {
    const PIXI = window.PIXI;
    const polyline = [[10,100],[100,10],[190,100],[100,190],[10,100]];

    async function pixelsFor(buildFn) {
      const app = new PIXI.Application();
      await app.init({ width: 200, height: 200, background: 0x000000 });
      const g = new PIXI.Graphics();
      buildFn(g);
      app.stage.addChild(g);
      app.renderer.render(app.stage);
      const url = app.canvas.toDataURL();
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = url; });
      const oc = new OffscreenCanvas(200, 200);
      const cx = oc.getContext('2d');
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, 200, 200).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 20) n++;
      app.destroy(true);
      return n;
    }

    const single = await pixelsFor(g => {
      for (let i = 0; i < polyline.length; i++) {
        const [px,py] = polyline[i];
        if (i === 0) g.moveTo(px,py); else g.lineTo(px,py);
      }
      g.stroke({ color: 0xffffff, width: 2, alpha: 1.0 });
    });

    const multi = await pixelsFor(g => {
      const offsets = [[-1,-1],[1,-1],[-1,1],[1,1]];
      for (const [dx,dy] of offsets) {
        for (let i = 0; i < polyline.length; i++) {
          const [px,py] = polyline[i];
          if (i === 0) g.moveTo(px+dx, py+dy); else g.lineTo(px+dx, py+dy);
        }
        g.stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
      }
      for (let i = 0; i < polyline.length; i++) {
        const [px,py] = polyline[i];
        if (i === 0) g.moveTo(px,py); else g.lineTo(px,py);
      }
      g.stroke({ color: 0xffffff, width: 2, alpha: 1.0 });
    });

    return { single, multi };
  });

  expect(errors, `console errors during render: ${errors.join('\\n')}`).toEqual([]);
  expect(result.single, JSON.stringify(result)).toBeGreaterThan(50);
  // The multi-offset pattern adds 4 corner strokes; total visible pixels
  // must be at least 1.5x the single-stroke count for the pattern to be
  // having any visible effect.
  expect(result.multi, JSON.stringify(result)).toBeGreaterThan(result.single * 1.5);
});
```

- [ ] **B2: Run, verify failure**

Possible failure modes:
- `errors` is non-empty: PIXI emitted a console error during the multi-offset render. Read the message.
- `result.single` ~ 0: Even a single stroke fails. The bug is broader than multi-offset; reframe as a basic `Graphics.stroke()` regression.
- `result.multi` ~ `result.single`: the multi-offset pattern produces no extra geometry. Either (a) only the last `moveTo`/`lineTo` sequence is being stroked because each `stroke()` clears the path, OR (b) PIXI v8 re-strokes the accumulated path each call, but the first 4 strokes overlap exactly with the centred one.
- `result.multi` ~ 0: the multi-offset pattern produces visible artefacts that go through a NaN somewhere, leaving the whole render invisible.

- [ ] **B3: Fix at the root**

Apply the fix matching B2's outcome and B0's API-surface findings. The most likely fix:
- If `Graphics.closePath` exists on v8 prototype (from B0): insert `g.closePath()` before each new `moveTo` in the offset loop and before the centred stroke. This terminates each sub-path so the next `moveTo` opens a fresh one, matching PIXI v7 implicit behaviour.
- If `closePath` does not exist but a fresh `Graphics` per offset works: change `strokeMultiOffset` to build 5 children `PIXI.Graphics` objects and addChild them to `g`. More GC pressure per frame; acceptable for a small (5 strokes) batch.
- If neither works: drop the multi-offset pattern entirely and rely on PIXI v8's native `width` parameter on `stroke()` to provide a thicker visible line. Document this as a behavioural change in the commit message.

- [ ] **B4: Run diagnostic, verify PASS**
- [ ] **B5: Run canary, verify PASS**
- [ ] **B6: Run unit suite, verify still 45 green**

### Variant C: mesh-warp moves trailSprite offscreen or zeros its scale

- [ ] **C1: Write the failing test**

A unit-level test against the math alone is already covered by `tests/mesh-warp.test.js` (and is green), so the regression must be in how `scale.set` / `rotation` propagate through the RenderTexture + filter chain. The failing test must be a Playwright test that renders a real frame:

```javascript
const { test, expect } = require('@playwright/test');

test('trailSprite stays on-canvas when mesh-warp is applied per frame', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const PIXI = window.PIXI;
    const app = new PIXI.Application();
    await app.init({ width: 256, height: 256, background: 0x000000 });
    const rt = PIXI.RenderTexture.create({ width: 256, height: 256 });
    const sprite = new PIXI.Sprite(rt);
    app.stage.addChild(sprite);
    // Paint something into the RT so the sprite has content
    const seed = new PIXI.Graphics().rect(0, 0, 256, 256).fill({ color: 0xff00ff });
    app.renderer.render(seed, { renderTexture: rt, clear: true });
    // Apply mesh-warp values 200 times, then render. Record final
    // scale / rotation / position so the assertion can identify which
    // transform component (if any) drifted out of bounds.
    const { meshTransform } = window.MeshWarp;
    for (let i = 0; i < 200; i++) {
      const { scale, rotation } = meshTransform(1.5, i * 0.016);
      sprite.scale.set(scale);
      sprite.rotation = rotation;
    }
    app.renderer.render(app.stage);
    const finalScaleX = sprite.scale.x;
    const finalScaleY = sprite.scale.y;
    const finalRotation = sprite.rotation;
    const finalX = sprite.position.x;
    const finalY = sprite.position.y;
    const url = app.canvas.toDataURL();
    const img = new Image();
    await new Promise(r => { img.onload = r; img.src = url; });
    const oc = new OffscreenCanvas(256, 256);
    const cx = oc.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, 256, 256).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 20) n++;
    app.destroy(true);
    return {
      nonBlackPixels: n,
      finalScaleX, finalScaleY,
      finalRotation,
      finalX, finalY,
    };
  });
  // Sprite must not have drifted off canvas
  expect(Math.abs(result.finalX), JSON.stringify(result)).toBeLessThan(256);
  expect(Math.abs(result.finalY), JSON.stringify(result)).toBeLessThan(256);
  // Scale must remain in a sensible range
  expect(result.finalScaleX, JSON.stringify(result)).toBeGreaterThan(0.5);
  expect(result.finalScaleX, JSON.stringify(result)).toBeLessThan(2);
  // And the rendered output must contain pink (the seed colour above)
  expect(result.nonBlackPixels, JSON.stringify(result)).toBeGreaterThan(1000);
});
```

- [ ] **C2: Run, verify failure**

Read `result.finalScale` and `result.finalRotation` in the assertion output. If `finalScale` is near 0, the per-frame scale assignment is compounding (writing to `scale.set` repeatedly without a baseline) and the sprite shrinks to invisibility over a few hundred frames. If `finalRotation` is large, rotation is accumulating similarly.

- [ ] **C3: Fix at the root**

If the math is correct but the assignment is wrong: `sprite.scale.set(scale)` overwrites (so it should not compound). If it is compounding anyway, inspect whether `meshTransform` mutates external state.

If the math is intermittently producing tiny `scale`: clamp `meshTransform` output to `[0.95, 1.05]` for scale and `[-0.05, 0.05]` for rotation in `mesh-warp.js`, and add a Node unit test in `tests/mesh-warp.test.js` that asserts those bounds across `bassAtt in [0, 5]` and `time in [0, 60]`.

- [ ] **C4: Run diagnostic, verify PASS**
- [ ] **C5: Run canary, verify PASS**
- [ ] **C6: Run unit suite, verify all green**

## Task 6: Remove the diagnostic try/catch wrapper

**Files:**
- Modify: `/home/alexie/software/oscilloscope/main.js`

- [ ] **Step 1: Remove the wrapper**

The try/catch around `frameBody` was added by the previous bisection session to surface silent throws. With the bug fixed, the wrapper is dead diagnostic scaffolding. Per CLAUDE.md ("Don't add error handling, fallbacks, or validation for scenarios that can't happen"), remove it and inline `frameBody` back into `frame`. The end result restores the original `frame` shape:

```javascript
function frame() {
  if (!state.running) return;
  // ...original body...
  requestAnimationFrame(frame);
}
```

- [ ] **Step 2: Run the canary**

```bash
npx playwright test tests/render-canary.spec.js
```

Expected: **PASS**.

- [ ] **Step 3: Run the diagnostic**

```bash
npx playwright test tests/render-diagnostic.spec.js
```

Expected: **PASS**.

- [ ] **Step 4: Run the unit suite**

```bash
npm test
```

Expected: 45 (or 46+ if Variant C added a Node unit test) green.

(No commit at this point. The single commit is in Task 9 after manual verification and code review.)

## Task 7: Manual verification

The Playwright tests give a high-confidence proxy for "the visualisation works", but only manual end-to-end testing confirms the feature on real screen-share with real music and on the Android APK.

- [ ] **Step 1: Open the desktop build in Chrome**

```bash
npx http-server -p 8765 -c-1 -s &
xdg-open http://localhost:8765/
```

Click Start, pick a tab with audio, confirm a visible trace on Waveform / Spectrum / Lissajous across CRT / Neon / Mono themes.

- [ ] **Step 2: Build the Android APK**

```bash
npm run build:android
```

Output: `/home/alexie/software/oscilloscope/android/app/build/outputs/apk/release/scope-0.3.0.apk`. The user installs it manually on their device. Do not suggest `adb install`; there is no phone attached to this machine.

- [ ] **Step 3: Report APK path to the user; await user confirmation that the trace is visible on the Android device before considering the task done.**

## Task 8: Code review (BEFORE the commit)

- [ ] **Step 1: Dispatch the `superpowers:code-reviewer` agent**

Code review runs BEFORE staging or committing per CLAUDE.md. Prompt the reviewer with this exact text (the literal strings `superpowers:test-driven-development` and `superpowers:verification-before-completion` are required by the plan-exit checklist):

> **Mandatory discipline (do not skip, no exceptions):**
>
> 1. Follow `superpowers:test-driven-development` when reviewing test-first compliance: every production-code change must have a failing test that came first.
> 2. Follow `superpowers:verification-before-completion` before reporting DONE. Run `npm test` and `npx playwright test` yourself and cite the actual command + exit code + pass/fail counts in your report. Do not assert "tests pass" without a fresh run in your own message.
>
> Review the implementation of "Restore visualisation and add render canary test" against the plan at `/home/alexie/software/oscilloscope/docs/plans/the-project-no-longer-zippy-mist.md`. Verify:
>
> 1. All tasks were completed as specified.
> 2. The render canary reliably fails when the regression is present (run the canary, observe RED with the disabled features re-enabled and the fix reverted via `git diff` inspection, then restore) and passes after the fix.
> 3. The narrower diagnostic test pins the precise PIXI v8 API misuse, not just the visible symptom.
> 4. No mocks of internal code in tests. Test files contain no `jest.mock`, `vi.mock`, `sinon.stub` on our own modules (`audio-features.js`, `palette-color.js`, `mesh-warp.js`, etc.). The synthetic-audio stub of `navigator.mediaDevices.getDisplayMedia` is a stub of a platform boundary, not internal code, and is allowed.
> 5. The try/catch wrapper around `frameBody` is fully removed; no diagnostic scaffolding remains in the working tree.
> 6. The fix targets the root cause; no try/catch/retry/conditional bandaids that mask the symptom.
> 7. PIXI v8 API usage is correct for the affected feature (BlurFilter / Graphics.stroke / sprite transform).
> 8. The working tree contains no uncommitted edits other than this feature's changes. Confirm via `git diff --name-only` that no unrelated files were touched.
> 9. You are read-only. Do not run `git commit`, `git stash`, `git push`, `git reset`, `git checkout <path>`, or any destructive command. Do not write or edit files; only assert findings.

Address every finding the reviewer returns - CRITICAL, IMPORTANT, NICE-TO-HAVE - per CLAUDE.md GOLDEN RULE. The next task (Task 9) is the single commit; do not skip to it until every reviewer finding is either fixed in the working tree or explicitly rejected with evidence.

## Task 9: Single feature commit

Per CLAUDE.md "one commit per whole feature (HARD RULE)", all output from Tasks 1-6 ships as one commit AFTER code review (Task 8) is clean. Pathspec form, exact files only. NEVER `git add -A` or `git add .`.

- [ ] **Step 1: Confirm the working tree is clean apart from this feature's changes**

```bash
git status
git diff --name-only
```

Expected files (the set varies slightly per Task 5 variant):
- `main.js`
- `playwright.config.js` (new)
- `package.json`, `package-lock.json`
- `tests/render-canary.spec.js` (new)
- `tests/render-diagnostic.spec.js` (new)
- `tests/sync-www.test.js` (only if Task 1 Step 4 required an edit)
- Variant A only: `pixi-shim.js`
- Variant C only: `mesh-warp.js`, possibly `tests/mesh-warp.test.js`

If `git status` shows any file outside this list, stop and ask the user before proceeding.

- [ ] **Step 2: Stage and commit (pick the variant message)**

Variant A (BlurFilter):

```bash
git add main.js pixi-shim.js tests/render-canary.spec.js tests/render-diagnostic.spec.js playwright.config.js package.json package-lock.json tests/sync-www.test.js
git commit -m "$(cat <<'EOF'
fix: BlurFilter constructor regression on PIXI v8 - restore visualisation

The BlurFilter entry on each theme's filter array was passing an options
shape PIXI v8 no longer accepts at top level (or pointed at a name the
UMD bundle does not expose). Fixed by <one-line specific fix>. Added a
Playwright render canary that screenshots the canvas after Start with a
synthetic OscillatorNode-driven MediaStream and asserts non-black pixel
count above threshold; the canary fails when the regression is present
and passes after the fix. CI canary runs on headless Chromium
(SwiftShader); Android WebView verification is manual on the user's
device.
EOF
)"
```

Variant B (multi-offset stroke):

```bash
git add main.js tests/render-canary.spec.js tests/render-diagnostic.spec.js playwright.config.js package.json package-lock.json tests/sync-www.test.js
git commit -m "$(cat <<'EOF'
fix: PIXI v8 Graphics.stroke() path semantics in strokeMultiOffset - restore visualisation

projectM's 4-corner offset thick-line pattern called stroke() five times
on a single Graphics object, relying on PIXI v7 implicit sub-path
behaviour. PIXI v8 <one-line specific behaviour>. Fixed by <one-line
specific fix>. Added a Playwright render canary plus a diagnostic that
distinguishes "all 5 strokes worked" from "only the last stroke worked"
by comparing pixel counts against a single-stroke baseline. CI canary
on headless Chromium; Android device verification manual.
EOF
)"
```

Variant C (mesh-warp):

```bash
git add main.js mesh-warp.js tests/render-canary.spec.js tests/render-diagnostic.spec.js tests/mesh-warp.test.js playwright.config.js package.json package-lock.json tests/sync-www.test.js
git commit -m "$(cat <<'EOF'
fix: mesh-warp <scale|rotation|position> drift - restore visualisation

The per-frame mesh-warp transform applied to pixi.trailSprite produced
<observed-behaviour> after a few hundred frames, leaving the trail
texture invisible. Fixed by <one-line specific fix>. Added a Playwright
diagnostic asserting scale stays in [0.5, 2.0] and position stays
on-canvas across 200 simulated frames at bassAtt=1.5. CI canary on
headless Chromium; Android device verification manual.
EOF
)"
```

Replace `<one-line specific fix>` and bracketed placeholders with the actual finding. No "going forward", no "I've learned", no apology language.

- [ ] **Step 3: Do not push.** Per CLAUDE.md "NEVER push unless explicitly asked", the commit stays local until the user explicitly says push.

## Verification

After Task 8 returns clean:

- `npm test` -> 45+ green (existing unit suite).
- `npx playwright test` -> render-canary and render-diagnostic green.
- Manual: visible trace on desktop browser across all three themes.
- Manual: visible trace on Android APK across all three themes (user confirmation).
- The previous shotgun-disable bisection is fully reverted; the only difference from `40a9bc2` in `main.js` is the targeted root-cause fix.

## Reviewer findings resolution

Plan-reviewer report saved at `/home/alexie/software/oscilloscope/docs/plans/reviews/the-project-no-longer-zippy-mist.md`. Findings: 5 CRITICAL, 5 IMPORTANT, 2 NICE-TO-HAVE, 4 UNVERIFIED, 4 QUESTIONS. All addressed below.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | CRITICAL | Canary does not confirm app started before screenshot. | FIXED: Task 2 Step 1 adds `waitForSelector('#controls:not([hidden])', { timeout: 5000 })` as the ready check, plus a verify-the-selector note. |
| 2 | CRITICAL | Calibration step marked optional. | FIXED: Task 2 Step 3 rewritten as MANDATORY with explicit "do not skip" guidance and a numbered 5-step procedure. |
| 3 | CRITICAL | Headless WebGL backend may not catch Android-specific shader bugs. | FIXED: Task 2 Step 1 includes an explicit CAVEAT comment in the test source. Task 7 already covers manual Android verification. Commit-message templates in Task 6 Step 5 also call this out. |
| 4 | CRITICAL | Variant B test cannot distinguish "all 5 strokes worked" from "only last stroke worked". | FIXED: Task 5 Variant B B1 rewritten to compare single-stroke baseline vs multi-offset pattern and assert `multi > single * 1.5`, plus a console-error listener that fails on any error during render. |
| 5 | CRITICAL | Variant C does not check sprite position drift. | FIXED: Task 5 Variant C C1 now records `finalX`, `finalY`, `finalScaleX`, `finalScaleY`, `finalRotation` and asserts position stays on canvas and scale stays in [0.5, 2.0]. |
| 6 | IMPORTANT | Try/catch wrapper visibility unclear across Tasks 2 and 3. | FIXED: Task 3 preamble now states the wrapper is already in the working tree, stays untouched through Task 2 and Task 3, and is removed in Task 6. |
| 7 | IMPORTANT | Task 1 Step 2 should clarify npm install handles devDeps atomically. | FIXED: Task 1 Step 1 now has a clarifying paragraph; Step 2's title narrowed to "edit `scripts` block only". |
| 8 | IMPORTANT | Task 4 bisection output does not capture per-step diagnostics. | FIXED: playwright.config.js (Task 1 Step 3) now sets `screenshot: 'only-on-failure'` and `trace: 'retain-on-failure'`. Task 4 Step 4 instructs the executor to inspect `test-results/<test-name>/test-failed-*.png` and `trace.zip` to distinguish exception-failure from silent-failure, with `--headed --debug` as the fallback. |
| 9 | IMPORTANT | Variant B suggested fix mentions `closePath` without verifying it exists in v8. | FIXED: Task 5 Variant B gains a new step B0 with the exact grep + node probe commands to verify API surface before writing the test. B3 explicitly conditions the fix shape on B0's findings. |
| 10 | IMPORTANT | Commit-message template is a vague placeholder. | FIXED: Task 6 Step 5 now contains three HEREDOC templates (Variant A / B / C) with bracketed placeholders for the specific finding. |
| 11 | NICE-TO-HAVE | `captureStream(30)` FPS choice not justified. | FIXED: Task 2 Step 1 test source has a one-line comment explaining the 30 FPS is arbitrary and the consumer ignores the video track. |
| 12 | NICE-TO-HAVE | APK path version matches package.json version. | REJECTED as no-op: there is nothing to fix. Confirmed `scope-0.3.0.apk` matches `package.json` version `0.3.0`. |
| U1 | UNVERIFIED | Headless Chromium WebGL == Android WebView. | ACCEPTED limitation: documented in test caveat + Task 7 manual verification + commit message. |
| U2 | UNVERIFIED | `window.MeshWarp` / `window.PaletteColor` globals exist in test page. | VERIFIED in plan-author session: `index.html:151` loads `mesh-warp.js` and `index.html:150` loads `palette-color.js`; both files set `globalThis.MeshWarp` and `globalThis.PaletteColor` respectively. The Playwright test page loads the same `index.html`, so the globals are available. No plan change needed. |
| U3 | UNVERIFIED | pixi-shim line-26 export is sufficient for tests using `window.PIXI.BlurFilter`. | VERIFIED in plan-author session: `index.html:15` loads the v8 UMD bundle which assigns `window.PIXI` BEFORE the importmap and `pixi-shim.js` run; `window.PIXI.BlurFilter` is the UMD top-level export, set directly by the bundle, independent of the shim. Tests can use `window.PIXI.BlurFilter` directly. No plan change needed. |
| U4 | UNVERIFIED | No startup gating in headless mode. | DEFERRED to execution: the executor runs the canary in Task 2 Step 2 and observes whether the ready-selector (`#controls:not([hidden])`) appears within 5 seconds. If it does not, startup gating is real and the executor surfaces the failure rather than proceeding. |
| Q1 | QUESTION | UMD `window.PIXI.BlurFilter` vs ESM re-export in the test? | ANSWERED in U3 above: tests use the UMD global. |
| Q2 | QUESTION | PIXI v8 `Graphics.stroke()` semantics confirmed against primary source? | DEFERRED to execution: Task 5 Variant B Step B0 now contains the exact grep + Node probe commands. The fix in B3 explicitly conditions on the probe's output. |
| Q3 | QUESTION | Is the canary intended as a low-bar smoke test? | ANSWERED: YES. Task 7 (manual Android verification) is the source of truth for the device-level fix; the canary is a CI regression guard. Documented in the commit-message templates. |
| Q4 | QUESTION | Has `addInitScript`-stubbed `getDisplayMedia` been tested in headless Chromium? | DEFERRED to execution: Task 2 Step 2 is exactly that test. If the stub fails, the canary will fail on the `#controls:not([hidden])` ready check (the app never started), surfacing the problem before the screenshot step. The executor reverts to a different stub strategy if so. |

