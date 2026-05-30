const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatVersionLabel } = require("../main.js");

test("prefixes a version string with v", () => {
  assert.equal(formatVersionLabel("0.3.3"), "v0.3.3");
});

test("empty or missing version yields empty label", () => {
  assert.equal(formatVersionLabel(""), "");
  assert.equal(formatVersionLabel(null), "");
  assert.equal(formatVersionLabel(undefined), "");
});

test("does not double-prefix an already-v string", () => {
  assert.equal(formatVersionLabel("v0.3.3"), "v0.3.3");
});
