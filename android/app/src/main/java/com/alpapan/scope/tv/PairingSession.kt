package com.alpapan.scope.tv
class PairingSession(private val gen: () -> String = { PairingCode.generate() }) {
    @Volatile var code: String = gen(); private set
    @Synchronized fun attempt(supplied: String): Boolean {
        val ok = PairingCode.verify(code, supplied); if (!ok) code = gen(); return ok
    }
}
