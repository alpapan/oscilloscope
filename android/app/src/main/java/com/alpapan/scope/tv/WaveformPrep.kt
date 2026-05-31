package com.alpapan.scope.tv

/** Phone-side visualisation prep. Slot-managed EMA matches the JS
 *  semantics at main.js:1231 (smoothBuf("L", raw, alpha)) directly:
 *  caller passes a slot key; module owns the prev buffer per slot. */
object WaveformPrep {
    private val emaSlots = HashMap<String, FloatArray>()

    /** Port of pcmSmooth in audio-features.js:14 (2-tap, mutates scratch). */
    fun pcmSmooth(input: FloatArray, scratch: FloatArray): FloatArray {
        val n = input.size
        if (n == 0) return scratch
        scratch[0] = input[0]
        for (i in 1 until n) scratch[i] = 0.5f * (input[i - 1] + input[i])
        return scratch
    }

    /** Port of smoothBuf in main.js:1231. alpha <= 0 -> raw unchanged.
     *  First call per slot: fresh copy of raw is stashed as prev and returned.
     *  Subsequent calls: prev mutated in place per EMA, returned. */
    fun smoothBuf(slot: String, raw: FloatArray, alpha: Float): FloatArray {
        if (alpha <= 0f) return raw
        val prev = emaSlots[slot]
        if (prev == null || prev.size != raw.size) {
            val fresh = raw.copyOf()
            emaSlots[slot] = fresh
            return fresh
        }
        for (i in raw.indices) prev[i] = prev[i] * alpha + raw[i] * (1f - alpha)
        return prev
    }

    /** Port of findZeroCrossing in main.js:37. First negative-to-positive
     *  crossing; 0 if none. */
    fun findZeroCrossing(buf: FloatArray): Int {
        for (i in 0 until buf.size - 1) {
            if (buf[i] < 0f && buf[i + 1] >= 0f) return i
        }
        return 0
    }

    /** Test hook to reset slot state between tests. */
    fun resetForTests() { emaSlots.clear() }
}
