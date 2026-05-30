package com.alpapan.scope.tv
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.util.Log
private const val TYPE = "_scope._tcp."
private const val TAG = "ScopeNsd"

/** mDNS multicast is dropped by Wi-Fi power saving unless a lock is held; both
 *  the advertiser (to hear queries) and the browser (to hear responses) need it. */
private fun acquireMulticast(ctx: Context, tag: String): WifiManager.MulticastLock? = try {
    val wifi = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    wifi.createMulticastLock(tag).apply { setReferenceCounted(false); acquire() }
} catch (e: Throwable) { Log.w(TAG, "multicast lock ($tag) failed: ${e.message}"); null }

private fun releaseMulticast(lock: WifiManager.MulticastLock?) {
    lock?.let { try { if (it.isHeld) it.release() } catch (_: Throwable) {} }
}

class TvAdvertiser(ctx: Context) {
    private val appCtx = ctx.applicationContext
    private val nsd = appCtx.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var reg: NsdManager.RegistrationListener? = null
    private var lock: WifiManager.MulticastLock? = null
    fun advertise(port: Int, name: String) {
        lock = acquireMulticast(appCtx, "scope-advertise")
        val info = NsdServiceInfo().apply { serviceName = name; serviceType = TYPE; setPort(port) }
        reg = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(s: NsdServiceInfo) { Log.i(TAG, "advertise registered as '${s.serviceName}' port $port") }
            override fun onRegistrationFailed(s: NsdServiceInfo, e: Int) { Log.w(TAG, "advertise registration failed: err=$e") }
            override fun onServiceUnregistered(s: NsdServiceInfo) { Log.i(TAG, "advertise unregistered") }
            override fun onUnregistrationFailed(s: NsdServiceInfo, e: Int) { Log.w(TAG, "advertise unregistration failed: err=$e") }
        }
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, reg)
    }
    fun stop() {
        reg?.let { try { nsd.unregisterService(it) } catch (_: Throwable) {} }; reg = null
        releaseMulticast(lock); lock = null
    }
}
class TvBrowser(ctx: Context) {
    private val appCtx = ctx.applicationContext
    private val nsd = appCtx.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private val seen = java.util.Collections.synchronizedSet(HashSet<String>())
    private var listener: NsdManager.DiscoveryListener? = null
    private var lock: WifiManager.MulticastLock? = null
    /** onResolved is invoked on the MAIN thread. NSD callbacks arrive on binder threads. */
    fun start(onResolved: (name: String, host: String, port: Int) -> Unit) {
        lock = acquireMulticast(appCtx, "scope-browse")
        listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(t: String) { Log.i(TAG, "discovery started for $t") }
            override fun onDiscoveryStopped(t: String) { Log.i(TAG, "discovery stopped for $t") }
            override fun onStartDiscoveryFailed(t: String, e: Int) { Log.w(TAG, "start discovery failed: err=$e") }
            override fun onStopDiscoveryFailed(t: String, e: Int) { Log.w(TAG, "stop discovery failed: err=$e") }
            override fun onServiceLost(s: NsdServiceInfo) { Log.i(TAG, "service lost: ${s.serviceName}") }
            override fun onServiceFound(s: NsdServiceInfo) {
                Log.i(TAG, "service found: '${s.serviceName}' type=${s.serviceType}")
                nsd.resolveService(s, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(si: NsdServiceInfo, e: Int) { Log.w(TAG, "resolve failed for '${si.serviceName}': err=$e") }
                    override fun onServiceResolved(si: NsdServiceInfo) {
                        val name = si.serviceName; val host = si.host?.hostAddress ?: return; val port = si.port
                        Log.i(TAG, "service resolved: '$name' -> $host:$port")
                        if (!seen.add("$host:$port")) return            // de-dup duplicate resolves
                        main.post { onResolved(name, host, port) }      // marshal to main
                    }
                })
            }
        }
        nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    }
    fun stop() {
        listener?.let { try { nsd.stopServiceDiscovery(it) } catch (_: Throwable) {} }; listener = null; seen.clear()
        releaseMulticast(lock); lock = null
    }
}
