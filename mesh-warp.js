// Global mesh-warp lite - per-frame scale + rotation applied to the trail
// sprite. Adapted from projectM's MotionVectors (no per-vertex grid; one
// global affine transform per frame).
//
// rotation oscillates around 0; scale returns to 1 when bassAtt = 0. Both
// are bounded, so the trail never drifts off canvas over long sessions.

const MESH_SCALE_AMP = 0.003;        // scale = 1 + amp * bassAtt; bassAtt typically in [0, 1.x]
const MESH_ROT_AMP   = 0.0008;       // rotation = amp * sin(time*freq) * (1 + 2*bassAtt)
const MESH_ROT_FREQ  = 0.5;          // rad/s; period 2π/0.5 ≈ 12.6 s - slow & organic

function meshTransform(bassAtt, time) {
  const scale = 1 + MESH_SCALE_AMP * bassAtt;
  const rotation = MESH_ROT_AMP * Math.sin(time * MESH_ROT_FREQ) * (1 + 2 * bassAtt);
  return { scale, rotation };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    meshTransform,
    MESH_SCALE_AMP,
    MESH_ROT_AMP,
    MESH_ROT_FREQ,
  };
}
if (typeof globalThis !== "undefined") {
  globalThis.MeshWarp = {
    meshTransform,
    MESH_SCALE_AMP,
    MESH_ROT_AMP,
    MESH_ROT_FREQ,
  };
}
