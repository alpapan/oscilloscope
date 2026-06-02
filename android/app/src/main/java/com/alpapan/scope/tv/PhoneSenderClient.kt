package com.alpapan.scope.tv
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
class PhoneSenderClient(private val onFailed: () -> Unit = {}) {
    private val queue = ArrayBlockingQueue<ByteArray>(8)
    @Volatile private var socket: Socket? = null
    @Volatile private var running = false
    @Volatile var connected = false; private set
    var onControl: ((String) -> Unit)? = null
    fun connect(host: String, port: Int, code: String): Boolean {
        val s = Socket(); s.connect(InetSocketAddress(host, port), 4000); socket = s
        s.soTimeout = 5000                                   // handshake deadline (F6): a silent TV must not hang us
        val reader = FrameReader(s.getInputStream())
        val out = s.getOutputStream()
        val ch = Handshake.phoneConnect(reader, out, code) ?: run { close(); return false }
        connected = true
        // Steady state: blocking reads. The TV->phone control channel is sparse
        // (only on TV-side user action), so a read timeout would false-disconnect
        // an idle-but-healthy pairing. A dead TV is detected by the send thread:
        // the phone streams analysis frames continuously, so out.write throws
        // promptly when the TV vanishes and fires fail().
        s.soTimeout = 0
        running = true
        thread(name="tv-send") {
            try { while (running) { val p = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue; out.write(FrameCodec.encode(ch.seal(p))) } }
            catch (_: Throwable) {} finally { fail() }
        }
        thread(name = "tv-recv") {
            try { while (running) {
                val frame = reader.next() ?: break           // reuse the SAME reader so handshake leftover is not lost
                val plain = try { ch.open(frame) } catch (_: Throwable) { continue }   // drop tampered/replayed
                if (plain.isNotEmpty() && plain[0].toInt() == 0) onControl?.invoke(String(plain.copyOfRange(1, plain.size), Charsets.UTF_8))
            } } catch (_: Throwable) {} finally { fail() }
        }
        return true
    }
    /** Non-blocking; drops the oldest frame on backlog so the caller never stalls. */
    fun enqueue(framePayload: ByteArray) { if (!connected) return; if (!queue.offer(framePayload)) { queue.poll(); queue.offer(framePayload) } }
    fun sendControl(json: String) { enqueue(byteArrayOf(0) + json.toByteArray()) }
    // @Synchronized so the two worker threads (tv-send + tv-recv) that both
    // hit fail() in their finally blocks fire onFailed() exactly once.
    @Synchronized private fun fail() { if (connected) { connected = false; onFailed() }; close() }
    fun close() { running=false; connected=false; try { socket?.close() } catch (_:Throwable){}; socket=null }
}
