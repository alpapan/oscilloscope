package com.alpapan.scope.tv
import java.io.ByteArrayOutputStream
object AnalysisFrameCodec {
    private fun q(x: Float): Int { val v = (Math.round((if (x>1f)1f else if (x< -1f) -1f else x) * 32767f)); return v }
    fun encodeWaveform(view: Int, mono: FloatArray, right: FloatArray?): ByteArray {
        val stereo = right != null; val n = mono.size
        val b = ByteArrayOutputStream()
        b.write(1); b.write(view); b.write(1 or (if (stereo) 4 else 0))
        b.write((n shr 8) and 0xFF); b.write(n and 0xFF); b.write(0); b.write(0)
        for (i in 0 until n) {
            writeI16(b, q(mono[i])); if (stereo) writeI16(b, q(right!![i]))
        }
        return b.toByteArray()
    }
    fun encodeSpectrum(view: Int, magsDb: FloatArray): ByteArray {
        val m = magsDb.size; val b = ByteArrayOutputStream()
        b.write(1); b.write(view); b.write(2); b.write(0); b.write(0); b.write((m shr 8) and 0xFF); b.write(m and 0xFF)
        for (db in magsDb) { val c = ((if (db < -100f) -100f else if (db>0f) 0f else db) + 100f) * 2.55f; b.write(Math.round(c).coerceIn(0, 255)) }
        return b.toByteArray()
    }
    fun encodeWaveformAndSpectrum(view: Int, mono: FloatArray, right: FloatArray?, magsDb: FloatArray): ByteArray {
        val stereo = right != null; val n = mono.size; val m = magsDb.size
        val b = ByteArrayOutputStream()
        b.write(1); b.write(view); b.write(1 or (if (stereo) 4 else 0) or 2)
        b.write((n shr 8) and 0xFF); b.write(n and 0xFF); b.write((m shr 8) and 0xFF); b.write(m and 0xFF)
        for (i in 0 until n) { writeI16(b, q(mono[i])); if (stereo) writeI16(b, q(right!![i])) }
        for (db in magsDb) { val c = ((if (db < -100f) -100f else if (db > 0f) 0f else db) + 100f) * 2.55f; b.write(Math.round(c).coerceIn(0, 255)) }
        return b.toByteArray()
    }
    private fun writeI16(b: ByteArrayOutputStream, v: Int) { b.write(v and 0xFF); b.write((v shr 8) and 0xFF) }
}
