package com.alpapan.scope.tv
import java.io.ByteArrayOutputStream
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.spec.NamedParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object KeyExchange {
    private const val INFO = "scope-tv-aead-v2"
    fun generateKeyPair(): KeyPair {
        val kpg = KeyPairGenerator.getInstance("XDH")
        kpg.initialize(NamedParameterSpec.X25519)
        return kpg.generateKeyPair()
    }
    fun publicBytes(kp: KeyPair): ByteArray = kp.public.encoded   // X.509 SPKI, variable length
    // CANONICAL ORDER INVARIANT: phonePub and tvPub are ALWAYS passed initiator(phone)
    // first, regardless of which side calls this. The salt = SHA-256(phonePub || tvPub)
    // is therefore identical on both ends. Swapping the order on one side breaks pairing.
    fun deriveKey(ownPriv: PrivateKey, peerPub: ByteArray, phonePub: ByteArray, tvPub: ByteArray, code: String): ByteArray {
        val peer = KeyFactory.getInstance("XDH").generatePublic(X509EncodedKeySpec(peerPub))
        val ka = KeyAgreement.getInstance("XDH"); ka.init(ownPriv); ka.doPhase(peer, true)
        val shared = ka.generateSecret()
        val salt = MessageDigest.getInstance("SHA-256").digest(phonePub + tvPub)
        val info = INFO.toByteArray(Charsets.UTF_8) + code.toByteArray(Charsets.UTF_8)
        return hkdf(salt, shared, info, 32)
    }
    fun hkdfForTest(salt: ByteArray, ikm: ByteArray, info: ByteArray, len: Int) = hkdf(salt, ikm, info, len)
    private fun hkdf(salt: ByteArray, ikm: ByteArray, info: ByteArray, len: Int): ByteArray {
        val prk = hmac(if (salt.isEmpty()) ByteArray(32) else salt, ikm)
        val out = ByteArrayOutputStream(); var t = ByteArray(0); var i = 1
        while (out.size() < len) { t = hmac(prk, t + info + byteArrayOf(i.toByte())); out.write(t); i++ }
        return out.toByteArray().copyOf(len)
    }
    private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val m = Mac.getInstance("HmacSHA256"); m.init(SecretKeySpec(key, "HmacSHA256")); return m.doFinal(data)
    }
}
