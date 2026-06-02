package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test

class TvInboundRouterTest {
    @Test fun emptyFrameDropped() { assertTrue(TvInboundRouter.route(ByteArray(0)) is TvInbound.Drop) }
    @Test fun type0IsRenderRequest() {
        val f = byteArrayOf(0) + "{\"type\":\"render-request\"}".toByteArray()
        val a = TvInboundRouter.route(f)
        assertTrue(a is TvInbound.RenderRequest); assertEquals("{\"type\":\"render-request\"}", (a as TvInbound.RenderRequest).json)
    }
    @Test fun type1IsAnalysisFrame() {
        val f = byteArrayOf(1, 2, 3); val a = TvInboundRouter.route(f)
        assertTrue(a is TvInbound.AnalysisFrame); assertArrayEquals(f, (a as TvInbound.AnalysisFrame).frame)
    }
    @Test fun unknownTypeDropped() { assertTrue(TvInboundRouter.route(byteArrayOf(9, 9)) is TvInbound.Drop) }
}
