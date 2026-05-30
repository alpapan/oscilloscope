package com.alpapan.scope.tv
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
private const val TYPE = "_scope._tcp."
class TvAdvertiser(ctx: Context) {
    private val nsd = ctx.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var reg: NsdManager.RegistrationListener? = null
    fun advertise(port: Int, name: String) {
        val info = NsdServiceInfo().apply { serviceName = name; serviceType = TYPE; setPort(port) }
        reg = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(s: NsdServiceInfo) {}
            override fun onRegistrationFailed(s: NsdServiceInfo, e: Int) {}
            override fun onServiceUnregistered(s: NsdServiceInfo) {}
            override fun onUnregistrationFailed(s: NsdServiceInfo, e: Int) {}
        }
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, reg)
    }
    fun stop() { reg?.let { try { nsd.unregisterService(it) } catch (_: Throwable) {} }; reg = null }
}
class TvBrowser(ctx: Context) {
    private val nsd = ctx.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private val seen = java.util.Collections.synchronizedSet(HashSet<String>())
    private var listener: NsdManager.DiscoveryListener? = null
    /** onResolved is invoked on the MAIN thread. NSD callbacks arrive on binder threads. */
    fun start(onResolved: (name: String, host: String, port: Int) -> Unit) {
        listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(t: String) {}
            override fun onDiscoveryStopped(t: String) {}
            override fun onStartDiscoveryFailed(t: String, e: Int) {}
            override fun onStopDiscoveryFailed(t: String, e: Int) {}
            override fun onServiceLost(s: NsdServiceInfo) {}
            override fun onServiceFound(s: NsdServiceInfo) {
                nsd.resolveService(s, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(si: NsdServiceInfo, e: Int) {}
                    override fun onServiceResolved(si: NsdServiceInfo) {
                        val name = si.serviceName; val host = si.host?.hostAddress ?: return; val port = si.port
                        if (!seen.add("$host:$port")) return            // de-dup duplicate resolves
                        main.post { onResolved(name, host, port) }      // marshal to main
                    }
                })
            }
        }
        nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    }
    fun stop() { listener?.let { try { nsd.stopServiceDiscovery(it) } catch (_: Throwable) {} }; listener = null; seen.clear() }
}
