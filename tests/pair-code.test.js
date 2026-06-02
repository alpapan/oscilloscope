const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizePairCode } = require("../main.js");

test("sanitizePairCode keeps only digits", () => {
  assert.equal(sanitizePairCode("1a2b3"), "123");
});

test("sanitizePairCode caps at 6 digits", () => {
  assert.equal(sanitizePairCode("12345678"), "123456");
});

test("sanitizePairCode strips spaces and symbols", () => {
  assert.equal(sanitizePairCode(" 12-34 "), "1234");
});

test("sanitizePairCode handles null/undefined", () => {
  assert.equal(sanitizePairCode(null), "");
  assert.equal(sanitizePairCode(undefined), "");
});

test("pair-code modal input is numeric, focused, and capped at 6", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  // The 6-digit code entry must raise a numeric soft keyboard and autofocus.
  assert.match(js, /inputMode\s*=\s*["']numeric["']/);
  assert.match(js, /maxLength\s*=\s*6/);
  assert.match(js, /\.focus\(\)/);
});
