package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket

class PhoneSenderClientTimeoutTest {
    @Test fun connectReturnsFalseWhenServerSilent() {
        val ss = ServerSocket(0); val port = ss.localPort
        val accepter = Thread { try { ss.accept() } catch (_: Throwable) {} }   // accept, never reply
        accepter.start()
        val client = PhoneSenderClient()
        val start = System.currentTimeMillis()
        val ok = client.connect("127.0.0.1", port, "123456")
        val elapsed = System.currentTimeMillis() - start
        assertFalse(ok)
        assertTrue("must time out promptly, took $elapsed ms", elapsed < 8000)
        client.close(); ss.close()
    }
}
