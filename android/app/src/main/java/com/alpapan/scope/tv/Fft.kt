package com.alpapan.scope.tv
import kotlin.math.*
object Fft {
    /** Magnitudes of the first half (real input). Input length need not be power of two; it is zero-padded. */
    fun magnitudes(input: FloatArray): FloatArray {
        var n = 1; while (n < input.size) n = n shl 1
        val re = DoubleArray(n); val im = DoubleArray(n)
        for (i in input.indices) re[i] = input[i].toDouble()
        transform(re, im)
        val half = n / 2
        return FloatArray(half) { sqrt(re[it]*re[it] + im[it]*im[it]).toFloat() }
    }
    private fun transform(re: DoubleArray, im: DoubleArray) {
        val n = re.size; if (n <= 1) return
        // bit reversal
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) { j = j xor bit; bit = bit shr 1 }
            j = j or bit
            if (i < j) { val tr=re[i];re[i]=re[j];re[j]=tr; val ti=im[i];im[i]=im[j];im[j]=ti }
        }
        var len = 2
        while (len <= n) {
            val ang = -2.0 * PI / len; val wr = cos(ang); val wi = sin(ang)
            var i = 0
            while (i < n) {
                var cr = 1.0; var ci = 0.0
                for (k in 0 until len/2) {
                    val ur = re[i+k]; val ui = im[i+k]
                    val vr = re[i+k+len/2]*cr - im[i+k+len/2]*ci
                    val vi = re[i+k+len/2]*ci + im[i+k+len/2]*cr
                    re[i+k]=ur+vr; im[i+k]=ui+vi; re[i+k+len/2]=ur-vr; im[i+k+len/2]=ui-vi
                    val ncr = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = ncr
                }
                i += len
            }
            len = len shl 1
        }
    }
}
