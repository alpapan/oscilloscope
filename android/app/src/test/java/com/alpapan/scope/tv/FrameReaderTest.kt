package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class FrameReaderTest {
    @Test fun readsTwoFramesFromOneCoalescedChunk() {
        // Two complete frames concatenated into a single byte stream (TCP coalescing).
        val bytes = FrameCodec.encode(byteArrayOf(1, 1)) + FrameCodec.encode(byteArrayOf(2, 2))
        val r = FrameReader(ByteArrayInputStream(bytes))
        assertArrayEquals(byteArrayOf(1, 1), r.next())
        assertArrayEquals(byteArrayOf(2, 2), r.next())
        assertNull(r.next())   // EOF
    }
    @Test fun leftoverPartialFrameSurvivesCapChange() {
        // Frame B's bytes arrive split: feeding all bytes, reading A, then raising the
        // cap, must still yield B intact (no leftover loss at the boundary).
        val a = FrameCodec.encode(byteArrayOf(7))
        val b = FrameCodec.encode(ByteArray(2000) { 9 })   // > small cap, < large cap
        val r = FrameReader(ByteArrayInputStream(a + b)); r.maxFrame = 64
        assertArrayEquals(byteArrayOf(7), r.next())
        r.maxFrame = 256 * 1024
        assertArrayEquals(ByteArray(2000) { 9 }, r.next())
    }
    @Test fun oversizeFrameThrows() {
        val big = FrameCodec.encode(ByteArray(5000) { 1 })
        val r = FrameReader(ByteArrayInputStream(big)); r.maxFrame = 1024
        assertThrows(Exception::class.java) { r.next() }
    }
}
