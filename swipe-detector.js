// Pure classifier called from touchend handlers.
// Returns "left" | "right" | "none".
//
// dx, dy are touchend-minus-touchstart deltas in CSS pixels.
// opts.x0 = touchstart X coordinate within the canvas, opts.canvasWidth = canvas width.
//
// Edge-zone semantics: when opts is supplied, swipes that *started* within
// EDGE_DEAD_ZONE_PX of either edge are classified as "none" so Android's
// back-gesture wins on the system side. The check is against the START
// position (x0), not the end position, because a swipe originating at the
// screen edge is typically an accidental back-gesture rather than a deliberate
// view-cycle gesture. Do not invert this to check end-position; that would
// fight the system gesture.

const MIN_DISTANCE_PX = 40;
const HORIZONTAL_RATIO = 1.5;
// Android's system back-gesture zone is typically ~16-24dp from each edge
// (24-72 CSS pixels on common DPRs). 32 CSS px puts our deadzone safely
// outside the system zone on most phones so the system gesture wins
// uncontested and our cycle/drawer swipe does not double-fire.
const EDGE_DEAD_ZONE_PX = 32;

function classifySwipe(_x, _y, dx, dy, opts) {
  if (opts && typeof opts.x0 === "number" && typeof opts.canvasWidth === "number") {
    if (opts.x0 < EDGE_DEAD_ZONE_PX) return "none";
    if (opts.x0 > opts.canvasWidth - EDGE_DEAD_ZONE_PX) return "none";
  }
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < MIN_DISTANCE_PX) return "none";
  if (absX < absY * HORIZONTAL_RATIO) return "none";
  return dx > 0 ? "right" : "left";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { classifySwipe };
}
if (typeof globalThis !== "undefined") {
  globalThis.classifySwipe = classifySwipe;
}
