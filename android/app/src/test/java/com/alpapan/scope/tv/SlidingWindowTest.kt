package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test

class SlidingWindowTest {
    private fun arr(vararg v: Float) = v

    @Test fun push_thenLast_returnsMostRecentN_inOrder() {
        val w = SlidingWindow(8); w.push(arr(1f, 2f, 3f))
        assertArrayEquals(arr(2f, 3f), w.last(2), 0f)
    }
    @Test fun last_underfilled_frontPadsWithZeros() {
        val w = SlidingWindow(8); w.push(arr(1f, 2f, 3f))
        assertArrayEquals(arr(0f, 0f, 1f, 2f, 3f), w.last(5), 0f)
    }
    @Test fun push_acrossWraparound_returnsCorrectOrderedSlice() {
        val w = SlidingWindow(4); w.push(arr(1f, 2f, 3f)); w.push(arr(4f, 5f, 6f))
        assertArrayEquals(arr(3f, 4f, 5f, 6f), w.last(4), 0f)
        assertArrayEquals(arr(5f, 6f), w.last(2), 0f)
    }
    @Test fun last_returnsExactlyNSamples_evenWhenUnderfilled() {
        val w = SlidingWindow(16); w.push(FloatArray(10) { it.toFloat() })
        assertEquals(2048, w.last(2048).size)
    }
}
