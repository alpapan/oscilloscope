package com.alpapan.scope.tv
import java.io.InputStream

// Stateful frame reader owning ONE byte buffer for the whole connection, with a
// mutable size cap. Parses exactly ONE frame per next() call and checks the cap
// at parse time, so leftover bytes buffered under a small (handshake) cap survive
// a later cap increase with zero loss at the handshake -> steady-state boundary
// (reviewer C2/C4). The declared length is checked against the cap BEFORE the
// body is buffered, so an oversize claim is rejected without allocating it.
class FrameReader(private val input: InputStream, initialMaxFrame: Int = 256 * 1024) {
    var maxFrame: Int = initialMaxFrame
    private var buffer = ByteArray(0)            // unparsed leftover bytes
    private val readBuf = ByteArray(16 * 1024)
    /** Next complete frame payload, or null on EOF / IO error. Throws on oversize. */
    fun next(): ByteArray? {
        while (true) {
            if (buffer.size >= 4) {
                val len = ((buffer[0].toInt() and 0xFF) shl 24) or ((buffer[1].toInt() and 0xFF) shl 16) or
                          ((buffer[2].toInt() and 0xFF) shl 8) or (buffer[3].toInt() and 0xFF)
                if (len < 0 || len > maxFrame) throw IllegalStateException("bad frame length $len")
                if (buffer.size - 4 >= len) {
                    val frame = buffer.copyOfRange(4, 4 + len)
                    buffer = buffer.copyOfRange(4 + len, buffer.size)
                    return frame
                }
            }
            val n = try { input.read(readBuf) } catch (_: Throwable) { return null }
            if (n < 0) return null
            buffer += readBuf.copyOfRange(0, n)
        }
    }
}
