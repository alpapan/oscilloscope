package com.alpapan.scope.tv
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class KeyExchangeTest {
    @Test fun bothSidesDeriveSameKeyWithSameCode() {
        val phone = KeyExchange.generateKeyPair()
        val tv = KeyExchange.generateKeyPair()
        val pPub = KeyExchange.publicBytes(phone)
        val tPub = KeyExchange.publicBytes(tv)
        val kPhone = KeyExchange.deriveKey(phone.priv, tPub, pPub, tPub, "123456")
        val kTv = KeyExchange.deriveKey(tv.priv, pPub, pPub, tPub, "123456")
        assertArrayEquals(kPhone, kTv)
        org.junit.Assert.assertEquals(32, kPhone.size)
        org.junit.Assert.assertEquals(32, pPub.size)
        org.junit.Assert.assertEquals(32, tPub.size)
    }
    @Test fun differentCodeYieldsDifferentKey() {
        val phone = KeyExchange.generateKeyPair(); val tv = KeyExchange.generateKeyPair()
        val pPub = KeyExchange.publicBytes(phone); val tPub = KeyExchange.publicBytes(tv)
        val a = KeyExchange.deriveKey(phone.priv, tPub, pPub, tPub, "123456")
        val b = KeyExchange.deriveKey(tv.priv, pPub, pPub, tPub, "654321")
        assertFalse(a.contentEquals(b))
    }
    @Test fun hkdfMatchesRfc5869BasicVector() {
        // RFC 5869 A.1: ikm=0x0b*22, salt=0x00..0x0c, info=0xf0..0xf9, L=42
        val ikm = ByteArray(22) { 0x0b }
        val salt = ByteArray(13) { it.toByte() }
        val info = ByteArray(10) { (0xf0 + it).toByte() }
        val okm = KeyExchange.hkdfForTest(salt, ikm, info, 42)
        val expectedHex = "3cb25f25faacd57a90434f64d0362f2a" +
            "2d2d0a90cf1a5a4c5db02d56ecc4c5bf" + "34007208d5b887185865"
        assertEquals(expectedHex, okm.joinToString("") { "%02x".format(it) })
    }
    private fun assertEquals(a: String, b: String) = org.junit.Assert.assertEquals(a, b)
}
