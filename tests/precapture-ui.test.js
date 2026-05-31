const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("start screen has both capture buttons", () => {
  const html = read("index.html");
  assert.match(html, /id="mobile-capture"[^>]*>Capture audio</);
  assert.match(html, /id="mobile-capture-mic"[^>]*>Capture mic</);
});

test("pre-capture-safe drawer sections are marked pc-keep", () => {
  const html = read("index.html");
  assert.match(html, /<section class="pc-keep">\s*<h2>Theme<\/h2>/);
  assert.match(html, /<section class="pc-keep">\s*<label class="toggle"><input id="mobile-keepawake"/);
  // Exactly two sections kept - guards against accidentally marking (or
  // failing to mark) a section, which would mis-filter the pre-capture drawer.
  assert.equal((html.match(/class="pc-keep"/g) || []).length, 2);
});

test("css hides live-only drawer items pre-capture", () => {
  const css = read("style.css");
  assert.match(css, /body\.pre-capture #mobile-drawer > section:not\(\.pc-keep\)\s*{\s*display:\s*none/);
  assert.match(css, /body\.pre-capture #mobile-stop\s*{\s*display:\s*none/);
});

test("main.js toggles the pre-capture body class", () => {
  const js = read("main.js");
  assert.match(js, /classList\.add\("pre-capture"\)/);
  assert.match(js, /classList\.remove\("pre-capture"\)/);
});

test("wireGestures binds the start card for the pre-capture swipe", () => {
  const js = read("mobile-ui.js");
  assert.match(js, /getElementById\("mobile-start"\)/);
});

test("capture-mic and connect-tv buttons are themed and meet the 44px touch floor", () => {
  const css = read("style.css");
  // Capture mic: dedicated rule, themed (var --fg) + min-height >= 44px.
  const mic = (css.match(/#mobile-capture-mic\s*{([^}]*)}/) || [])[1] || "";
  assert.match(mic, /var\(--fg\)/);
  const micH = Number((mic.match(/min-height:\s*(\d+)px/) || [])[1]);
  assert.ok(micH >= 44, `capture-mic min-height ${micH} must be >= 44`);
  // Connect to TV joins the themed drawer-action group (green outline, 48px).
  assert.match(css, /#mobile-connect-tv,\s*\n\s*#fullscreen\s*{/);
});
