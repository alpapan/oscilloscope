package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
class PairingCodeTest {
    @Test fun generatesSixDigits() {
        repeat(200) { val c = PairingCode.generate(); assertEquals(6, c.length); assertTrue(c.all { ch -> ch.isDigit() }) }
    }
    @Test fun verifyRejectsWrongLength() {
        assertFalse(PairingCode.verify("123456", "12345"))
        assertTrue(PairingCode.verify("000123", "000123"))
    }
    @Test fun verify_exact_match() { assertTrue(PairingCode.verify("1234","1234")) }
    @Test fun verify_rejects_mismatch_ws_len_empty() {
        assertFalse(PairingCode.verify("1234","1235")); assertFalse(PairingCode.verify("1234"," 1234"))
        assertFalse(PairingCode.verify("1234","123")); assertFalse(PairingCode.verify("1234","12345"))
        assertFalse(PairingCode.verify("1234","")); assertFalse(PairingCode.verify("","1234"))
    }
}
