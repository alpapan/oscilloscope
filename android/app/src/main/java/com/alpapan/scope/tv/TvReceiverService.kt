package com.alpapan.scope.tv
import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.alpapan.scope.ScopeAudioPlugin
import org.json.JSONObject
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
class TvReceiverService : Service() {
    companion object {
        private const val PORT = 8765
        @Volatile var session: PairingSession? = null      // set by plugin.startTvReceiver
        @Volatile var onCodeRotated: ((String) -> Unit)? = null
        // The paired phone's output stream, exposed so the TV can push
        // render-requests (control, msgType 0) back to the phone. Set once
        // paired; cleared on disconnect.
        @Volatile var clientOut: java.io.OutputStream? = null
        @Synchronized fun sendControl(json: String) {
            try { clientOut?.let { it.write(FrameCodec.encode(byteArrayOf(0) + json.toByteArray())); it.flush() } } catch (_: Throwable) {}
        }
    }
    @Volatile private var running = false
    @Volatile private var active = false                    // single active client
    private var server: ServerSocket? = null
    private var advertiser: TvAdvertiser? = null
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
            val s = try { ss.accept() } catch (_: Throwable) { break }
            if (active) { try { s.close() } catch (_: Throwable) {}; continue }  // single phone
            s.soTimeout = 10000                                                  // drop idle/stalled clients
            active = true
            thread(name = "tv-conn") { try { handle(s) } finally { active = false } }
        }
    }
    private fun handle(sock: Socket) = sock.use {
        val input = it.getInputStream(); val output = it.getOutputStream()
        val dec = FrameDecoder(); val buf = ByteArray(16*1024); var paired = false
        while (running) {
            val n = try { input.read(buf) } catch (_: Throwable) { break }   // SocketTimeout / IO -> disconnect
            if (n < 0) break
            for (frame in dec.feed(buf.copyOfRange(0,n))) {
                if (!paired) {
                    val obj = try { JSONObject(String(frame.copyOfRange(1,frame.size), Charsets.UTF_8)) } catch (_:Throwable){ JSONObject() }
                    val supplied = obj.optString("code"); val versionOk = obj.optInt("v", 0) == 1
                    val ok = versionOk && (session?.attempt(supplied) ?: false)
                    output.write(FrameCodec.encode((byteArrayOf(0) + "{\"type\":\"hello-ack\",\"ok\":$ok}".toByteArray())))
                    output.flush()
                    if (!ok) { if (versionOk) session?.code?.let { c -> onCodeRotated?.invoke(c) }; return }
                    paired = true; advertiser?.stop(); clientOut = output; ScopeAudioPlugin.instance?.notifyTvConnected()
                } else when (frame[0].toInt()) {
                    0 -> ScopeAudioPlugin.instance?.notifyTvRenderRequest(String(frame.copyOfRange(1,frame.size), Charsets.UTF_8))
                    1 -> ScopeAudioPlugin.instance?.notifyTvAnalysisFrame(android.util.Base64.encodeToString(frame, android.util.Base64.NO_WRAP))
                }
            }
        }
        clientOut = null
        ScopeAudioPlugin.instance?.notifyTvDisconnected()
        if (running) advertiser = TvAdvertiser(this).also { a -> a.advertise(PORT, "Scope TV") }
    }
    override fun onDestroy() { running=false; clientOut=null; try{server?.close()}catch(_:Throwable){}; advertiser?.stop(); super.onDestroy() }
}
