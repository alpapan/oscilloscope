package com.alpapan.scope.tv
import java.security.SecureRandom
object PairingCode {
    private val rng = SecureRandom()
    fun generate(): String = rng.nextInt(10000).toString().padStart(4,'0')
    fun verify(expected: String, supplied: String): Boolean {
        if (expected.isEmpty() || supplied.isEmpty() || expected.length != supplied.length) return false
        var d = 0; for (i in expected.indices) d = d or (expected[i].code xor supplied[i].code); return d == 0
    }
}
