const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("sendTvRenderRequest includes fftSize in the render-request JSON", () => {
  const js = read("main.js");
  assert.match(js, /function\s+sendTvRenderRequest[\s\S]{0,500}?fftSize:\s*state\.fftSize/);
});

test("fftSize slider handler clamps to <= 16384", () => {
  const js = read("main.js");
  assert.match(js, /state\.fftSize\s*=\s*Math\.min\(\s*parseInt\([^,]+,\s*10\)\s*,\s*16384\s*\)/);
});

test("smoothing slider handler calls setSmoothingAlpha after writing state.smoothing", () => {
  const js = read("main.js");
  assert.match(js, /state\.smoothing\s*=[\s\S]{0,200}?setSmoothingAlpha\?\.\(\{\s*value:\s*state\.smoothing\s*\}\)/);
});

test("phone init pushes initial setSmoothingAlpha", () => {
  const js = read("main.js");
  // After MobileUI.wireDrawer line (1516), a setSmoothingAlpha call must appear.
  assert.match(js, /MobileUI\.wireDrawer\(state,\s*applyState\)\s*;[\s\S]{0,400}?setSmoothingAlpha\?\.\(\{\s*value:\s*state\.smoothing\s*\}\)/);
});

test("index.html fft dropdown uses k-labelled options and excludes 256 / 32768", () => {
  const html = read("index.html");
  assert.match(html, /<option value="512">0\.5k<\/option>/);
  assert.match(html, /<option value="1024">1k<\/option>/);
  assert.match(html, /<option value="2048"\s+selected>2k<\/option>/);
  assert.match(html, /<option value="4096">4k<\/option>/);
  assert.match(html, /<option value="8192">8k<\/option>/);
  assert.match(html, /<option value="16384">16k<\/option>/);
  assert.doesNotMatch(html, /<option[^>]*>256<\/option>/);
  assert.doesNotMatch(html, /<option[^>]*>32768<\/option>/);
});
