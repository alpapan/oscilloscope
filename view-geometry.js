// view-geometry.js - pure geometry for the themed views. No PixiJS, no DOM.

// Cosmos: wrap a waveform around a ring. Radius at angle i is
// (baseR + wave*amp)*scale. Returns a closed loop ([0]===[last]).
function ringDeform(wave, { cx, cy, baseR, amp, scale, nPoints }) {
  const pts = new Array(nPoints + 1);
  const len = wave.length;
  for (let i = 0; i < nPoints; i++) {
    const a = (i / nPoints) * Math.PI * 2;
    const s = len ? wave[Math.floor((i / nPoints) * len)] : 0;
    const r = (baseR + s * amp) * scale;
    pts[i] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }
  pts[nPoints] = pts[0];
  return pts;
}

// Firebird: build a right wing from the stereo pair and mirror it for the
// left. x spreads with (L-R), y rises with (L+R). Returns {left,right} point
// arrays of equal length; left is right reflected across the vertical at cx.
function wingFromLissajous(Lch, Rch, { cx, cy, scale }) {
  const n = Math.min(Lch.length, Rch.length);
  const right = new Array(n), left = new Array(n);
  for (let i = 0; i < n; i++) {
    const dx = (Lch[i] - Rch[i]) * scale;
    const dy = -(Lch[i] + Rch[i]) * scale;
    right[i] = [cx + Math.abs(dx), cy + dy];
    left[i] = [cx - Math.abs(dx), cy + dy];
  }
  return { left, right };
}

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

if (typeof module !== "undefined" && module.exports) module.exports = { ringDeform, wingFromLissajous, canopyEdge };
if (typeof globalThis !== "undefined") globalThis.ViewGeometry = { ringDeform, wingFromLissajous, canopyEdge };
