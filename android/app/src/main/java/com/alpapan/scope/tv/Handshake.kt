package com.alpapan.scope.tv
import org.json.JSONObject
import java.io.OutputStream
import java.util.Base64

object Handshake {
    private const val HANDSHAKE_MAX = 4096          // tiny cap for pre-pairing frames (DoS)
    private const val STEADY_MAX = 256 * 1024
    private val CONFIRM = byteArrayOf(0) + "{\"type\":\"confirm\"}".toByteArray()
    private val CONFIRM_ACK = byteArrayOf(0) + "{\"type\":\"confirm-ack\"}".toByteArray()

    private fun writeFrame(output: OutputStream, payload: ByteArray) {
        output.write(FrameCodec.encode(payload)); output.flush()
    }

    /** TV side. Returns a channel on success, null on failure (caller counts/rotates).
     *  The SAME FrameReader is reused by the caller's steady-state loop afterwards;
     *  on success its cap is raised to STEADY_MAX with no leftover loss. */
    fun tvAccept(reader: FrameReader, output: OutputStream, session: PairingSession, limiter: PairingRateLimiter): SecureChannel? {
        if (!limiter.allow()) return null
        reader.maxFrame = HANDSHAKE_MAX
        val hello = reader.next() ?: return fail(limiter, session)
        if (hello.isEmpty()) return fail(limiter, session)
        val helloObj = try { JSONObject(String(hello.copyOfRange(1, hello.size), Charsets.UTF_8)) } catch (_: Throwable) { return fail(limiter, session) }
        if (helloObj.optInt("v") != 2) return fail(limiter, session)
        val phonePub = try { Base64.getDecoder().decode(helloObj.optString("pub")) } catch (_: Throwable) { return fail(limiter, session) }
        val tv = KeyExchange.generateKeyPair(); val tvPub = KeyExchange.publicBytes(tv)
        writeFrame(output, byteArrayOf(0) + JSONObject().put("type", "hello-ack").put("v", 2)
            .put("pub", Base64.getEncoder().encodeToString(tvPub)).toString().toByteArray())
        val key = try { KeyExchange.deriveKey(tv.priv, phonePub, phonePub, tvPub, session.code) } catch (_: Throwable) { return fail(limiter, session) }
        val chan = SecureChannel(key, sendDir = 1, recvDir = 0)
        val confirmFrame = reader.next() ?: return fail(limiter, session)   // still capped at HANDSHAKE_MAX (confirm is tiny)
        val ok = try { chan.open(confirmFrame).contentEquals(CONFIRM) } catch (_: Throwable) { false }
        if (!ok) return fail(limiter, session)
        writeFrame(output, chan.seal(CONFIRM_ACK))
        reader.maxFrame = STEADY_MAX                 // same reader, leftover preserved
        limiter.onSuccess()
        return chan
    }
    private fun fail(limiter: PairingRateLimiter, session: PairingSession): SecureChannel? {
        limiter.onFailure(); session.rotate(); return null
    }

    /** Phone side. Returns a channel on success, null on failure. */
    fun phoneConnect(reader: FrameReader, output: OutputStream, code: String): SecureChannel? {
        reader.maxFrame = STEADY_MAX                 // the phone trusts the TV it dialled; ack/confirm-ack are small anyway
        val phone = KeyExchange.generateKeyPair(); val phonePub = KeyExchange.publicBytes(phone)
        writeFrame(output, byteArrayOf(0) + JSONObject().put("type", "hello").put("v", 2)
            .put("pub", Base64.getEncoder().encodeToString(phonePub)).toString().toByteArray())
        val ack = reader.next() ?: return null
        if (ack.isEmpty()) return null
        val ackObj = try { JSONObject(String(ack.copyOfRange(1, ack.size), Charsets.UTF_8)) } catch (_: Throwable) { return null }
        if (ackObj.optInt("v") != 2) return null
        val tvPub = try { Base64.getDecoder().decode(ackObj.optString("pub")) } catch (_: Throwable) { return null }
        val key = try { KeyExchange.deriveKey(phone.priv, tvPub, phonePub, tvPub, code) } catch (_: Throwable) { return null }
        val chan = SecureChannel(key, sendDir = 0, recvDir = 1)
        writeFrame(output, chan.seal(CONFIRM))
        val ackFrame = reader.next() ?: return null
        val ok = try { chan.open(ackFrame).contentEquals(CONFIRM_ACK) } catch (_: Throwable) { false }
        return if (ok) chan else null
    }
}
