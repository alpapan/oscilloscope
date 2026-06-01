const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("state object declares paired:false", () => {
  const js = read("main.js");
  assert.match(js, /paired:\s*false/);
});

test("phone-side tvConnected listener sets state.paired = true", () => {
  const js = read("main.js");
  // The phone-side tvConnected handler shows the "Streaming to TV" toast (line ~982 today).
  // It must also set state.paired = true.
  assert.match(js, /tvConnected[\s\S]{0,400}?showToast\("Streaming to TV"\)[\s\S]{0,200}?state\.paired\s*=\s*true/);
});

test("phone-side tvDisconnected listener sets state.paired = false", () => {
  const js = read("main.js");
  assert.match(js, /tvDisconnected[\s\S]{0,400}?showToast\("TV disconnected"\)[\s\S]{0,200}?state\.paired\s*=\s*false/);
});

test("TV-side tvConnected listener sets state.paired = true", () => {
  const js = read("main.js");
  // TV-side tvConnected hides the pair overlay and sends a render-request (line ~865 today).
  // It must also set state.paired = true.
  assert.match(js, /tvConnected[\s\S]{0,400}?hidePairOverlay\(\)[\s\S]{0,200}?state\.paired\s*=\s*true/);
});

test("TV-side tvDisconnected listener sets state.paired = false", () => {
  const js = read("main.js");
  assert.match(js, /tvDisconnected[\s\S]{0,400}?showPairOverlay\(tvPairCode[\s\S]{0,200}?state\.paired\s*=\s*false/);
});

test("applyState pushes mirror-state when paired and not in TV mode", () => {
  const js = read("main.js");
  // applyState contains a guarded call: if (!state.tvMode && state.paired) sendPhoneMirror(...)
  assert.match(js, /!state\.tvMode\s*&&\s*state\.paired[\s\S]{0,400}?sendPhoneMirror\(/);
});

test("phone-side tvConnected listener also pushes initial mirror-state", () => {
  const js = read("main.js");
  // The phone tvConnected handler (touched in Task 3) also calls sendPhoneMirror
  // with the current view + theme so the TV mirrors immediately on pair.
  assert.match(js, /tvConnected[\s\S]{0,500}?showToast\("Streaming to TV"\)[\s\S]{0,400}?sendPhoneMirror\(/);
});

test("sendPhoneMirror helper sends type:mirror-state with numeric view", () => {
  const js = read("main.js");
  // Helper must encode view as numeric via window.ViewIds.viewToId (matching sendTvRenderRequest's convention).
  assert.match(js, /function\s+sendPhoneMirror[\s\S]{0,400}?window\.ViewIds\.viewToId/);
  assert.match(js, /function\s+sendPhoneMirror[\s\S]{0,400}?type:\s*["']mirror-state["']/);
});

test("startTvMode registers a tvRenderRequest listener that handles mirror-state", () => {
  const js = read("main.js");
  // The listener must update state.view + state.theme on mirror-state and call applyState.
  // Bounds widened 200 -> 400 between view/theme/applyState: the 6-view numeric
  // decode and 7-palette whitelist made the correct code longer than the old
  // tight window (same rationale as the wireTvRemote bound widening below).
  assert.match(js, /addListener\("tvRenderRequest"[\s\S]{0,800}?type\s*===\s*["']mirror-state["'][\s\S]{0,400}?state\.view\s*=[\s\S]{0,400}?state\.theme\s*=[\s\S]{0,400}?applyState\(\)/);
});

test("tvRenderRequest listener validates theme against known palette set", () => {
  const js = read("main.js");
  assert.match(js, /if\s*\(\s*themes\[theme\]\s*\)\s*state\.theme\s*=\s*theme/);
});

test("tvRenderRequest listener maps numeric view back to string for state.view", () => {
  const js = read("main.js");
  assert.match(js, /addListener\("tvRenderRequest"[\s\S]{0,800}?window\.ViewIds\.idToView/);
});

test("tvRenderRequest listener wraps JSON.parse in try/catch", () => {
  const js = read("main.js");
  assert.match(js, /addListener\("tvRenderRequest"[\s\S]{0,200}?try\s*{[\s\S]{0,300}?JSON\.parse[\s\S]{0,400}?}\s*catch/);
});

test("wireTvRemote D-pad checks state.paired before deciding routing", () => {
  const js = read("main.js");
  // Bounds widened from 1500 to 2000 per code-review feedback: tight bound risks breakage on future comment/whitespace additions to wireTvRemote.
  assert.match(js, /function\s+wireTvRemote\(\)\s*{[\s\S]{0,2000}?state\.paired[\s\S]{0,800}?sendRenderRequest\(\{[\s\S]*?type:\s*["']remote-view-request["']/);
});

test("wireTvRemote computes newView from a local order array for the round-trip", () => {
  const js = read("main.js");
  assert.match(js, /const\s+order\s*=\s*window\.ViewIds\.VIEW_ORDER/);
});

test("wireTvRemote encodes the cycled view numerically for all views", () => {
  // The remote round-trip maps `next` -> numeric view using window.ViewIds.viewToId.
  const js = read("main.js");
  assert.match(js, /function\s+wireTvRemote[\s\S]{0,800}?window\.ViewIds\.viewToId\(next\)/);
});

test("wireTvRemote unpaired branch still calls MobileUI.cycleView (fallback)", () => {
  const js = read("main.js");
  assert.match(js, /MobileUI\?\.cycleView\(\+?1,\s*state,\s*applyState\)|MobileUI\?\.cycleView\(direction,\s*state,\s*applyState\)/);
});

test("phone init registers a phoneViewRequest listener", () => {
  const js = read("main.js");
  assert.match(js, /addListener\("phoneViewRequest"/);
});

test("phoneViewRequest listener maps numeric view back to string and calls applyState", () => {
  const js = read("main.js");
  assert.match(js, /addListener\("phoneViewRequest"[\s\S]{0,600}?state\.view\s*=[\s\S]{0,200}?applyState\(\)/);
});

test("phoneViewRequest listener admits all numeric views within VIEW_ORDER range", () => {
  // The validation gate must admit all views in the ViewIds range.
  const js = read("main.js");
  assert.match(js, /addListener\("phoneViewRequest"[\s\S]{0,600}?window\.ViewIds\.VIEW_ORDER\.length/);
});

test("sendTvRenderRequest encodes lissajous (v===2) and shape views (v>=6) as stereo channels", () => {
  // Shape views 6-10 (spiral/bloom/lasso/starburst/nova) need stereo waveform data
  // just like lissajous (view 2) already does. The channels field must be set to 2
  // when (v === 2 || v >= 6), and 1 otherwise.
  const js = read("main.js");
  assert.match(js, /channels:\s*\(\s*v\s*===\s*2\s*\|\|\s*v\s*>=\s*6\s*\)\s*\?\s*2\s*:\s*1/);
});
