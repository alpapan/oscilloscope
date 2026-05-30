package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
class AnalysisFrameCodecTest {
    @Test fun encodes_waveform_header_and_int16() {
        // view=0, mono, N=2 points [1.0, -1.0] -> int16 32767, -32767
        val out = AnalysisFrameCodec.encodeWaveform(view=0, mono=floatArrayOf(1f,-1f), right=null)
        // [msgType=1][view=0][flags=0b001=1][N hi=0,lo=2][M hi=0,lo=0][32767 LE=FF,7F][-32767 LE=01,80]
        assertArrayEquals(
            byteArrayOf(1, 0, 1, 0, 2, 0, 0, 0xFF.toByte(), 0x7F, 0x01, 0x80.toByte()),
            out)
    }
    @Test fun encodes_spectrum_header_and_db_bytes() {
        // view=1, FFT-only, M=3 bins [-100,-50,0] dB -> bytes [0, 128, 255]
        // (round((db+100)*2.55): -100->0, -50->127.5->128, 0->255)
        val out = AnalysisFrameCodec.encodeSpectrum(view=1, magsDb=floatArrayOf(-100f, -50f, 0f))
        // [msgType=1][view=1][flags=0b010=2][N hi=0,lo=0][M hi=0,lo=3][0][128][255]
        assertArrayEquals(
            byteArrayOf(1, 1, 2, 0, 0, 0, 3, 0, 0x80.toByte(), 0xFF.toByte()),
            out)
    }
}
