const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// The slider is a linear audio-gain knob (sets audio.gain.gain.value), so its
// user-visible label is "Gain", not "Sensitivity". Covers the desktop control,
// the mobile drawer heading, and the swipe toast. Internal identifiers
// (state.sensitivity, stepSensitivity) are intentionally left unchanged.

test("the gain control is labelled Gain, not Sensitivity (desktop + mobile)", () => {
  const html = read("index.html");
  assert.match(html, /<label>Gain\s+<input id="gain"/);
  assert.match(html, /<h2>Gain<\/h2>\s+<input id="mobile-gain"/);
  assert.doesNotMatch(html, /<label>Sensitivity/);
  assert.doesNotMatch(html, /<h2>Sensitivity<\/h2>/);
});

test("the gain swipe toast reads 'Gain', not 'Sensitivity'", () => {
  const js = read("mobile-ui.js");
  assert.match(js, /showToast\("Gain "/);
  assert.doesNotMatch(js, /showToast\("Sensitivity /);
});
