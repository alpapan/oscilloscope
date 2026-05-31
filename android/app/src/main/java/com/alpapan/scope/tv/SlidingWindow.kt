package com.alpapan.scope.tv

/** Ring buffer of Float samples for sliding-window analysis prep.
 *  Not thread-safe; the audio-capture thread is the sole writer. */
class SlidingWindow(private val capacity: Int) {
    private val buf = FloatArray(capacity)
    private var write = 0
    private var filled = 0

    fun push(samples: FloatArray) {
        for (i in samples.indices) {
            buf[write] = samples[i]
            write = (write + 1) % capacity
            if (filled < capacity) filled++
        }
    }

    /** Returns the last n samples in arrival order; front-pads with zeros
     *  when fewer than n have been pushed. */
    fun last(n: Int): FloatArray {
        val out = FloatArray(n)
        val avail = minOf(filled, n)
        val pad = n - avail
        var src = (write - avail + capacity) % capacity
        for (i in 0 until avail) {
            out[pad + i] = buf[src]
            src = (src + 1) % capacity
        }
        return out
    }
}
