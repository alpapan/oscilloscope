package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class ProveScopeStateTest {
    private lateinit var s: ActivityScenario<MainActivity>
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun proveScopeState_succeeds_whenForegroundAndPredicateTrue() {
        s = JourneySupport.launchReady()
        val result = JourneySupport.proveScopeState(s, "trivial-true", "1 === 1")
        assertTrue("result is Success", result is ShotResult.Success)
        val ok = result as ShotResult.Success
        assertTrue("PNG exists", ok.file.exists() && ok.file.length() > 0)
        val diag = File(ok.file.parentFile, ok.file.nameWithoutExtension + ".diag.json")
        assertTrue("diag.json exists", diag.exists())
        assertTrue("diag includes wasGated true", diag.readText().contains("\"wasGated\":true"))
    }

    @Test fun proveScopeState_fails_whenBackgrounded() {
        s = JourneySupport.launchReady()
        JourneySupport.device.pressHome()
        Thread.sleep(500)
        val result = JourneySupport.proveScopeState(s, "while-backgrounded", "1 === 1", ensureForegroundFirst = false)
        assertTrue("result is Failure when backgrounded and we DO NOT re-foreground", result is ShotResult.Failure)
        val fail = result as ShotResult.Failure
        assertEquals("reason names the gate that failed", true, fail.reason.contains("RESUMED") || fail.reason.contains("foreign"))
    }

    @Test fun proveScopeState_fails_whenPredicateFalse() {
        s = JourneySupport.launchReady()
        val result = JourneySupport.proveScopeState(s, "false-predicate", "1 === 2", timeoutMs = 1500)
        assertTrue("result is Failure on false predicate", result is ShotResult.Failure)
        val diag = File((result as ShotResult.Failure).diagnostics.let { File("/sdcard/Android/data/com.alpapan.scope/files/journeys") }, "false-predicate.diag.json")
        // Even on failure, the diag.json should be written so postmortem is possible.
        assertTrue("diag.json written on failure", diag.exists())
    }
}
