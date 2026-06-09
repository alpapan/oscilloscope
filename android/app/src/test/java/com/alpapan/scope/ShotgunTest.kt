package com.alpapan.scope

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShotgunTest {
    @Test fun diagnostics_serialiseToJson_minimalFields() {
        val d = GatingDiagnostics(
            shotName = "view-01-waveform",
            lifecycleState = "RESUMED",
            currentPackage = "com.alpapan.scope",
            focusedWindow = "com.alpapan.scope/.MainActivity",
            paintLatchSignaled = true,
            domPredicate = "document.getElementById('mobile-view').value === 'waveform'",
            domPredicateValue = "true",
            wasGated = true,
            failureReason = null,
            timestampMs = 1717689600000L,
        )
        val json = d.toJsonString()
        assertTrue("contains shotName", json.contains("\"shotName\":\"view-01-waveform\""))
        assertTrue("contains wasGated", json.contains("\"wasGated\":true"))
        assertTrue("contains failureReason as null literal", json.contains("\"failureReason\":null"))
    }

    @Test fun shotResult_success_carriesPathAndDiagnostics() {
        val d = GatingDiagnostics("n", "RESUMED", "com.alpapan.scope", "com.alpapan.scope/.MainActivity", true, "true", "true", true, null, 1L)
        val r: ShotResult = ShotResult.Success(java.io.File("/tmp/n.png"), d)
        assertEquals("Success path", "/tmp/n.png", (r as ShotResult.Success).file.path)
        assertEquals("Success carries diagnostics", d, r.diagnostics)
    }

    @Test fun shotResult_failure_carriesReasonAndDiagnostics() {
        val d = GatingDiagnostics("n", "STOPPED", "com.android.launcher3", "com.android.launcher3/.LauncherActivity", false, null, null, false, "activity not RESUMED within deadline", 1L)
        val r: ShotResult = ShotResult.Failure("activity not RESUMED within deadline", d)
        assertEquals("activity not RESUMED within deadline", (r as ShotResult.Failure).reason)
    }
}
