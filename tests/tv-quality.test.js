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

test("drawWaveform branches on state.tvMode to skip phone-side prep already done", () => {
  const js = read("main.js");
  // In TV mode the wire data is already pcmSmooth+smoothBuf+findZeroCrossing-prepped on the phone.
  // drawWaveform must skip those steps in TV mode to avoid double-smoothing or re-trim to a later cycle's crossing.
  assert.match(js, /function\s+drawWaveform[\s\S]{0,800}?if\s*\(\s*state\.tvMode\s*\)/);
});

test("drawLissajous branches on state.tvMode to skip phone-side prep already done", () => {
  const js = read("main.js");
  // Same as drawWaveform: phone already smoothed both channels.
  assert.match(js, /function\s+drawLissajous[\s\S]{0,800}?if\s*\(\s*state\.tvMode\s*\)/);
});
