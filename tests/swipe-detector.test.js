const test = require('node:test');
const assert = require('node:assert/strict');
const { classifySwipe } = require('../swipe-detector.js');
const FULL = { x0: 200, y0: 400, canvasWidth: 1000, canvasHeight: 2000 };

test('downward swipe from mid-screen is "down"', () => {
  assert.equal(classifySwipe(0, 0, 5, 120, FULL), 'down');
});
test('upward swipe from mid-screen is "up"', () => {
  assert.equal(classifySwipe(0, 0, -5, -120, FULL), 'up');
});
test('vertical swipe starting at the top edge is rejected (notification shade)', () => {
  assert.equal(classifySwipe(0, 0, 0, 120, { x0: 200, y0: 10, canvasWidth: 1000, canvasHeight: 2000 }), 'none');
});
test('vertical swipe starting at the bottom edge is rejected (nav gesture)', () => {
  assert.equal(classifySwipe(0, 0, 0, -120, { x0: 200, y0: 1990, canvasWidth: 1000, canvasHeight: 2000 }), 'none');
});
test('horizontal left/right still work (regression)', () => {
  assert.equal(classifySwipe(0, 0, 120, 5, FULL), 'right');
  assert.equal(classifySwipe(0, 0, -120, 5, FULL), 'left');
});
test('horizontal swipe at side edge still rejected (regression)', () => {
  assert.equal(classifySwipe(0, 0, 120, 5, { x0: 10, y0: 400, canvasWidth: 1000, canvasHeight: 2000 }), 'none');
});

// Threshold + dominance guards, mirrored on both axes.
test('tiny horizontal motion (under MIN_DISTANCE) returns "none"', () => {
  assert.equal(classifySwipe(0, 0, 20, 5), 'none');
});
test('tiny vertical motion (under MIN_DISTANCE) returns "none"', () => {
  assert.equal(classifySwipe(0, 0, 5, 20, FULL), 'none');
});
test('horizontal not 1.5x dominant returns "none"', () => {
  assert.equal(classifySwipe(0, 0, 60, 50), 'none');   // ratio 1.2 < 1.5
});
test('vertical not 1.5x dominant returns "none"', () => {
  assert.equal(classifySwipe(0, 0, 50, 60, FULL), 'none');   // ratio 1.2 < 1.5
});
