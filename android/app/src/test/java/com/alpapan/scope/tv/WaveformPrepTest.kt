package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class WaveformPrepTest {
    @Before fun reset() { WaveformPrep.resetForTests() }

    @Test fun pcmSmooth_matchesJs2tap() {
        // JS: scratch[0]=input[0]; scratch[i] = 0.5*(input[i-1]+input[i])
        val input = floatArrayOf(0f, 2f, 4f, 6f)
        val out = WaveformPrep.pcmSmooth(input, FloatArray(4))
        assertArrayEquals(floatArrayOf(0f, 1f, 3f, 5f), out, 1e-6f)
    }
    @Test fun smoothBuf_alphaZero_returnsRawUnchanged() {
        val out = WaveformPrep.smoothBuf("a", floatArrayOf(1f, 2f, 3f), 0f)
        assertArrayEquals(floatArrayOf(1f, 2f, 3f), out, 1e-6f)
    }
    @Test fun smoothBuf_firstCallPerSlot_returnsFreshCopyAndStashes() {
        val raw = floatArrayOf(1f, 2f, 3f)
        val out = WaveformPrep.smoothBuf("L", raw, 0.5f)
        assertArrayEquals(raw, out, 1e-6f)
        // Mutating raw after the call must not affect the stashed prev.
        raw[0] = 999f
        val second = WaveformPrep.smoothBuf("L", floatArrayOf(0f, 0f, 0f), 1f)
        assertArrayEquals(floatArrayOf(1f, 2f, 3f), second, 1e-6f)
    }
    @Test fun smoothBuf_secondCall_emaCombinesPrevAndRaw() {
        WaveformPrep.smoothBuf("L", floatArrayOf(10f, 10f, 10f), 0.5f)
        val out = WaveformPrep.smoothBuf("L", floatArrayOf(0f, 2f, 4f), 0.5f)
        assertArrayEquals(floatArrayOf(5f, 6f, 7f), out, 1e-6f)
    }
    @Test fun smoothBuf_differentSlots_doNotShareState() {
        WaveformPrep.smoothBuf("L", floatArrayOf(0f), 0.5f)
        WaveformPrep.smoothBuf("R", floatArrayOf(100f), 0.5f)
        val outL = WaveformPrep.smoothBuf("L", floatArrayOf(2f), 0.5f)
        assertArrayEquals(floatArrayOf(1f), outL, 1e-6f)   // EMA of prev=0, raw=2
    }
    @Test fun findZeroCrossing_returnsIndexOfFirstNegToPos() {
        val buf = floatArrayOf(-1f, -0.5f, 0.5f, 1f, -1f, 1f)
        assertEquals(1, WaveformPrep.findZeroCrossing(buf))
    }
    @Test fun findZeroCrossing_noCrossing_returns0() {
        assertEquals(0, WaveformPrep.findZeroCrossing(floatArrayOf(0.1f, 0.2f, 0.3f)))
    }
    @Test fun findZeroCrossing_alignedBufferWithoutLaterCrossings_returns0() {
        // Documents the narrower claim about TV-side re-trigger behaviour on pre-aligned data:
        // if there are NO neg-to-pos crossings (buffer stays non-negative), returns 0 (no re-trim).
        // If there ARE later crossings (multi-cycle audio), TV will re-trim to one of them - still
        // phase-aligned, just to a different cycle. See plan Risk #1 for the broader implication.
        assertEquals(0, WaveformPrep.findZeroCrossing(floatArrayOf(0.5f, 1f, 0.8f, 0.3f, 0.5f)))
    }
}
