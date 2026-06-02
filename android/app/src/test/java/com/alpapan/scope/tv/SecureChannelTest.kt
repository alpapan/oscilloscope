package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test

class SecureChannelTest {
    private fun key() = ByteArray(32) { it.toByte() }
    private fun pair(): Pair<SecureChannel, SecureChannel> {
        val k = key()
        // phone seals dir 0 / opens dir 1 ; tv seals dir 1 / opens dir 0
        return SecureChannel(k, sendDir = 0, recvDir = 1) to SecureChannel(k, sendDir = 1, recvDir = 0)
    }
    @Test fun roundTripsPhoneToTv() {
        val (phone, tv) = pair()
        val pt = "hello".toByteArray()
        assertArrayEquals(pt, tv.open(phone.seal(pt)))
    }
    @Test fun tamperedTagThrows() {
        val (phone, tv) = pair()
        val sealed = phone.seal("x".toByteArray()); sealed[sealed.size - 1] = (sealed[sealed.size - 1] + 1).toByte()
        assertThrows(Exception::class.java) { tv.open(sealed) }
    }
    @Test fun wrongKeyThrows() {
        val phone = SecureChannel(ByteArray(32) { 1 }, 0, 1)
        val tv = SecureChannel(ByteArray(32) { 2 }, 1, 0)
        assertThrows(Exception::class.java) { tv.open(phone.seal("x".toByteArray())) }
    }
    @Test fun replayedFrameThrows() {
        val (phone, tv) = pair()
        val f0 = phone.seal("a".toByteArray()); val f1 = phone.seal("b".toByteArray())
        tv.open(f0); tv.open(f1)
        assertThrows(Exception::class.java) { tv.open(f0) }   // old counter
    }
    @Test fun shortFrameThrows() {
        val (_, tv) = pair()
        assertThrows(Exception::class.java) { tv.open(ByteArray(5)) }
    }
}
