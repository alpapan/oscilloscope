package com.alpapan.scope.tv
class PairingSession(private val gen: () -> String = { PairingCode.generate() }) {
    @Volatile var code: String = gen(); private set
    @Synchronized fun rotate() { code = gen() }
}
