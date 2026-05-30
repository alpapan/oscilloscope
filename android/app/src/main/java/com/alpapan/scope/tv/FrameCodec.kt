package com.alpapan.scope.tv
object FrameCodec {
    fun encode(p: ByteArray): ByteArray {
        val n = p.size; val o = ByteArray(4 + n)
        o[0]=(n ushr 24).toByte(); o[1]=(n ushr 16).toByte(); o[2]=(n ushr 8).toByte(); o[3]=n.toByte()
        System.arraycopy(p,0,o,4,n); return o
    }
}
class FrameDecoder(private val maxFrame: Int = 256*1024) {
    private var leftover = ByteArray(0)
    fun feed(chunk: ByteArray): List<ByteArray> {
        val data = if (leftover.isEmpty()) chunk else leftover + chunk
        val out = ArrayList<ByteArray>(); var off = 0
        while (data.size - off >= 4) {
            val len = ((data[off].toInt() and 0xFF) shl 24) or ((data[off+1].toInt() and 0xFF) shl 16) or
                      ((data[off+2].toInt() and 0xFF) shl 8) or (data[off+3].toInt() and 0xFF)
            if (len < 0 || len > maxFrame) throw IllegalStateException("bad frame length $len")
            if (data.size - off - 4 < len) break
            out.add(data.copyOfRange(off+4, off+4+len)); off += 4 + len
        }
        leftover = if (off < data.size) data.copyOfRange(off, data.size) else ByteArray(0)
        return out
    }
}
