package com.alpapan.scope.tv
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
/** Picks the device's LAN IPv4 so the TV can show a manual-entry address. */
object LanIp {
    fun pick(addrs: List<InetAddress>): String? =
        addrs.firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress

    /** Enumerates active interfaces and returns the first site-local IPv4. */
    fun current(): String? {
        val all = mutableListOf<InetAddress>()
        for (nif in NetworkInterface.getNetworkInterfaces()) {
            if (!nif.isUp || nif.isLoopback) continue
            for (a in nif.inetAddresses) all.add(a)
        }
        return pick(all)
    }
}
