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

test("index.html fft dropdown uses k-labelled options and excludes 32768", () => {
  const html = read("index.html");
  assert.match(html, /<option value="128">0\.125k<\/option>/);
  assert.match(html, /<option value="256">0\.25k<\/option>/);
  assert.match(html, /<option value="512">0\.5k<\/option>/);
  assert.match(html, /<option value="1024">1k<\/option>/);
  assert.match(html, /<option value="2048"\s+selected>2k<\/option>/);
  assert.match(html, /<option value="4096">4k<\/option>/);
  assert.match(html, /<option value="8192">8k<\/option>/);
  assert.match(html, /<option value="16384">16k<\/option>/);
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

test("mobile-ui.js FFT_VALUES uses the eight values shared with the desktop select (drops 32768)", () => {
  const js = read("mobile-ui.js");
  assert.match(
    js,
    /FFT_VALUES\s*=\s*\[\s*128\s*,\s*256\s*,\s*512\s*,\s*1024\s*,\s*2048\s*,\s*4096\s*,\s*8192\s*,\s*16384\s*\]/
  );
});

test("mobile-ui.js fftSizeLabel renders sub-1024 values correctly (128 -> 0.125k, 256 -> 0.25k)", () => {
  const js = read("mobile-ui.js");
  // fftSizeLabel(128) must yield "0.125k" and fftSizeLabel(256) "0.25k";
  // previous implementation hard-coded "0.5k" for any n<1024 which is
  // wrong now that two smaller powers of two are in the option set.
  // We assert by parsing the function body and exercising it.
  const fnSrc = js.match(/function\s+fftSizeLabel\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(fnSrc, "expected fftSizeLabel function in mobile-ui.js");
  const fftSizeLabel = new Function("return " + fnSrc[0].replace("function fftSizeLabel", "function") + ";")();
  assert.equal(fftSizeLabel(128), "0.125k");
  assert.equal(fftSizeLabel(256), "0.25k");
  assert.equal(fftSizeLabel(512), "0.5k");
  assert.equal(fftSizeLabel(1024), "1k");
  assert.equal(fftSizeLabel(2048), "2k");
  assert.equal(fftSizeLabel(16384), "16k");
});

test("main.js registers a captureLost listener with cleanup handle", () => {
  const js = read("main.js");
  // The listener is added alongside the existing silentCapture / unrestrictedAvailable
  // ones, and the handle is removed in cleanup to mirror those.
  assert.match(js, /audio\.captureLostHandle\s*=\s*await\s+plugin\.addListener\(\s*["']captureLost["']/);
  assert.match(js, /audio\.captureLostHandle[\s\S]{0,200}?\.remove\(\)/);
});

test("main.js onCaptureLost handler routes through stopCapture for full UI sync", () => {
  const js = read("main.js");
  // The handler must invoke stopCapture (which tears down audio nodes + listeners
  // + sets running=false + restores UI) rather than only setRunning(false), so
  // the JS state stays in sync when the notification Stop button kills the service.
  assert.match(js, /function\s+onCaptureLost[\s\S]{0,400}?stopCapture\(\)[\s\S]{0,400}?(setStatus|showToast)/);
});

test("mobile-ui.js renders fftSize as a k-label in the mobile picker", () => {
  const js = read("mobile-ui.js");
  // The mobile picker's value span must display "0.5k"/"1k"/.../"16k" not the raw integer.
  // Look for either a helper function or a map literal that translates 2048 -> "2k" etc.
  assert.match(js, /\b(?:fftSizeLabel|kLabel|fftKLabel)\s*\(/);
});

test("index.html mobile-fft-value default text matches the default state.fftSize as k-label", () => {
  const html = read("index.html");
  // Default fftSize is 2048 = "2k". The static placeholder text in the span should match.
  assert.match(html, /<span id="mobile-fft-value">2k<\/span>/);
});
