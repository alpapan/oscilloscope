const test = require("node:test");
const assert = require("node:assert/strict");
const { classifySwipe } = require("../swipe-detector.js");

test("rightward horizontal swipe of 100 px returns 'right'", () => {
  assert.equal(classifySwipe(0, 0, 100, 5), "right");
});

test("leftward horizontal swipe of 100 px returns 'left'", () => {
  assert.equal(classifySwipe(0, 0, -100, 5), "left");
});

test("vertical-dominant motion returns 'none'", () => {
  assert.equal(classifySwipe(0, 0, 30, 200), "none");
});

test("tiny motion (under threshold) returns 'none'", () => {
  assert.equal(classifySwipe(0, 0, 20, 5), "none");
});

test("near-diagonal but slightly horizontal-dominant returns 'none' (must be 1.5x)", () => {
  // 60 horizontal, 50 vertical: horizontal-dominant but ratio 1.2 < 1.5
  assert.equal(classifySwipe(0, 0, 60, 50), "none");
});

test("clearly horizontal-dominant 1.5x or more returns the direction", () => {
  assert.equal(classifySwipe(0, 0, 75, 50), "right");
  assert.equal(classifySwipe(0, 0, -75, 50), "left");
});

test("edge-zone swipes (within ~32 px of left or right edge of canvas) return 'none'", () => {
  // 8 px from left edge of an 800-wide canvas
  assert.equal(classifySwipe(0, 0, 100, 5, { x0: 8, canvasWidth: 800 }), "none");
  // 24 px from left edge - still inside the (now wider) deadzone
  assert.equal(classifySwipe(0, 0, 100, 5, { x0: 24, canvasWidth: 800 }), "none");
  // 8 px from right edge
  assert.equal(classifySwipe(0, 0, -100, 5, { x0: 792, canvasWidth: 800 }), "none");
  // 24 px from right edge - still inside the deadzone
  assert.equal(classifySwipe(0, 0, -100, 5, { x0: 776, canvasWidth: 800 }), "none");
  // Mid-canvas: still detects
  assert.equal(classifySwipe(0, 0, 100, 5, { x0: 400, canvasWidth: 800 }), "right");
});
