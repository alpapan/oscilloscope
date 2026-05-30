const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// First arg of a clamp(min, pref, max) font-size, in px.
function minFontPx(css, selector) {
  const block = (css.match(new RegExp(selector.replace(/[.#]/g, "\\$&") + "\\s*{([^}]*)}")) || [])[1] || "";
  const m = block.match(/font-size:\s*clamp\(\s*(\d+)px/) || block.match(/font-size:\s*(\d+)px/);
  return m ? Number(m[1]) : NaN;
}

test("TV pair overlay: address line is smaller than the code line", () => {
  const css = read("style.css");
  const code = minFontPx(css, "#tv-pair-overlay .tv-pair-main");
  const addr = minFontPx(css, "#tv-pair-overlay .tv-pair-sub");
  assert.ok(code >= 28, `code line min font ${code} should be the large one`);
  assert.ok(addr > 0 && addr < code, `address line min font ${addr} must be smaller than code ${code}`);
});

test("TV version: present, bottom-right, smaller than the address line", () => {
  const html = read("index.html");
  const css = read("style.css");
  assert.match(html, /id="tv-version"/);
  const addr = minFontPx(css, "#tv-pair-overlay .tv-pair-sub");
  const ver = minFontPx(css, "body.tv #tv-version");
  assert.ok(ver > 0 && ver < addr, `version min font ${ver} must be smaller than address ${addr}`);
  const block = (css.match(/body\.tv #tv-version\s*{([^}]*)}/) || [])[1] || "";
  assert.match(block, /position:\s*fixed/);
  assert.match(block, /right:/);
  assert.match(block, /bottom:/);
});
