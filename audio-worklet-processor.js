// Runs in the AudioWorkletGlobalScope. The class is registered with the
// audio rendering thread by main.js calling `audioContext.audioWorklet.addModule`.
//
// Main thread posts { left: Float32Array, right: Float32Array } chunks via the
// node's MessagePort. We push them into per-channel ring buffers, then drain
// 128 frames per process() call into the output channels.

// Inline copy of audio-ring-buffer.js because the worklet global scope cannot
// import (Chrome does support module worklets, but the simplest cross-version
// pattern is a single-file processor). If we ever upgrade Capacitor's WebView
// minimum to one supporting AudioWorklet modules cleanly, we can switch to
// addModule with a real ESM import.

class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = new Float32Array(capacity);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }
  write(src) {
    const n = src.length;
    if (n >= this.capacity) {
      this.buf.set(src.subarray(n - this.capacity));
      this.head = 0;
      this.tail = 0;
      this.size = this.capacity;
      return;
    }
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
    for (let i = got; i < want; i++) dst[i] = 0;
    this.head = (this.head + got) % this.capacity;
    this.size -= got;
    return got;
  }
}

class ScopeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 8192 frames per channel = ~170 ms at 48 kHz.
    // Bigger than the largest practical bridge jitter, smaller than enough
    // memory pressure to notice.
    this.left = new RingBuffer(8192);
    this.right = new RingBuffer(8192);
    this.port.onmessage = (e) => {
      if (e.data && e.data.left && e.data.right) {
        this.left.write(e.data.left);
        this.right.write(e.data.right);
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (out.length > 0) this.left.read(out[0]);
    if (out.length > 1) this.right.read(out[1]);
    return true;
  }
}

registerProcessor("scope-processor", ScopeProcessor);
