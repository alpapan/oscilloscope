package com.alpapan.scope.tv

// Per-source-IP connection throttle: at most maxPerWindow new connections per
// source per windowMs. Clock injected for determinism.
class ConnectionRateLimiter(
    private val maxPerWindow: Int = 10,
    private val windowMs: Long = 10_000,
    private val maxSources: Int = 1024,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private data class Bucket(var windowStart: Long, var count: Int)
    // accessOrder=true LinkedHashMap = LRU; removeEldestEntry caps memory so an
    // attacker cannot grow the map without bound (defence-in-depth; TCP can't be
    // IP-spoofed without a return path, so real sources are LAN-bounded anyway).
    private val buckets = object : LinkedHashMap<String, Bucket>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: Map.Entry<String, Bucket>) = size > maxSources
    }
    @Synchronized fun allow(source: String): Boolean {
        val now = clock()
        val b = buckets.getOrPut(source) { Bucket(now, 0) }
        if (now - b.windowStart >= windowMs) { b.windowStart = now; b.count = 0 }
        if (b.count >= maxPerWindow) return false
        b.count++; return true
    }
    @Synchronized fun trackedSources(): Int = buckets.size
}
