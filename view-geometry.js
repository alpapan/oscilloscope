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

// Milkdrop SmoothWave 4-tap (c1..c4) over an array of [x,y] points.
function smoothWave4(pts) {
  const c1 = -0.15, c2 = 1.15, c3 = 1.15, c4 = -0.15, inv = 1 / (c1 + c2 + c3 + c4);
  const n = pts.length;
  if (n < 4) return pts.slice();
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i],
          c = pts[Math.min(n - 1, i + 1)], d = pts[Math.min(n - 1, i + 2)];
    out[i] = [
      (c1*a[0] + c2*b[0] + c3*c[0] + c4*d[0]) * inv,
      (c1*a[1] + c2*b[1] + c3*c[1] + c4*d[1]) * inv,
    ];
  }
  return out;
}

// Spiral - projectM XYOscillationSpiral (closed loop).
// `spin` tempo-scales the rotation (app-specific improvement; projectM uses a constant 2.3).
function spiral(L, R, { w, h, time = 0, bpm = 120, bassAtt = 0, samples = 256 } = {}) {
  const cx = w/2, cy = h/2, Rs = Math.min(w, h) * 0.40;
  const maxSafe = Math.max(1, L.length - 32);
  const N = Math.min(samples, maxSafe);
  const mystery = Math.max(0, Math.min(1, bassAtt - 1)) * 0.3;
  const spin = 2.3 * (bpm / 120);
  const pts = new Array(N + 1);
  for (let i = 0; i < N; i++) {
    const radius = 0.53 + 0.43 * R[i] + mystery;
    const angle = L[i + 32] * 1.57 + time * spin;
    pts[i] = [cx + radius * Math.cos(angle) * Rs, cy - radius * Math.sin(angle) * Rs];
  }
  pts[N] = pts[0];
  return smoothWave4(pts);
}

// Bloom - projectM Milkdrop2077WaveFlower (loop).
// projectM's `+ m_waveX*cos(PI)` centre-offset terms are omitted: this app centres
// in screen space (cx +/- coord*Rs), so adding them would double-offset.
function bloom(L, R, { w, h, time = 0, bassAtt = 0, samples } = {}) {
  const cx = w/2, cy = h/2, Rs = Math.min(w, h) * 0.42;
  const maxSafe = Math.max(1, L.length - 1);
  const total = Math.min(samples || 1024, maxSafe);
  const N = (total / 2) | 0, off = ((total - N) / 2) | 0;
  const mystery = Math.max(0, Math.min(1, bassAtt - 1)) * 0.2;
  const invN1 = 1 / (N - 1), tenth = N * 0.1;
  const pts = new Array(N);
  for (let s = 0; s < N; s++) {
    let radius = 0.7 + 0.7 * R[Math.min(L.length - 1, s + off)] + mystery;
    const angle = s * invN1 * 6.28 + time * 0.2;
    if (s < N / radius) {
      let mix = s / tenth; mix = 0.7 - 0.7 * Math.cos(mix * Math.PI);
      const radius2 = 0.7 + 0.7 * R[Math.min(L.length - 1, s + N - off)] + mystery;
      radius = radius2 * (1 - mix) + radius * mix * 0.25;
    }
    const x = radius * Math.cos(angle * Math.PI) / 1.5;
    const y = radius * Math.sin(angle - time / 3) / 1.5;
    pts[s] = [cx + x * Rs, cy - y * Rs];
  }
  return smoothWave4(pts);
}

// Starburst - projectM Milkdrop2077WaveStar (loop). Centre-offset omitted (see bloom).
function starburst(L, R, { w, h, time = 0, bassAtt = 0, samples } = {}) {
  const cx = w/2, cy = h/2, Rs = Math.min(w, h) * 0.44;
  const maxSafe = Math.max(1, L.length - 1);
  const total = Math.min(samples || 1024, maxSafe);
  const N = (total / 2) | 0, off = ((total - N) / 2) | 0;
  const mystery = Math.max(0, Math.min(1, bassAtt - 1)) * 0.2;
  const invN1 = 1 / (N - 1), tenth = N * 0.1;
  const pts = new Array(N);
  for (let s = 0; s < N; s++) {
    let radius = 0.7 + 0.4 * R[Math.min(L.length - 1, s + off)] + mystery;
    const angle = s * invN1 * 6.28 + time * 0.2;
    if (s < N / radius) {
      let mix = s / tenth; mix = 0.5 - 0.5 * Math.cos(mix * Math.PI);
      const radius2 = 0.5 + 0.4 * R[Math.min(L.length - 1, s + N - off)] + mystery;
      radius = radius2 * (1 - mix) + radius * mix;
    }
    pts[s] = [cx + radius * Math.cos(angle) * Rs, cy - radius * Math.sin(angle) * Rs];
  }
  return smoothWave4(pts);
}

// Lasso - projectM Milkdrop2077WaveLasso. `angle` guarded from 0 and output clamped
// to tame the tan(time/angle) singularity (projectM is unguarded).
function lasso(L, R, { w, h, time = 0, samples } = {}) {
  const cx = w/2, cy = h/2, Rs = Math.min(w, h) * 0.42;
  const maxSafe = Math.max(1, L.length - 32);
  const N = Math.min(samples || 1024, maxSafe);
  const pts = new Array(N);
  for (let s = 0; s < N; s++) {
    let angle = L[s + 32] * 1.57 + time * 2.0;
    if (Math.abs(angle) < 1e-3) angle = 1e-3;
    let x = Math.cos(time) / 2 + Math.cos(angle * 2 + Math.tan(time / angle));
    let y = Math.sin(time) * 2 * Math.sin(angle * 3.14) / 2.8;
    x = Math.max(-1.3, Math.min(1.3, x));
    y = Math.max(-1.3, Math.min(1.3, y));
    pts[s] = [cx + x * Rs, cy - y * Rs];
  }
  return smoothWave4(pts);
}

// Nova - projectM ExplosiveHash (rotating product cloud). Not smoothed: the scatter is the point.
function nova(L, R, { w, h, time = 0, rms = 0, samples } = {}) {
  const cx = w/2, cy = h/2, Rs = Math.min(w, h) * 0.42;
  const maxSafe = Math.max(1, L.length - 32);
  const N = Math.min(samples || 1024, maxSafe);
  const c = Math.cos(time * 0.3), s = Math.sin(time * 0.3);
  const gain = 2.2 * (0.6 + Math.max(0, Math.min(1.5, rms)));
  const pts = new Array(N);
  for (let i = 0; i < N; i++) {
    const x0 = R[i] * L[i + 32] + L[i] * R[i + 32];
    const y0 = R[i] * R[i] - L[i + 32] * L[i + 32];
    const x = (x0 * c - y0 * s) * gain;
    const y = (x0 * s + y0 * c) * gain;
    pts[i] = [cx + x * Rs, cy - y * Rs];
  }
  return pts;
}

if (typeof module !== "undefined" && module.exports) module.exports = { canopyEdge, smoothWave4, spiral, bloom, starburst, lasso, nova };
if (typeof globalThis !== "undefined") globalThis.ViewGeometry = { canopyEdge, smoothWave4, spiral, bloom, starburst, lasso, nova };
