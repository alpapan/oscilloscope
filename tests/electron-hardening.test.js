const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.resolve(__dirname, '..');

test('electron blocks new windows and external navigation', () => {
  const m = fs.readFileSync(path.join(REPO, 'electron/main.js'), 'utf8');
  assert.match(m, /setWindowOpenHandler/);
  assert.match(m, /will-navigate/);
  assert.match(m, /nodeIntegration:\s*false/);
  assert.match(m, /contextIsolation:\s*true/);
});
test('capacitor config does not permit wildcard WebView navigation', () => {
  // Capacitor controls Android WebView navigation via capacitor.config.json
  // server.allowNavigation, NOT the Cordova-era res/xml/config.xml <access>
  // whitelist. `cap sync` regenerates that config.xml (it is gitignored/generated)
  // WITH <access origin="*"/> and Capacitor ignores it, so testing config.xml is
  // meaningless. Unset/empty allowNavigation = navigation locked to the app origin.
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'capacitor.config.json'), 'utf8'));
  const allow = cfg.server && cfg.server.allowNavigation;
  assert.ok(
    !allow || (Array.isArray(allow) && !allow.includes('*')),
    'capacitor.config.json server.allowNavigation must not be a wildcard'
  );
});
