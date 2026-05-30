package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test
class PairingCodeTest {
    @Test fun code_is_four_digits() { repeat(50){ assertTrue(Regex("^\\d{4}$").matches(PairingCode.generate())) } }
    @Test fun verify_exact_match() { assertTrue(PairingCode.verify("1234","1234")) }
    @Test fun verify_rejects_mismatch_ws_len_empty() {
        assertFalse(PairingCode.verify("1234","1235")); assertFalse(PairingCode.verify("1234"," 1234"))
        assertFalse(PairingCode.verify("1234","123")); assertFalse(PairingCode.verify("1234","12345"))
        assertFalse(PairingCode.verify("1234","")); assertFalse(PairingCode.verify("","1234"))
    }
}
