package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
class DspTest {
    @Test fun downsample_preserves_endpoints_and_count() {
        val src = FloatArray(1024){ it.toFloat() }
        val ds = Dsp.downsample(src, 256)
        assertEquals(256, ds.size); assertEquals(0f, ds[0], 1e-3f)
    }
    // v2 review S4: the last output point must map to the source's last sample.
    @Test fun downsample_preserves_last_endpoint() {
        val src = FloatArray(1024){ it.toFloat() }
        val ds = Dsp.downsample(src, 256)
        assertEquals((src.size - 1).toFloat(), ds[ds.size - 1], 1e-3f)
    }
}
