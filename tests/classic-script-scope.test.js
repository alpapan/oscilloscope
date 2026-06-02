// Guards against the global-scope collision that broke single-tap palette
// cycling: index.html loads several files as classic <script> tags, which in a
// browser SHARE one global lexical environment. Two files declaring the same
// top-level `const`/`let`/`class` make the second script fail to execute - so
// its `globalThis.X = ...` export silently never runs (e.g. palette-sets.js ->
// window.PaletteSets undefined). Node's require() isolates module scopes and
// cannot catch this, so this test reproduces the browser by compiling the
// concatenation of the real classic scripts.

const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function classicLocalScriptSrcs() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const srcs = [];
  const tagRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const attrs = m[1];
    if (/\btype\s*=\s*["'](module|importmap)["']/i.test(attrs)) continue; // modules have their own scope
    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (/^https?:/i.test(src) || src.startsWith("vendor/")) continue; // third-party bundles are self-contained
    srcs.push(src);
  }
  return srcs;
}

test("classic <script> files compile together without top-level lexical collisions", () => {
  const srcs = classicLocalScriptSrcs();
  assert.ok(srcs.length > 1, "expected several classic local scripts in index.html");

  const combined = srcs
    .map((s) => `// ===== ${s} =====\n` + fs.readFileSync(path.join(ROOT, s), "utf8"))
    .join("\n;\n");

  let err = null;
  try {
    new vm.Script(combined, { filename: "combined-classic-scripts.js" });
  } catch (e) {
    err = e;
  }
  assert.strictEqual(
    err,
    null,
    err
      ? `Classic scripts collide in the shared global scope: ${err.message}. ` +
        `In the browser the second script fails to load and its globalThis export never runs. ` +
        `Wrap the offending file(s) in an IIFE so their top-level declarations are not global.`
      : "",
  );
});
