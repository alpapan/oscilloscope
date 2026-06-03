package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.getcapacitor.BridgeActivity
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object JourneySupport {
    const val PKG = "com.alpapan.scope"
    private val instr get() = InstrumentationRegistry.getInstrumentation()
    val device: UiDevice get() = UiDevice.getInstance(instr)

    fun grantMic() = instr.uiAutomation.grantRuntimePermission(PKG, "android.permission.RECORD_AUDIO")

    /**
     * Stop any leftover capture before a journey. The capture foreground service
     * survives activity recreation (PiP / background capture), so a prior test's
     * capture leaks into the next one and a second AudioPlaybackCapture cannot
     * register its audio policy. Stopping the service (onDestroy releases the
     * AudioRecord + projection) clears it. Must NOT force-stop the app: the
     * instrumentation runs inside the app process and force-stop would kill the
     * test runner itself.
     */
    fun resetApp() {
        val ctx = instr.targetContext
        try { ctx.stopService(android.content.Intent(ctx, AudioCaptureService::class.java)) } catch (_: Throwable) {}
        val deadline = System.currentTimeMillis() + 6000
        while (System.currentTimeMillis() < deadline && isForegroundService(".AudioCaptureService")) Thread.sleep(200)
    }

    fun launchReady(): ActivityScenario<MainActivity> {
        val s = ActivityScenario.launch(MainActivity::class.java)
        // The Android boot path wires mobile-capture.onclick during main.js init
        // (after async getFormFactor). Wait for the handler so a click actually
        // triggers startCapture; start-screen is the desktop-only card and stays
        // hidden on mobile, so it is not a usable readiness signal.
        val ready = "typeof (document.getElementById('mobile-capture')||{}).onclick === 'function'"
        val deadline = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < deadline && eval(s, ready) != "true") Thread.sleep(250)
        check(eval(s, ready) == "true") { "mobile-capture handler never wired (app init did not complete)" }
        return s
    }

    fun eval(s: ActivityScenario<MainActivity>, js: String): String {
        val latch = CountDownLatch(1); val out = arrayOfNulls<String>(1)
        s.onActivity { (it as BridgeActivity).bridge.webView.evaluateJavascript(js) { v -> out[0] = v; latch.countDown() } }
        latch.await(10, TimeUnit.SECONDS)
        return (out[0] ?: "null").trim('"')
    }

    /** Poll a JS boolean expr until true or timeout; returns the final value. */
    fun waitJs(s: ActivityScenario<MainActivity>, js: String, timeoutMs: Long = 8000): String {
        val deadline = System.currentTimeMillis() + timeoutMs
        var v = eval(s, js)
        while (v != "true" && System.currentTimeMillis() < deadline) { Thread.sleep(200); v = eval(s, js) }
        return v
    }

    fun assertJs(s: ActivityScenario<MainActivity>, js: String) =
        check(waitJs(s, js) == "true") { "JS expr not true: $js" }

    fun clickId(s: ActivityScenario<MainActivity>, id: String) =
        eval(s, "document.getElementById('$id').click(); 'ok'")

    /** Tap a native-dialog button by "pkg:id/name"; returns false if it never appears (optional dialogs). */
    fun tapDialog(resId: String, timeoutMs: Long = 6000): Boolean {
        val (pkg, id) = resId.split(":id/")
        val o = device.wait(Until.findObject(By.res(pkg, id)), timeoutMs) ?: return false
        o.click(); return true
    }

    /** dumpsys-based foreground-service check (getRunningServices is restricted post-O). */
    fun isForegroundService(shortName: String): Boolean {
        val pfd = instr.uiAutomation.executeShellCommand("dumpsys activity services $PKG")
        val text = java.io.FileInputStream(pfd.fileDescriptor).bufferedReader().use { it.readText() }
        val re = Regex("$PKG/${Regex.escape(shortName)}[\\s\\S]*?isForeground=true")
        return re.containsMatchIn(text)
    }

    fun shot(name: String) {
        // Write under getExternalFilesDir(): the framework guarantees this per-app
        // dir exists on every API. A raw File("/sdcard/Android/...") mkdirs is denied
        // on a cold app (notably API 34), so the screenshot silently fails to land.
        // additionalTestOutputDir is pointed at this same device path so AGP pulls it
        // into build/outputs/managed_device_android_test_additional_output/<device>/.
        val dir = File(instr.targetContext.getExternalFilesDir(null), "journeys").apply { mkdirs() }
        device.takeScreenshot(File(dir, "$name.png"))
    }
}
