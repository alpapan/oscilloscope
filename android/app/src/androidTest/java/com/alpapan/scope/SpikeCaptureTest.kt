package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SpikeCaptureTest {
    private val instr get() = InstrumentationRegistry.getInstrumentation()
    private val device get() = UiDevice.getInstance(instr)
    private lateinit var s: ActivityScenario<MainActivity>

    // clean process + pre-granted RECORD_AUDIO so only the MediaProjection consent appears
    @Before fun setup() { JourneySupport.resetApp(); JourneySupport.grantMic() }
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun captureStartsFromWebViewButton() {
        s = ActivityScenario.launch(MainActivity::class.java)
        // Android wires mobile-capture.onclick during init (main.js); the start
        // screen is mobile-start, not the desktop-only start-screen. Wait for the
        // handler so the click actually triggers startCapture.
        val ready = "typeof (document.getElementById('mobile-capture')||{}).onclick === 'function'"
        val deadline = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < deadline && JourneySupport.eval(s, ready) != "true") Thread.sleep(250)
        assertEquals("true", JourneySupport.eval(s, ready))
        // drive the WebView button, then accept the system consent dialog
        JourneySupport.eval(s, "document.getElementById('mobile-capture').click(); 'ok'")
        val btn = device.wait(Until.findObject(By.res("android", "button1")), 8000)
        requireNotNull(btn) { "MediaProjection consent button1 did not appear" }.click()
        // capture active => mobile-start hidden (main.js sets hidden=true on success)
        device.wait(Until.gone(By.res("android", "button1")), 8000)
        val active = "document.getElementById('mobile-start').hidden === true"
        val deadline2 = System.currentTimeMillis() + 8000
        while (System.currentTimeMillis() < deadline2 && JourneySupport.eval(s, active) != "true") Thread.sleep(250)
        assertEquals("true", JourneySupport.eval(s, active))
    }
}
