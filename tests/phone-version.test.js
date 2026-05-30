const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("phone drawer has a version line as a direct <p> child (survives pre-capture filter)", () => {
  const html = read("index.html");
  const drawer = (html.match(/<aside id="mobile-drawer"[\s\S]*?<\/aside>/) || [])[0] || "";
  assert.match(drawer, /<p id="mobile-version"/);
  // Placed after the Exit button, i.e. at the very bottom of the drawer.
  assert.ok(
    drawer.indexOf('id="mobile-version"') > drawer.indexOf('id="mobile-exit"'),
    "version line must come after the Exit button"
  );
  // It is a <p>, not a <section>, so the pre-capture rule that hides
  // non-pc-keep sections does not hide it - it shows in both drawer states.
  assert.doesNotMatch(drawer, /<section[^>]*>\s*<p id="mobile-version"/);
});

test("phone version line is small and muted", () => {
  const css = read("style.css");
  const block = (css.match(/#mobile-version\s*{([^}]*)}/) || [])[1] || "";
  const size = Number((block.match(/font-size:\s*(\d+)px/) || [])[1]);
  assert.ok(size > 0 && size <= 14, `version font ${size} should be small (<=14px)`);
});
