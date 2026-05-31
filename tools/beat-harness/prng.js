// tools/beat-harness/prng.js
// Deterministic mulberry32 PRNG. Repo rules ban Math.random/Date.now; every
// stochastic harness input draws from a seeded instance of this instead.
function createPrng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { createPrng };
