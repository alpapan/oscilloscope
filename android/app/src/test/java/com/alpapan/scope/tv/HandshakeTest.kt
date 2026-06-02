package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
import java.io.PipedInputStream
import java.io.PipedOutputStream

class HandshakeTest {
    @Test fun correctCodePairs() {
        val p2tIn = PipedInputStream(1 shl 16); val p2tOut = PipedOutputStream(p2tIn)   // phone -> tv
        val t2pIn = PipedInputStream(1 shl 16); val t2pOut = PipedOutputStream(t2pIn)   // tv -> phone
        val session = PairingSession { "123456" }
        var tvChan: SecureChannel? = null
        val tvThread = Thread { tvChan = Handshake.tvAccept(FrameReader(p2tIn), t2pOut, session, PairingRateLimiter()) }
        tvThread.start()
        val phoneChan = Handshake.phoneConnect(FrameReader(t2pIn), p2tOut, "123456")
        tvThread.join(3000)
        assertNotNull(phoneChan); assertNotNull(tvChan)
        assertArrayEquals(byteArrayOf(1, 2), tvChan!!.open(phoneChan!!.seal(byteArrayOf(1, 2))))
        assertArrayEquals(byteArrayOf(3, 4), phoneChan.open(tvChan!!.seal(byteArrayOf(3, 4))))
    }
    @Test fun wrongCodeFailsBothSides() {
        val p2tIn = PipedInputStream(1 shl 16); val p2tOut = PipedOutputStream(p2tIn)
        val t2pIn = PipedInputStream(1 shl 16); val t2pOut = PipedOutputStream(t2pIn)
        val session = PairingSession { "111111" }
        var tvChan: SecureChannel? = null
        val tvThread = Thread { tvChan = Handshake.tvAccept(FrameReader(p2tIn), t2pOut, session, PairingRateLimiter()) }
        tvThread.start()
        val phoneChan = Handshake.phoneConnect(FrameReader(t2pIn), p2tOut, "222222")
        tvThread.join(3000)
        assertNull(phoneChan); assertNull(tvChan)
    }
    @Test fun wrongCodeRotatesAndCountsFailure() {
        val p2tIn = PipedInputStream(1 shl 16); val p2tOut = PipedOutputStream(p2tIn)
        val t2pIn = PipedInputStream(1 shl 16); val t2pOut = PipedOutputStream(t2pIn)
        val session = PairingSession { java.util.UUID.randomUUID().toString().take(6) }
        val before = session.code
        val limiter = PairingRateLimiter(maxFailures = 1, lockoutMs = 1000) { 0L }
        Thread { Handshake.tvAccept(FrameReader(p2tIn), t2pOut, session, limiter) }.start()
        Handshake.phoneConnect(FrameReader(t2pIn), p2tOut, "000000")
        Thread.sleep(300)
        assertNotEquals(before, session.code)   // rotated on failure
        assertFalse(limiter.allow())            // failure counted -> locked
    }
}
