package com.alpapan.scope.tv
import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.alpapan.scope.ScopeAudioPlugin
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
class TvReceiverService : Service() {
    companion object {
        private const val PORT = 8765
        @Volatile var session: PairingSession? = null      // set by plugin.startTvReceiver
        @Volatile var onCodeRotated: ((String) -> Unit)? = null
        // The paired phone's secure channel + output stream, exposed so the TV can
        // push render-requests (control, msgType 0) back to the phone, AEAD-sealed.
        // Set once paired; cleared on disconnect.
        @Volatile var clientChannel: SecureChannel? = null
        @Volatile var clientOut: java.io.OutputStream? = null
        // The paired phone's socket, exposed so the TV remote Back can drop the
        // pairing. Closing it makes the read loop throw -> normal disconnect cleanup.
        @Volatile var activeSocket: Socket? = null
        @Synchronized fun sendControl(json: String) {
            val ch = clientChannel ?: return
            val out = clientOut ?: return
            // Synchronize on the channel: sendControl and the steady-state seal must
            // not interleave seal() counter increments (would reuse a GCM nonce).
            try { synchronized(ch) { out.write(FrameCodec.encode(ch.seal(byteArrayOf(0) + json.toByteArray()))); out.flush() } } catch (_: Throwable) {}
        }
        @Synchronized fun disconnectActive() { try { activeSocket?.close() } catch (_: Throwable) {} }
    }
    @Volatile private var running = false
    @Volatile private var active = false                    // single active client
    private var server: ServerSocket? = null
    private var advertiser: TvAdvertiser? = null
    private val connLimiter = ConnectionRateLimiter()
    private val pairLimiter = PairingRateLimiter()
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        if (running) return START_STICKY
        running = true
        advertiser = TvAdvertiser(this).also { it.advertise(PORT, "Scope TV") }
        thread(name="tv-accept") { accept() }
        return START_STICKY
    }
    private fun accept() {
        val ss = ServerSocket(PORT).also { server = it }
        while (running) {
            val s = try { ss.accept() } catch (_: Throwable) {
                // A transient accept() error must not kill the listener; only
                // shutdown (running=false) or a closed socket stops it (F11).
                if (AcceptPolicy.shouldRetry(running, ss.isClosed)) { try { Thread.sleep(50) } catch (_: Throwable) {}; continue }
                break
            }
            if (active) { try { s.close() } catch (_: Throwable) {}; continue }  // single phone
            if (!connLimiter.allow(s.inetAddress?.hostAddress ?: "?")) { try { s.close() } catch (_: Throwable) {}; continue }
            active = true
            thread(name = "tv-conn") { try { handle(s) } finally { active = false } }
        }
    }
    private fun handle(sock: Socket) = sock.use {
        it.soTimeout = 5000                                  // handshake deadline
        val reader = FrameReader(it.getInputStream())
        val out = it.getOutputStream()
        val sess = session
        val ch = if (sess != null) Handshake.tvAccept(reader, out, sess, pairLimiter) else null
        if (ch == null) {
            // tvAccept already rotated the code + counted the failure; surface the
            // fresh code so the TV overlay updates. No re-advertise needed (the
            // advertiser was never stopped on a failed handshake).
            if (sess != null) onCodeRotated?.invoke(sess.code)
            return
        }
        it.soTimeout = 10000                                 // steady state: frequent analysis frames keep this live
        clientChannel = ch; clientOut = out; activeSocket = it
        advertiser?.stop(); ScopeAudioPlugin.instance?.notifyTvConnected()
        while (running) {
            val frame = reader.next() ?: break               // EOF / IO / oversize -> disconnect
            val plain = try { ch.open(frame) } catch (_: Throwable) { continue }   // drop tampered/replayed
            when (val action = TvInboundRouter.route(plain)) {
                is TvInbound.RenderRequest -> ScopeAudioPlugin.instance?.notifyTvRenderRequest(action.json)
                // The JS path decodes the PLAINTEXT analysis frame, so pass `plain`.
                is TvInbound.AnalysisFrame -> ScopeAudioPlugin.instance?.notifyTvAnalysisFrame(android.util.Base64.encodeToString(action.frame, android.util.Base64.NO_WRAP))
                TvInbound.Drop -> {}
            }
        }
        clientChannel = null; clientOut = null; activeSocket = null
        ScopeAudioPlugin.instance?.notifyTvDisconnected()
        if (running) advertiser = TvAdvertiser(this).also { a -> a.advertise(PORT, "Scope TV") }
    }
    override fun onDestroy() { running=false; clientChannel=null; clientOut=null; activeSocket=null; try{server?.close()}catch(_:Throwable){}; advertiser?.stop(); super.onDestroy() }
}
