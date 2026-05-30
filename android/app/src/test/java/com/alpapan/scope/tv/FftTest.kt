package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*
class FftTest {
    @Test fun dc_signal_energy_in_bin0() {
        val n = 64; val re = FloatArray(n){1f}; val mag = Fft.magnitudes(re)
        assertEquals(n/2, mag.size)
        assertTrue(mag[0] > mag[1] * 10)  // all energy at DC
    }
    @Test fun sinusoid_peaks_at_its_bin() {
        val n = 64; val k = 8; val re = FloatArray(n){ sin(2.0*PI*k*it/n).toFloat() }
        val mag = Fft.magnitudes(re); val peak = mag.indices.maxByOrNull { mag[it] }
        assertEquals(k, peak)
    }
}
