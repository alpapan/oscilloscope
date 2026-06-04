package com.alpapan.scope.tv

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import java.io.PipedInputStream
import java.io.PipedOutputStream

// Exercises X25519 keypair generation + the full handshake on a real Android
// runtime (run across API 34/35/36 via GMD). The platform's KeyPairGenerator
// cannot produce X25519 keys consistently across these versions, so the JVM
// KeyExchangeTest cannot cover this; this test guards the device path.
@RunWith(AndroidJUnit4::class)
class KeyExchangeInstrumentedTest {

    @Test fun generateKeyPairDoesNotThrowOnDeviceProvider() {
        val kp = KeyExchange.generateKeyPair()
        assertNotNull(kp)
        assertEquals(32, kp.priv.size)
        assertEquals(32, kp.pub.size)
    }

    @Test fun bothSidesDeriveSameKeyOnDeviceProvider() {
        val phone = KeyExchange.generateKeyPair()
        val tv = KeyExchange.generateKeyPair()
        val pPub = KeyExchange.publicBytes(phone)
        val tPub = KeyExchange.publicBytes(tv)
        val kPhone = KeyExchange.deriveKey(phone.priv, tPub, pPub, tPub, "123456")
        val kTv = KeyExchange.deriveKey(tv.priv, pPub, pPub, tPub, "123456")
        assertArrayEquals(kPhone, kTv)
    }

    @Test fun fullHandshakeSucceedsOnDeviceProvider() {
        val p2tIn = PipedInputStream(1 shl 16); val p2tOut = PipedOutputStream(p2tIn)
        val t2pIn = PipedInputStream(1 shl 16); val t2pOut = PipedOutputStream(t2pIn)
        val session = PairingSession { "123456" }
        var tvChan: SecureChannel? = null
        val tvThread = Thread { tvChan = Handshake.tvAccept(FrameReader(p2tIn), t2pOut, session, PairingRateLimiter()) }
        tvThread.start()
        val phoneChan = Handshake.phoneConnect(FrameReader(t2pIn), p2tOut, "123456")
        tvThread.join(30000)
        assertNotNull("phone handshake channel", phoneChan)
        assertNotNull("tv handshake channel", tvChan)
        assertArrayEquals(byteArrayOf(7, 7), tvChan!!.open(phoneChan!!.seal(byteArrayOf(7, 7))))
    }
}
