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
  // Must NOT navigate or fetch — either would kill the AudioWorklet.
  assert.doesNotMatch(c, /location\s*=\s*['"]?index-privacy/);
  assert.doesNotMatch(c, /location\.href\s*=/);
  assert.doesNotMatch(c, /fetch\(['"]?index-privacy/);
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
