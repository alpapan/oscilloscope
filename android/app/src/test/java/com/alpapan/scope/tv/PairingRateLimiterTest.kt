package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test

class PairingRateLimiterTest {
    @Test fun allowsUntilThreshold() {
        var now = 0L; val rl = PairingRateLimiter(maxFailures = 3, lockoutMs = 1000) { now }
        assertTrue(rl.allow()); rl.onFailure()
        assertTrue(rl.allow()); rl.onFailure()
        assertTrue(rl.allow()); rl.onFailure()
        assertFalse(rl.allow())                 // 3 failures -> locked
    }
    @Test fun lockoutExpires() {
        var now = 0L; val rl = PairingRateLimiter(maxFailures = 1, lockoutMs = 1000) { now }
        rl.onFailure(); assertFalse(rl.allow())
        now = 1001; assertTrue(rl.allow())
    }
    @Test fun successResets() {
        var now = 0L; val rl = PairingRateLimiter(maxFailures = 2, lockoutMs = 1000) { now }
        rl.onFailure(); rl.onSuccess()
        rl.onFailure(); assertTrue(rl.allow())  // counter reset by success
    }
}
