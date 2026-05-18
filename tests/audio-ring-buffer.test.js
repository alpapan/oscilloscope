const test = require("node:test");
const assert = require("node:assert/strict");
const { RingBuffer } = require("../audio-ring-buffer.js");

test("write then read returns identical samples", () => {
  const rb = new RingBuffer(16);
  const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  rb.write(input);
  const out = new Float32Array(4);
  const got = rb.read(out);
  assert.equal(got, 4);
  // Compare in Float32 space (JS literals are Float64; round-trip through
  // Float32Array loses precision, so we round the expected the same way).
  assert.deepEqual(out, new Float32Array([0.1, 0.2, 0.3, 0.4]));
});

test("read with no data returns zero and leaves output untouched-as-zeros", () => {
  const rb = new RingBuffer(16);
  const out = new Float32Array(4).fill(99);
  const got = rb.read(out);
  assert.equal(got, 0);
  assert.deepEqual(Array.from(out), [0, 0, 0, 0]);
});

test("write across wrap boundary, read returns contiguous samples", () => {
  const rb = new RingBuffer(8);
  rb.write(new Float32Array([1, 2, 3, 4, 5, 6]));
  const tmp = new Float32Array(4);
  rb.read(tmp);
  assert.deepEqual(Array.from(tmp), [1, 2, 3, 4]);
  rb.write(new Float32Array([7, 8, 9, 10]));
  const out = new Float32Array(6);
  const got = rb.read(out);
  assert.equal(got, 6);
  assert.deepEqual(Array.from(out), [5, 6, 7, 8, 9, 10]);
});

test("overflow drops oldest data, write succeeds, read returns most recent", () => {
  const rb = new RingBuffer(4);
  rb.write(new Float32Array([1, 2, 3, 4]));
  rb.write(new Float32Array([5, 6]));
  const out = new Float32Array(4);
  const got = rb.read(out);
  assert.equal(got, 4);
  assert.deepEqual(Array.from(out), [3, 4, 5, 6]);
});

test("partial read drains exactly N samples", () => {
  const rb = new RingBuffer(16);
  rb.write(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]));
  const a = new Float32Array(3);
  const b = new Float32Array(3);
  const c = new Float32Array(3);
  const ga = rb.read(a);
  const gb = rb.read(b);
  const gc = rb.read(c);
  assert.equal(ga, 3);
  assert.equal(gb, 3);
  assert.equal(gc, 2);
  assert.deepEqual(Array.from(a), [1, 2, 3]);
  assert.deepEqual(Array.from(b), [4, 5, 6]);
  assert.deepEqual(Array.from(c.subarray(0, 2)), [7, 8]);
  assert.equal(c[2], 0);
});
