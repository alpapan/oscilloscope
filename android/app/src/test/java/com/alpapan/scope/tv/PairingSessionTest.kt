package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
class PairingSessionTest {
    @Test fun initial_code_from_generator() { assertEquals("123456", PairingSession { "123456" }.code) }
    @Test fun rotateChangesCodeWithinSpace() {
        val seq = ArrayDeque(listOf("111111","222222")); val s = PairingSession { seq.removeFirst() }
        assertEquals("111111", s.code); s.rotate(); assertEquals("222222", s.code)
    }
}
