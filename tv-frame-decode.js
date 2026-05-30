function decodeAnalysisFrame(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const view = dv.getUint8(1), flags = dv.getUint8(2);
  const n = (dv.getUint8(3) << 8) | dv.getUint8(4);
  const m = (dv.getUint8(5) << 8) | dv.getUint8(6);
  let off = 7, res = { view };
  const stereo = (flags & 4) !== 0;
  if (flags & 1) {
    const L = new Float32Array(n), R = stereo ? new Float32Array(n) : null;
    for (let i = 0; i < n; i++) {
      L[i] = dv.getInt16(off, true) / 32767; off += 2;
      if (stereo) { R[i] = dv.getInt16(off, true) / 32767; off += 2; }
    }
    res.waveform = L; if (stereo) res.waveformR = R;
  }
  if (flags & 2) {
    const fft = new Float32Array(m);
    for (let i = 0; i < m; i++) { fft[i] = (dv.getUint8(off) / 2.55) - 100; off += 1; } // back to dB
    res.fft = fft;
  }
  return res;
}
// Dual-export: CommonJS for node tests, window global for the Capacitor WebView.
if (typeof module !== "undefined" && module.exports) module.exports = { decodeAnalysisFrame };
if (typeof window !== "undefined") window.decodeAnalysisFrame = decodeAnalysisFrame;
