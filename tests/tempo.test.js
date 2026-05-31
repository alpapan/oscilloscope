const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTempoTracker, bpmToHueDeg } = require("../audio-features.js");

test("createTempoTracker converges to 120 BPM for 500ms beats", () => {
  const t = createTempoTracker();
  let now = 0;
  for (let i = 0; i < 20; i++) { t.beat(now); now += 500; }
  assert.ok(Math.abs(t.avgBpm() - 120) < 2, `got ${t.avgBpm()}`);
});

test("createTempoTracker clamps to [40, 200]", () => {
  const fast = createTempoTracker(); let n = 0;
  for (let i = 0; i < 10; i++) { fast.beat(n); n += 100; }
  assert.strictEqual(fast.avgBpm(), 200);
  const slow = createTempoTracker(); n = 0;
  for (let i = 0; i < 5; i++) { slow.beat(n); n += 5000; }
  assert.strictEqual(slow.avgBpm(), 40);
});

test("bpmToHueDeg maps 40->0, 200->360, monotonic, stateless", () => {
  assert.strictEqual(bpmToHueDeg(40), 0);
  assert.strictEqual(bpmToHueDeg(200), 360);
  assert.ok(bpmToHueDeg(120) > bpmToHueDeg(80));
  assert.strictEqual(bpmToHueDeg(120), bpmToHueDeg(120));
});
