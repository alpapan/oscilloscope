// view-geometry.js - pure geometry for the themed views. No PixiJS, no DOM.

// Grove: the canopy's lower edge traces the waveform around baseY; the
// polygon then closes up to the top corners so foliage fills above the edge.
function canopyEdge(wave, { w, h, baseY, amp }) {
  const n = wave.length;
  const poly = [];
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? (i / (n - 1)) * w : 0;
    poly.push([x, baseY - wave[i] * amp]);
  }
  poly.push([w, 0]);
  poly.push([0, 0]);
  return poly;
}

if (typeof module !== "undefined" && module.exports) module.exports = { canopyEdge };
if (typeof globalThis !== "undefined") globalThis.ViewGeometry = { canopyEdge };
