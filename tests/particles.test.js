const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createParticleField } = require("../particles.js");

test("spawn then update advances position by velocity*dt", () => {
  const f = createParticleField(10);
  f.spawn({ x: 0, y: 0, vx: 100, vy: -50, life: 1, t: 0.5 });
  f.update(0.1);
  const p = f.alive()[0];
  assert.ok(Math.abs(p.x - 10) < 1e-6 && Math.abs(p.y + 5) < 1e-6, `${p.x},${p.y}`);
});

test("particle is culled after its lifetime elapses", () => {
  const f = createParticleField(10);
  f.spawn({ x: 0, y: 0, vx: 0, vy: 0, life: 0.2, t: 0 });
  f.update(0.1); assert.strictEqual(f.alive().length, 1);
  f.update(0.2); assert.strictEqual(f.alive().length, 0);
});

test("field respects capacity, dropping the oldest (insertion order kept)", () => {
  const f = createParticleField(2);
  f.spawn({ x: 1, y: 0, vx: 0, vy: 0, life: 9, t: 0 });
  f.spawn({ x: 2, y: 0, vx: 0, vy: 0, life: 9, t: 0 });
  f.spawn({ x: 3, y: 0, vx: 0, vy: 0, life: 9, t: 0 });
  assert.strictEqual(f.alive().length, 2);
  assert.strictEqual(f.alive()[0].x, 2, "oldest (x=1) dropped");
  assert.strictEqual(f.alive()[1].x, 3, "newest kept");
});
