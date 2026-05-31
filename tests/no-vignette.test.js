// Asserts that the visualisation has no vignette (circular corner-fade)
// on any theme. User explicitly removed the effect on 2026-05-31.
// pixi-filters CRTFilter takes a `vignetting` option (0 = no vignette,
// >0 = vignette intensity); this test guards against the value drifting
// back above 0 in any future edit to main.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = path.join(__dirname, '..', 'main.js');

test('CRTFilter is constructed without vignetting (or with vignetting: 0)', () => {
  const src = fs.readFileSync(MAIN, 'utf8');
  // Find each CRTFilter constructor call and inspect its options literal.
  const re = /new\s+PIXI\.filters\.CRTFilter\s*\(\s*\{([^}]*)\}\s*\)/g;
  let m, found = 0;
  while ((m = re.exec(src)) !== null) {
    found++;
    const opts = m[1];
    const vMatch = opts.match(/vignetting\s*:\s*([0-9.]+)/);
    if (vMatch) {
      const v = parseFloat(vMatch[1]);
      assert.equal(v, 0,
        `CRTFilter at offset ${m.index} has vignetting=${v}; ` +
        `should be 0 or omitted`);
    }
  }
  assert.ok(found > 0, 'expected at least one CRTFilter constructor in main.js');
});
