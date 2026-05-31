// particles.js - tiny order-preserving particle field. Pure update; draw is
// the caller's job (it reads alive()). Global default, not per-palette.
// `t` is the colour-ramp parameter, fixed at spawn (gives a spread of colours
// across the field); it is intentionally not evolved during a particle's life.
function createParticleField(capacity = 128) {
  const buf = [];
  function spawn(p) {
    buf.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      life: p.life, age: 0, t: p.t == null ? 0 : p.t });
    if (buf.length > capacity) buf.shift();
  }
  function update(dt) {
    for (const p of buf) { p.x += p.vx * dt; p.y += p.vy * dt; p.age += dt; }
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].age >= buf[i].life) buf.splice(i, 1);
    }
  }
  function alive() { return buf; }
  return { spawn, update, alive, capacity };
}

if (typeof module !== "undefined" && module.exports) module.exports = { createParticleField };
if (typeof globalThis !== "undefined") globalThis.Particles = { createParticleField };
