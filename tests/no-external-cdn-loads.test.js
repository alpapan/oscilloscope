// Guards the privacy-policy claim "the app makes no outbound internet
// connection at startup" by asserting that the source-of-truth web
// assets (index.html + any *.js / *.css the app loads) reference no
// CDN or third-party URLs. The vendored libs under vendor/ replace
// what used to be cdn.jsdelivr.net + esm.sh runtime loads.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const FORBIDDEN_HOSTS = [
  'cdn.jsdelivr.net',
  'esm.sh',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'cdn.skypack.dev',
];

// Files that get shipped to users (mirrored by sync-www.sh into www/).
const SHIPPED = [
  'index.html',
  'main.js',
  'style.css',
  'pixi-shim.js',
  'audio-ring-buffer.js',
  'audio-worklet-processor.js',
  'audio-features.js',
  'palette-color.js',
  'mesh-warp.js',
  'swipe-detector.js',
  'mobile-ui.js',
  'tv-frame-decode.js',
];

test('no shipped file references a CDN URL at runtime', () => {
  const offenders = [];
  for (const rel of SHIPPED) {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf8');
    for (const host of FORBIDDEN_HOSTS) {
      const re = new RegExp(`https?://${host.replace(/\./g, '\\.')}`, 'g');
      const matches = content.match(re);
      if (matches) {
        offenders.push(`${rel}: ${matches.length} reference(s) to ${host}`);
      }
    }
  }
  assert.equal(
    offenders.length, 0,
    'shipped files must not reference any CDN at runtime:\n' + offenders.join('\n')
  );
});

test('vendor/ contains the local pixi.js + pixi-filters bundles', () => {
  for (const v of ['vendor/pixi.min.js', 'vendor/pixi-filters.mjs']) {
    const abs = path.join(REPO, v);
    assert.ok(fs.existsSync(abs), `expected ${v}`);
    const size = fs.statSync(abs).size;
    assert.ok(size > 100_000, `${v} suspiciously small: ${size} bytes`);
  }
});

test('sync-www.sh mirrors vendor/ into the www/ output', () => {
  const sync = fs.readFileSync(path.join(REPO, 'sync-www.sh'), 'utf8');
  // sync-www.sh restructured to a single for-loop with subdir paths;
  // each subdir is mkdir-p'd before the cp. Assert both vendored
  // libraries are in that list and that the loop creates target dirs.
  assert.match(sync, /vendor\/pixi\.min\.js/);
  assert.match(sync, /vendor\/pixi-filters\.mjs/);
  assert.match(sync, /mkdir -p "\$DEST\/\$\(dirname "\$f"\)"/);
});
