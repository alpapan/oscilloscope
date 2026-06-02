package com.alpapan.scope.tv
import com.alpapan.scope.RenderSpecClamp
import org.junit.Assert.*
import org.junit.Test

class RenderSpecClampTest {
    @Test fun clampFftSize_underMin_returnsMin() {
        // floor at 64 prevents degenerate buffers (e.g., 0, 1).
        assertEquals(64, RenderSpecClamp.clampFftSize(0))
        assertEquals(64, RenderSpecClamp.clampFftSize(32))
        assertEquals(64, RenderSpecClamp.clampFftSize(64))
    }
    @Test fun clampFftSize_inRange_returnsAsIs() {
        assertEquals(512, RenderSpecClamp.clampFftSize(512))
        assertEquals(2048, RenderSpecClamp.clampFftSize(2048))
        assertEquals(16384, RenderSpecClamp.clampFftSize(16384))
    }
    @Test fun clampFftSize_overMax_returnsMax() {
        assertEquals(16384, RenderSpecClamp.clampFftSize(16385))
        assertEquals(16384, RenderSpecClamp.clampFftSize(32768))
        assertEquals(16384, RenderSpecClamp.clampFftSize(99999))
    }
    @Test fun clampViewToKnownRange() {
        assertEquals(0, RenderSpecClamp.clampView(-3))
        assertEquals(11, RenderSpecClamp.clampView(999))
        assertEquals(5, RenderSpecClamp.clampView(5))
    }
    @Test fun clampWaveformPoints() {
        assertEquals(16, RenderSpecClamp.clampWaveformPoints(1))
        assertEquals(16384, RenderSpecClamp.clampWaveformPoints(Int.MAX_VALUE))
    }
    @Test fun clampFftBins() {
        assertEquals(16, RenderSpecClamp.clampFftBins(0))
        assertEquals(16384, RenderSpecClamp.clampFftBins(Int.MAX_VALUE))
    }
    @Test fun clampChannels() {
        assertEquals(1, RenderSpecClamp.clampChannels(0))
        assertEquals(2, RenderSpecClamp.clampChannels(9))
    }
}
