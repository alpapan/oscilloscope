const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("mobile-ui has a Now Playing label for the nowplaying view", () => {
  assert.match(read("mobile-ui.js"), /nowplaying:\s*"Now Playing"/);
});

test("desktop #view select omits the now-playing option (Android-only display)", () => {
  const html = read("index.html");
  const select = (html.match(/<select id="view">[\s\S]*?<\/select>/) || [])[0] || "";
  assert.doesNotMatch(select, /value="nowplaying"/);
});
