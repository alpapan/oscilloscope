package com.alpapan.scope.tv
import com.google.crypto.tink.subtle.X25519
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object KeyExchange {
    private const val INFO = "scope-tv-aead-v2"
    // SecureRandom is thread-safe; one shared instance is correct and cheaper than per-call.
    private val rng = SecureRandom()

    /** X25519 keypair as raw 32-byte values. The wire format (handshake JSON
     *  "pub") is the raw 32-byte public key, base64-encoded. */
    class X25519KeyPair(val priv: ByteArray, val pub: ByteArray)

    fun generateKeyPair(): X25519KeyPair {
        // The platform KeyPairGenerator cannot produce X25519 keys consistently
        // across Android versions: Conscrypt (the default provider) rejects
        // initialize(NamedParameterSpec) on "XDH" on API 36, and API 34 (Android
        // 14 / Chromecast) has no "X25519" generator at all. We therefore use the
        // vendored Tink X25519 (pure Java). 32 random bytes are a valid scalar -
        // X25519.computeSharedSecret clamps per RFC 7748.
        val priv = ByteArray(32).also { rng.nextBytes(it) }
        return X25519KeyPair(priv, X25519.publicFromPrivate(priv))
    }

    fun publicBytes(kp: X25519KeyPair): ByteArray = kp.pub

    // CANONICAL ORDER INVARIANT: phonePub and tvPub are ALWAYS passed initiator(phone)
    // first, regardless of which side calls this. The salt = SHA-256(phonePub || tvPub)
    // is therefore identical on both ends. Swapping the order on one side breaks pairing.
    fun deriveKey(ownPriv: ByteArray, peerPub: ByteArray, phonePub: ByteArray, tvPub: ByteArray, code: String): ByteArray {
        val shared = X25519.computeSharedSecret(ownPriv, peerPub)   // throws on invalid/banned peer pub
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
