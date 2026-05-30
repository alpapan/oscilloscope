package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger
class PairingSessionTest {
    @Test fun initial_code_from_generator() { assertEquals("1234", PairingSession { "1234" }.code) }
    @Test fun correct_attempt_keeps_code() {
        val s = PairingSession { "1234" }; assertTrue(s.attempt("1234")); assertEquals("1234", s.code)
    }
    @Test fun wrong_attempt_rotates_and_invalidates_old() {
        val seq = ArrayDeque(listOf("1111","2222","3333")); val s = PairingSession { seq.removeFirst() }
        assertFalse(s.attempt("0000")); assertEquals("2222", s.code)
        assertFalse(s.attempt("1111")); assertEquals("3333", s.code)  // old code now useless
    }
    // v2 review S2: concurrent wrong attempts must each rotate exactly once and
    // leave `code` equal to the last value the (serialized) generator produced.
    // With @Synchronized the read-verify-rotate is atomic, so for the correct
    // implementation this is deterministic; a non-synchronized impl can lose the
    // last update and end on a stale code.
    @Test fun concurrent_wrong_attempts_rotate_consistently() {
        val counter = AtomicInteger(0)
        val s = PairingSession { String.format("%04d", counter.getAndIncrement()) } // initial -> "0000", counter now 1
        val k = 64
        val threads = (1..k).map { Thread { assertFalse(s.attempt("ZZZZ")) } }
        threads.forEach { it.start() }; threads.forEach { it.join() }
        assertEquals(k + 1, counter.get())                 // 1 initial + k rotations, no double/skip
        assertEquals(String.format("%04d", k), s.code)     // ends on the last generated value
    }
}
