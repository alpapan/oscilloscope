package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
class FrameCodecTest {
    @Test fun encode_prefixes_big_endian_length() {
        assertArrayEquals(byteArrayOf(0,0,0,3,1,2,3), FrameCodec.encode(byteArrayOf(1,2,3)))
    }
    @Test fun decoder_single_whole_frame() {
        val f = FrameDecoder().feed(FrameCodec.encode(byteArrayOf(9,8,7)))
        assertEquals(1, f.size); assertArrayEquals(byteArrayOf(9,8,7), f[0])
    }
    @Test fun decoder_reassembles_split_frame() {
        val d = FrameDecoder(); val w = FrameCodec.encode(byteArrayOf(5,6,7,8))
        assertEquals(0, d.feed(w.copyOfRange(0,2)).size)
        val f = d.feed(w.copyOfRange(2,w.size))
        assertEquals(1, f.size); assertArrayEquals(byteArrayOf(5,6,7,8), f[0])
    }
    @Test fun decoder_two_frames_one_chunk() {
        val f = FrameDecoder().feed(FrameCodec.encode(byteArrayOf(1)) + FrameCodec.encode(byteArrayOf(2,3)))
        assertEquals(2, f.size); assertArrayEquals(byteArrayOf(1), f[0]); assertArrayEquals(byteArrayOf(2,3), f[1])
    }
}
