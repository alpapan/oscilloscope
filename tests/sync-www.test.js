// Guard against the failure pattern observed on 2026-05-18: a new browser-
// side module was added under the project root but not registered in
// sync-www.sh, so it shipped missing from the APK. The user saw "nothing
// happens after consent" / PiP blank because main.js read window.<Module>
// which was undefined.
//
// These tests assert the load-bearing invariant: anything a browser /
// WebView needs at runtime MUST be in sync-www.sh's copy list.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SYNC_SH = path.join(ROOT, "sync-www.sh");
const INDEX_HTML = path.join(ROOT, "index.html");

function parseSyncList() {
  const text = fs.readFileSync(SYNC_SH, "utf8");
  const start = text.indexOf("for f in");
  const end = text.indexOf("do", start);
  assert.ok(start >= 0 && end > start, "could not locate sync-www.sh for loop");
  const block = text.slice(start, end);
  return block
    .split(/\s+/)
    .filter(tok => /\.[A-Za-z0-9]+$/.test(tok))
    .map(tok => tok.trim());
}

function rootJsFiles() {
  return fs.readdirSync(ROOT)
    .filter(name => name.endsWith(".js") && !name.endsWith(".test.js") && name !== "playwright.config.js")
    .filter(name => fs.statSync(path.join(ROOT, name)).isFile());
}

function parseLocalScriptSrcs() {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const srcs = [];
  const matches = html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi);
  for (const m of matches) {
    const src = m[1];
    if (/^[a-z]+:\/\//i.test(src)) continue;          // http(s):// CDN
    if (src.startsWith("//")) continue;                // protocol-relative CDN
    srcs.push(src);
  }
  return srcs;
}

test("sync-www.sh mirrors every root-level .js source file", () => {
  const synced = new Set(parseSyncList());
  const sources = rootJsFiles();
  const missing = sources.filter(f => !synced.has(f));
  assert.deepEqual(
    missing, [],
    `root-level JS sources missing from sync-www.sh: ${missing.join(", ")}\n` +
    `Add them to the 'for f in' block in sync-www.sh, otherwise they will ` +
    `not be copied into www/ and the APK will load with the script missing.`
  );
});

test("index.html script src= paths are all in sync-www.sh", () => {
  const synced = new Set(parseSyncList());
  const srcs = parseLocalScriptSrcs();
  const missing = srcs.filter(s => !synced.has(s));
  assert.deepEqual(
    missing, [],
    `index.html references local scripts not in sync-www.sh: ${missing.join(", ")}\n` +
    `If a script is referenced from index.html, sync-www.sh must copy it.`
  );
});

test("sync-www.sh does not list files that do not exist", () => {
  const synced = parseSyncList();
  const missing = synced.filter(f => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(
    missing, [],
    `sync-www.sh lists files that do not exist on disk: ${missing.join(", ")}`
  );
});
