const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

test('drawer is a top sheet (slides down), not a side panel', () => {
  // The #mobile-drawer rule block must hide above the viewport and reveal at translateY(0).
  const block = css.slice(css.indexOf('#mobile-drawer {'));
  assert.match(block, /transform:\s*translateY\(-100%\)/);
  assert.match(css, /body\.drawer-open #mobile-drawer\s*\{[^}]*transform:\s*translateY\(0\)/);
});
test('drawer no longer slides from the side', () => {
  const block = css.slice(css.indexOf('#mobile-drawer {'), css.indexOf('#mobile-drawer section'));
  assert.doesNotMatch(block, /translateX/);
});
