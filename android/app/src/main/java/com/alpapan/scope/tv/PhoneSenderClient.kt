package com.alpapan.scope.tv
import org.json.JSONObject
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
        val out = s.getOutputStream()
        out.write(FrameCodec.encode(byteArrayOf(0) + JSONObject().put("type","hello").put("v",1).put("code",code).toString().toByteArray())); out.flush()
        val dec = FrameDecoder(); val rb = ByteArray(256); var reply: String? = null
        while (reply == null) { val n = s.getInputStream().read(rb); if (n<0) break; dec.feed(rb.copyOfRange(0,n)).firstOrNull()?.let { reply = String(it.copyOfRange(1,it.size), Charsets.UTF_8) } }
        connected = try { reply != null && JSONObject(reply).optBoolean("ok", false) } catch (_: Throwable) { false }
        if (!connected) { close(); return false }
        running = true
        thread(name="tv-send") {
            try { while (running) { val p = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue; out.write(FrameCodec.encode(p)) } }
            catch (_: Throwable) {} finally { fail() }
        }
        thread(name = "tv-recv") {
            val rdec = FrameDecoder(); val rrb = ByteArray(4096); val ins = socket!!.getInputStream()
            try { while (running) { val n = ins.read(rrb); if (n < 0) break
                for (f in rdec.feed(rrb.copyOfRange(0, n)))
                    if (f.isNotEmpty() && f[0].toInt() == 0) onControl?.invoke(String(f.copyOfRange(1, f.size), Charsets.UTF_8))
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
