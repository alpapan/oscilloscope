const test = require('node:test');
const assert = require('node:assert/strict');
const { swipeAction, stepSensitivity } = require('../main.js');

test('non-mic: left = next, right = prev', () => {
  assert.equal(swipeAction('left', false), 'next');
  assert.equal(swipeAction('right', false), 'prev');
});
test('mic: left = sensitivity down, right = sensitivity up', () => {
  assert.equal(swipeAction('left', true), 'sens-down');
  assert.equal(swipeAction('right', true), 'sens-up');
});
test('non-horizontal returns none', () => {
  assert.equal(swipeAction('up', false), 'none');
  assert.equal(swipeAction('down', true), 'none');
});
test('stepSensitivity clamps to [0.1, 2] and steps 0.1', () => {
  assert.equal(stepSensitivity(1.0, +1), 1.1);
  assert.equal(stepSensitivity(1.0, -1), 0.9);
  assert.equal(stepSensitivity(2.0, +1), 2.0);     // clamp high
  assert.equal(stepSensitivity(0.1, -1), 0.1);     // clamp low
});
