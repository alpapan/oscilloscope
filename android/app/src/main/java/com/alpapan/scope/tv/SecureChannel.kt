package com.alpapan.scope.tv
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class SecureChannel(key: ByteArray, private val sendDir: Byte, private val recvDir: Byte) {
    init { require(key.size == 32) { "key must be 32 bytes" } }
    private val secret = SecretKeySpec(key, "AES")
    private var sendCtr = 0L
    private var nextRecvCtr = 0L
    fun seal(plaintext: ByteArray): ByteArray {
        val nonce = nonce(sendDir, sendCtr++)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, secret, GCMParameterSpec(128, nonce))
        return nonce + c.doFinal(plaintext)
    }
    fun open(frame: ByteArray): ByteArray {
        require(frame.size >= 12 + 16) { "short frame" }   // 12B nonce + 16B GCM tag minimum
        val nonce = frame.copyOfRange(0, 12)
        require(nonce[0] == recvDir) { "bad direction" }
        val ctr = ctrOf(nonce)
        // Enforce monotonic ordering; out-of-order/duplicate frames are dropped.
        // TCP guarantees in-order delivery, so legitimate frames never trip this.
        require(ctr >= nextRecvCtr) { "replay/out-of-order" }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(128, nonce))
        val pt = c.doFinal(frame.copyOfRange(12, frame.size))   // throws AEADBadTagException on tamper
        nextRecvCtr = ctr + 1
        return pt
    }
    private fun nonce(dir: Byte, ctr: Long): ByteArray {
        val n = ByteArray(12); n[0] = dir
        for (i in 0..7) n[11 - i] = (ctr shr (8 * i)).toByte()
        return n
    }
    private fun ctrOf(n: ByteArray): Long {
        var v = 0L; for (i in 4..11) v = (v shl 8) or (n[i].toLong() and 0xFF); return v
    }
}
