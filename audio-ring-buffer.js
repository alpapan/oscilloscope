// Single-producer / single-consumer Float32 ring buffer.
// Overflow drops oldest samples (writer wins). Underflow returns zeros.
// Sized in Float32 elements, not frames; the worklet calls this once per
// channel.

class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = new Float32Array(capacity);
    this.head = 0;   // next read position
    this.tail = 0;   // next write position
    this.size = 0;   // number of valid samples currently buffered
  }

  write(src) {
    const n = src.length;
    if (n >= this.capacity) {
      // Source larger than buffer: keep the last `capacity` samples.
      this.buf.set(src.subarray(n - this.capacity));
      this.head = 0;
      this.tail = 0;
      this.size = this.capacity;
      return;
    }
    // If this write would overflow, advance head to drop oldest samples.
    const overflow = this.size + n - this.capacity;
    if (overflow > 0) {
      this.head = (this.head + overflow) % this.capacity;
      this.size -= overflow;
    }
    const firstChunk = Math.min(n, this.capacity - this.tail);
    this.buf.set(src.subarray(0, firstChunk), this.tail);
    if (firstChunk < n) {
      this.buf.set(src.subarray(firstChunk), 0);
    }
    this.tail = (this.tail + n) % this.capacity;
    this.size += n;
  }

  read(dst) {
    const want = dst.length;
    const got = Math.min(want, this.size);
    const firstChunk = Math.min(got, this.capacity - this.head);
    dst.set(this.buf.subarray(this.head, this.head + firstChunk), 0);
    if (firstChunk < got) {
      dst.set(this.buf.subarray(0, got - firstChunk), firstChunk);
    }
    // Zero the unfilled tail of dst so caller doesn't see stale data.
    for (let i = got; i < want; i++) dst[i] = 0;
    this.head = (this.head + got) % this.capacity;
    this.size -= got;
    return got;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RingBuffer };
}
// Browser global: not consumed by main.js (the worklet has its own inline
// copy because AudioWorkletGlobalScope is isolated). Exposed only for ad-hoc
// debugging from DevTools.
if (typeof globalThis !== "undefined") {
  globalThis.RingBuffer = RingBuffer;
}
