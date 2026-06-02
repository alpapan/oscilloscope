const test = require('node:test');
const assert = require('node:assert/strict');
const { tvBackAction } = require('../main.js');

test('TV + paired -> disconnect', () => { assert.equal(tvBackAction(true, true), 'disconnect'); });
test('TV + not paired -> default', () => { assert.equal(tvBackAction(true, false), 'default'); });
test('phone (not TV) -> default regardless', () => {
  assert.equal(tvBackAction(false, true), 'default');
  assert.equal(tvBackAction(false, false), 'default');
});
