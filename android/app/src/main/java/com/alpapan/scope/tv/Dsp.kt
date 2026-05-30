package com.alpapan.scope.tv
object Dsp {
    /** Linear-pick downsample of mono float to `points` samples. */
    fun downsample(src: FloatArray, points: Int): FloatArray {
        if (points >= src.size) return src.copyOf()
        return FloatArray(points) { src[(it.toLong() * (src.size - 1) / (points - 1)).toInt()] }
    }
}
