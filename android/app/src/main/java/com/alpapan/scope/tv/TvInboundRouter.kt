package com.alpapan.scope.tv

// Pure dispatch of a decrypted TV-inbound frame [typeByte ++ data], mirroring
// ControlRouter. Guards the empty frame (a zero-length payload must not index [0]).
sealed class TvInbound {
    data class RenderRequest(val json: String) : TvInbound()
    data class AnalysisFrame(val frame: ByteArray) : TvInbound()
    object Drop : TvInbound()
}
object TvInboundRouter {
    fun route(frame: ByteArray): TvInbound {
        if (frame.isEmpty()) return TvInbound.Drop
        return when (frame[0].toInt()) {
            0 -> TvInbound.RenderRequest(String(frame.copyOfRange(1, frame.size), Charsets.UTF_8))
            1 -> TvInbound.AnalysisFrame(frame)
            else -> TvInbound.Drop
        }
    }
}
