package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
class LanIpTest {
    private fun addr(s: String) = InetAddress.getByName(s)
    @Test fun picks_site_local_ipv4() {
        assertEquals("192.168.0.6", LanIp.pick(listOf(addr("192.168.0.6"))))
    }
    @Test fun skips_loopback() {
        assertEquals("10.0.0.5", LanIp.pick(listOf(addr("127.0.0.1"), addr("10.0.0.5"))))
    }
    @Test fun skips_ipv6_and_link_local() {
        assertEquals("172.16.4.2", LanIp.pick(listOf(addr("::1"), addr("fe80::1"), addr("172.16.4.2"))))
    }
    @Test fun skips_public_ipv4() {
        assertNull(LanIp.pick(listOf(addr("8.8.8.8"))))
    }
    @Test fun returns_null_when_none() {
        assertNull(LanIp.pick(emptyList()))
    }
}
