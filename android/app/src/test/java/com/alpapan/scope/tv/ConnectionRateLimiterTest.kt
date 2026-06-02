package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test

class ConnectionRateLimiterTest {
    @Test fun blocksAfterBurst() {
        var now = 0L; val rl = ConnectionRateLimiter(maxPerWindow = 3, windowMs = 1000) { now }
        assertTrue(rl.allow("1.2.3.4")); assertTrue(rl.allow("1.2.3.4")); assertTrue(rl.allow("1.2.3.4"))
        assertFalse(rl.allow("1.2.3.4"))
    }
    @Test fun perSourceIndependent() {
        var now = 0L; val rl = ConnectionRateLimiter(maxPerWindow = 1, windowMs = 1000) { now }
        assertTrue(rl.allow("a")); assertFalse(rl.allow("a"))
        assertTrue(rl.allow("b"))
    }
    @Test fun windowResets() {
        var now = 0L; val rl = ConnectionRateLimiter(maxPerWindow = 1, windowMs = 1000) { now }
        assertTrue(rl.allow("a")); assertFalse(rl.allow("a"))
        now = 1001; assertTrue(rl.allow("a"))
    }
    @Test fun mapDoesNotGrowUnbounded() {
        var now = 0L; val rl = ConnectionRateLimiter(maxPerWindow = 100, windowMs = 1000, maxSources = 8) { now }
        repeat(50) { rl.allow("src-$it") }     // 50 distinct sources, cap 8
        assertTrue("tracked sources must be capped", rl.trackedSources() <= 8)
    }
}
