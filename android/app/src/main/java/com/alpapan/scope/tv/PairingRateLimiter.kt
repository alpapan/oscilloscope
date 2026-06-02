package com.alpapan.scope.tv

// Failed-attempt lockout: after maxFailures failed pair attempts, deny new
// attempts for lockoutMs. A success resets the counter. Clock injected so the
// lockout window is deterministic in tests.
class PairingRateLimiter(
    private val maxFailures: Int = 5,
    private val lockoutMs: Long = 30_000,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    @Volatile private var failures = 0
    @Volatile private var lockedUntil = 0L
    @Synchronized fun allow(): Boolean = clock() >= lockedUntil
    @Synchronized fun onFailure() {
        failures++
        if (failures >= maxFailures) { lockedUntil = clock() + lockoutMs; failures = 0 }
    }
    @Synchronized fun onSuccess() { failures = 0; lockedUntil = 0 }
}
