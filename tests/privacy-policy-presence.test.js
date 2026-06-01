// Verifies that the privacy policy text exists, covers Play's mandatory
// sections, and is reachable from inside the app via a same-page overlay
// (NOT a navigation — Capacitor's WebView would suspend the AudioWorklet
// on top-level navigation and the running visualisation would be lost).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

test('privacy policy markdown exists with the eight mandatory sections', () => {
  const p = path.join(REPO, 'docs/privacy-policy.md');
  assert.ok(fs.existsSync(p), `expected ${p}`);
  const c = fs.readFileSync(p, 'utf8');
  for (const heading of [
    /developer/i,
    /microphone/i,
    /data we (collect|access)/i,
    /third part/i,
    /permissions/i,
    /children/i,
    /changes/i,
    /effective/i,
  ]) {
    assert.match(c, heading, `missing section matching ${heading}`);
  }
});

test('privacy policy discloses notification (media-session) access in both surfaces', () => {
  // The in-app overlay (index.html) and the canonical markdown are kept in
  // lockstep; the now-playing feature reads media-session metadata via a
  // notification listener, so both must disclose it.
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const md = fs.readFileSync(path.join(REPO, 'docs/privacy-policy.md'), 'utf8');
  for (const c of [html, md]) {
    assert.match(c, /media[- ]session/i);
    assert.match(c, /notification access|notification listener/i);
  }
});

test('index.html embeds the privacy overlay element starting hidden', () => {
  const p = path.join(REPO, 'index.html');
  const c = fs.readFileSync(p, 'utf8');
  assert.match(c, /id="privacy-overlay"/);
  assert.match(c, /id="privacy-title"/);
  assert.match(c, /id="privacy-close"/);
  // The overlay must start hidden — anchoring on the class is the
  // canonical way; an inline style="display:none" also counts.
  assert.match(
    c,
    /id="privacy-overlay"[^>]*(class="[^"]*\bhidden\b|style="[^"]*display\s*:\s*none)/,
    'privacy overlay must start hidden'
  );
});

test('mobile-ui wires the overlay toggle without navigation or fetch', () => {
  const p = path.join(REPO, 'mobile-ui.js');
  const c = fs.readFileSync(p, 'utf8');
  assert.match(c, /privacy-overlay/, 'expected privacy-overlay reference');
  // Must NOT navigate or fetch - either would kill the AudioWorklet.
  assert.doesNotMatch(c, /location\s*=\s*['"]?index-privacy/);
  assert.doesNotMatch(c, /location\.href\s*=/);
  assert.doesNotMatch(c, /fetch\(['"]?index-privacy/);
});

test('overlay has a top-right close X button alongside the bottom Close', () => {
  const p = path.join(REPO, 'index.html');
  const c = fs.readFileSync(p, 'utf8');
  assert.match(c, /id="privacy-close-x"/, 'expected top-right X close button');
  assert.match(c, /id="privacy-close"/, 'expected bottom Close button');
});

test('mobile-ui binds the top-right X to overlay dismiss', () => {
  const p = path.join(REPO, 'mobile-ui.js');
  const c = fs.readFileSync(p, 'utf8');
  assert.match(c, /privacy-close-x/);
});

test('mobile-ui handles a left-to-right swipe on the overlay to close it', () => {
  const p = path.join(REPO, 'mobile-ui.js');
  const c = fs.readFileSync(p, 'utf8');
  // Find the privacy-overlay wiring block and assert the swipe handler
  // is wired there (not accidentally matched against unrelated drawer
  // gestures higher in the file).
  const block = c.match(
    /privacy[A-Za-z]*Overlay\s*=[\s\S]*?(?=\}\s*\n\s*\}|$)/
  );
  assert.ok(block, 'expected a privacy-overlay wiring block in mobile-ui.js');
  assert.match(block[0], /touchstart/);
  assert.match(block[0], /touchend/);
  assert.match(block[0], /classifySwipe/);
});

test('main.js back-button handler dismisses the overlay at top priority', () => {
  const p = path.join(REPO, 'main.js');
  const c = fs.readFileSync(p, 'utf8');
  // The privacy-overlay check must appear inside the backButton
  // listener BEFORE the drawer-open check, otherwise back-from-overlay
  // would close the drawer first.
  const backIdx = c.indexOf('"backButton"');
  assert.ok(backIdx > 0, 'expected backButton listener registration');
  const drawerIdx = c.indexOf('isDrawerOpen()', backIdx);
  const overlayIdx = c.indexOf('privacy-overlay', backIdx);
  assert.ok(overlayIdx > 0, 'expected privacy-overlay handling inside backButton listener');
  assert.ok(overlayIdx < drawerIdx,
    'privacy-overlay close must run BEFORE drawer-close in the backButton chain');
});

test('back-button is a silent no-op during running visualisation with drawer + overlay closed', () => {
  const p = path.join(REPO, 'main.js');
  const c = fs.readFileSync(p, 'utf8');
  const backIdx = c.indexOf('"backButton"');
  assert.ok(backIdx > 0);
  // Extract the state.running branch inside the backButton listener.
  // It must NOT call stopCapture and must NOT call exitApp -- both
  // would terminate the user's active capture session against their
  // intent. The early-return ensures the later confirm-exit branch
  // does not run either.
  const tail = c.slice(backIdx, backIdx + 2000);
  const m = tail.match(/if\s*\(\s*state\.running\s*\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(m, 'expected an `if (state.running)` branch in the backButton listener');
  const body = m[1];
  assert.doesNotMatch(body, /stopCapture\s*\(/,
    'state.running branch must NOT call stopCapture (block, do not stop)');
  assert.doesNotMatch(body, /exitApp\s*\(/,
    'state.running branch must NOT call exitApp');
  assert.match(body, /\breturn\b/,
    'state.running branch must early-return so later confirm-exit does not run');
});

test('style.css has a top-right close-X selector with 44px+ touch floor', () => {
  const p = path.join(REPO, 'style.css');
  const c = fs.readFileSync(p, 'utf8');
  assert.match(c, /\.overlay-close-x\s*\{/);
  // The close-X must be at least 44x44 to meet the 44pt touch floor
  // (Apple HIG / project memory feedback_button_theme_and_size).
  const block = c.match(/\.overlay-close-x\s*\{([^}]*)\}/);
  assert.ok(block, 'expected .overlay-close-x block');
  const mh = (block[1].match(/min-height\s*:\s*(\d+)px/) || [])[1];
  const mw = (block[1].match(/min-width\s*:\s*(\d+)px/) || [])[1];
  assert.ok(mh && parseInt(mh, 10) >= 44, `.overlay-close-x min-height ${mh} < 44`);
  assert.ok(mw && parseInt(mw, 10) >= 44, `.overlay-close-x min-width ${mw} < 44`);
});

test('style.css declares the .overlay class with a button-floor selector', () => {
  const p = path.join(REPO, 'style.css');
  const c = fs.readFileSync(p, 'utf8');
  assert.match(c, /\.overlay\s*\{/, 'expected .overlay block');
  assert.match(c, /\.overlay-close\s*\{/, 'expected .overlay-close block');
  // Close button inside the overlay must respect the 44px+ min-height
  // floor from project memory feedback_button_theme_and_size. The
  // codebase already uses 48px or 56px for drawer buttons; either is
  // fine, but anything < 44px is forbidden.
  const m = c.match(/\.overlay-close[^}]*min-height\s*:\s*(\d+)px/);
  assert.ok(m, 'expected .overlay-close to declare min-height: Npx');
  const px = parseInt(m[1], 10);
  assert.ok(px >= 44, `.overlay-close min-height ${px}px < 44px floor`);
});
