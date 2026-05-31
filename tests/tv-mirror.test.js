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
  // Helper must encode view as numeric 0|1|2|3|4|5 (matching sendTvRenderRequest's convention).
  assert.match(js, /function\s+sendPhoneMirror[\s\S]{0,400}?state\.view\s*===\s*["']spectrum["']\s*\?\s*1\s*:\s*state\.view\s*===\s*["']lissajous["']\s*\?\s*2\s*:\s*state\.view\s*===\s*["']cosmos["']\s*\?\s*3\s*:\s*state\.view\s*===\s*["']grove["']\s*\?\s*4\s*:\s*state\.view\s*===\s*["']firebird["']\s*\?\s*5\s*:\s*0/);
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
  assert.match(js, /\["crt",\s*"neon",\s*"mono",\s*"nebula",\s*"verdant",\s*"ember",\s*"chroma"\]\.includes/);
});

test("tvRenderRequest listener maps numeric view back to string for state.view", () => {
  const js = read("main.js");
  assert.match(js, /view\s*===\s*1\s*\?\s*["']spectrum["']\s*:\s*view\s*===\s*2\s*\?\s*["']lissajous["']\s*:\s*view\s*===\s*3\s*\?\s*["']cosmos["']\s*:\s*view\s*===\s*4\s*\?\s*["']grove["']\s*:\s*view\s*===\s*5\s*\?\s*["']firebird["']\s*:\s*["']waveform["']/);
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
  assert.match(js, /const\s+order\s*=\s*\["waveform",\s*"spectrum",\s*"lissajous",\s*"cosmos",\s*"grove",\s*"firebird"\]/);
});

test("wireTvRemote encodes the cycled view numerically for all six views", () => {
  // The remote round-trip maps `next` -> numeric view; it must cover cosmos/
  // grove/firebird (3/4/5) in lockstep with the other numeric encode sites,
  // or remote-cycling to a new view silently requests waveform from the phone.
  const js = read("main.js");
  assert.match(js, /next\s*===\s*["']spectrum["']\s*\?\s*1\s*:\s*next\s*===\s*["']lissajous["']\s*\?\s*2\s*:\s*next\s*===\s*["']cosmos["']\s*\?\s*3\s*:\s*next\s*===\s*["']grove["']\s*\?\s*4\s*:\s*next\s*===\s*["']firebird["']\s*\?\s*5\s*:\s*0/);
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

test("phoneViewRequest listener admits all six numeric views (0..5)", () => {
  // The validation gate must admit 0..5; a [0,1,2]-only gate silently drops
  // remote-cycled cosmos/grove/firebird (3/4/5) so the phone never switches.
  const js = read("main.js");
  assert.match(js, /addListener\("phoneViewRequest"[\s\S]{0,600}?\[0,\s*1,\s*2,\s*3,\s*4,\s*5\]\.includes\(view\)/);
});
