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

    /** The on-device dir where journey screenshots + diag json are written, then pulled by the harness. */
    fun journeysDir(): File = File(instr.targetContext.getExternalFilesDir(null), "journeys").apply { mkdirs() }

    fun grantMic() = instr.uiAutomation.grantRuntimePermission(PKG, "android.permission.RECORD_AUDIO")

    /**
     * Grant notification-listener access so MediaMetadataService (a NotificationListenerService)
     * can enumerate MediaSessions for the now-playing view. Off by default and not a runtime
     * permission, so it must be enabled via `cmd notification allow_listener`. Runs as the shell
     * uid through uiAutomation, so this works on a local device AND on Firebase Test Lab (no host
     * adb needed). Draining the output ensures the command has run before we continue.
     */
    fun grantNotificationAccess() = toggleNotificationListener(allow = true)

    /** Revoke RECORD_AUDIO so the permission DIALOG reappears (used by the permission-UI test). */
    fun revokeMic() {
        try { instr.uiAutomation.revokeRuntimePermission(PKG, "android.permission.RECORD_AUDIO") } catch (_: Throwable) {}
    }

    /** Disable notification-listener access so the in-app grant FLOW can be tested from scratch. */
    fun revokeNotificationAccess() = toggleNotificationListener(allow = false)

    private fun toggleNotificationListener(allow: Boolean) {
        val verb = if (allow) "allow_listener" else "disallow_listener"
        val cmp = "$PKG/$PKG.MediaMetadataService"
        val pfd = instr.uiAutomation.executeShellCommand("cmd notification $verb $cmp")
        java.io.FileInputStream(pfd.fileDescriptor).bufferedReader().use { it.readText() }
    }

    /**
     * Stop any leftover capture before a journey. The capture foreground service
     * survives activity recreation (PiP / background capture), so a prior test's
     * capture leaks into the next one and a second AudioPlaybackCapture cannot
     * register its audio policy. Stopping the service (onDestroy releases the
     * AudioRecord + projection) clears it. Must NOT force-stop the app: the
     * instrumentation runs inside the app process and force-stop would kill the
     * test runner itself.
     *
     * CRITICAL: stopping the service out-of-band does NOT clear the plugin's
     * `isCapturing` flag (only stopCapture()/markStopped() do). If left set, the
     * next test's startCapture() early-returns as a no-op - no new MediaProjection
     * is requested - so that test captures SILENCE (Scope shows "can't capture,
     * DRM-protected"). markStopped() resets the flag so each test gets a genuinely
     * fresh capture. This is the root cause of system-capture passing alone but
     * failing later in a shared-process suite run.
     */
    fun resetApp() {
        val ctx = instr.targetContext
        try { ctx.stopService(android.content.Intent(ctx, AudioCaptureService::class.java)) } catch (_: Throwable) {}
        try { ScopeAudioPlugin.instance?.markStopped() } catch (_: Throwable) {}
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

    /**
     * Wait until the next WebView frame is committed to the activity's window
     * surface. Returns true if the paint-state callback fired within timeoutMs,
     * false otherwise. Used as the last gate before PixelCopy so the captured
     * bitmap reflects state induced just before this call (NOT a stale frame).
     */
    fun awaitFrameCommitted(s: ActivityScenario<MainActivity>, timeoutMs: Long = 3000L): Boolean {
        val latch = java.util.concurrent.CountDownLatch(1)
        val requestId = System.nanoTime()
        s.onActivity {
            val wv = (it as com.getcapacitor.BridgeActivity).bridge.webView
            wv.evaluateJavascript("0") { _ -> }
            wv.postVisualStateCallback(requestId, object : android.webkit.WebView.VisualStateCallback() {
                override fun onComplete(id: Long) { if (id == requestId) latch.countDown() }
            })
        }
        return latch.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
    }

    /** UiDevice.getCurrentPackageName via the public surface, named for clarity in plan call sites. */
    fun currentPackageOnTop(): String = device.currentPackageName ?: ""

    /**
     * Bring the Scope MainActivity back to the foreground via an explicit
     * Intent (REORDER_TO_FRONT + SINGLE_TOP), then wait until lifecycle reads
     * RESUMED and the top focused window belongs to our package. Returns true
     * on success, false if either condition is unmet within timeoutMs.
     *
     * Use this AFTER any system-settings excursion (notification-access page,
     * MediaProjection consent) or any pressBack/pressHome. Do NOT count pressBack
     * calls - Settings activity stack depth is OEM- and version-variable.
     */
    fun ensureForeground(s: ActivityScenario<MainActivity>, timeoutMs: Long = 8000L): Boolean {
        val ctx = instr.targetContext
        val launchIntent = ctx.packageManager.getLaunchIntentForPackage(PKG)
        if (launchIntent != null) {
            launchIntent.addFlags(
                android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    android.content.Intent.FLAG_ACTIVITY_NEW_TASK
            )
            try { ctx.startActivity(launchIntent) } catch (_: Throwable) { tryShellAmStart() }
        } else {
            tryShellAmStart()
        }
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            var state: androidx.lifecycle.Lifecycle.State = androidx.lifecycle.Lifecycle.State.DESTROYED
            try { s.onActivity { state = it.lifecycle.currentState } } catch (_: Throwable) {}
            val top = currentPackageOnTop()
            if (state == androidx.lifecycle.Lifecycle.State.RESUMED && top == PKG) return true
            Thread.sleep(150)
        }
        return false
    }

    /** Shell uid fallback: bypasses all activity-start restrictions. Used only
     *  if the in-process Context.startActivity raises (some OEM API 34+ builds). */
    private fun tryShellAmStart() {
        try {
            val pfd = instr.uiAutomation.executeShellCommand("am start -n $PKG/.MainActivity")
            java.io.FileInputStream(pfd.fileDescriptor).bufferedReader().use { it.readText() }
        } catch (_: Throwable) {}
    }

    /**
     * Capture the activity's Window (which includes the WebView's hardware-
     * composited content) via PixelCopy. PixelCopy reads ONLY the requested
     * window's surface, so system dialogs (MediaProjection consent,
     * notification-access prompt) that live in separate system windows are
     * automatically excluded - a defining advantage over UiDevice.takeScreenshot
     * (whole physical screen).
     *
     * Returns null on PixelCopy failure (e.g. activity destroyed mid-call).
     * Caller is expected to have already established the gates (RESUMED,
     * frame committed, no foreign window on top).
     */
    fun pixelCopyWindow(s: ActivityScenario<MainActivity>): android.graphics.Bitmap? {
        val latch = java.util.concurrent.CountDownLatch(1)
        val out = arrayOfNulls<android.graphics.Bitmap>(1)
        s.onActivity { act ->
            // AOSP PixelCopy Javadoc: copying from a Window requires a non-null
            // DecorView that has drawn at least once. Guard explicitly: if
            // peekDecorView is null or the decor is not yet attached/laid-out,
            // bail; the caller's gate loop must re-poll.
            val window = act.window
            val decor = window.peekDecorView()
            if (decor == null || !decor.isAttachedToWindow || decor.width == 0 || decor.height == 0) {
                latch.countDown()
                return@onActivity
            }
            val bmp = android.graphics.Bitmap.createBitmap(decor.width, decor.height, android.graphics.Bitmap.Config.ARGB_8888)
            android.view.PixelCopy.request(
                window, bmp, { rc ->
                    if (rc == android.view.PixelCopy.SUCCESS) out[0] = bmp else bmp.recycle()
                    latch.countDown()
                },
                android.os.Handler(android.os.Looper.getMainLooper()),
            )
        }
        latch.await(4, java.util.concurrent.TimeUnit.SECONDS)
        return out[0]
    }

    /**
     * Fused gate + screenshot. Returns ShotResult.Success only if ALL gates
     * pass within timeoutMs:
     *   1. Activity lifecycle is RESUMED.
     *   2. Top focused window belongs to PKG.
     *   3. WebView's next visual state callback fires (frame committed).
     *   4. DOM predicate (jsPredicate) evaluates to the literal string "true".
     * On any gate failure, returns ShotResult.Failure with a reason and writes
     * a diag.json sidecar; the test caller is expected to fail loudly.
     *
     * If ensureForegroundFirst is true (default), the helper calls
     * ensureForeground() before the gates. Set false to deliberately test
     * the gate's ability to detect backgrounded state.
     */
    fun proveScopeState(
        s: ActivityScenario<MainActivity>,
        name: String,
        jsPredicate: String,
        timeoutMs: Long = 8000L,
        ensureForegroundFirst: Boolean = true,
    ): ShotResult {
        val started = System.currentTimeMillis()
        val deadline = started + timeoutMs
        if (ensureForegroundFirst) ensureForeground(s, timeoutMs = 5000)
        var lifecycleState = "UNKNOWN"
        var topPackage = ""
        var focusedWindow = ""
        var paintOk = false
        var predicateValue: String? = null
        var reason: String? = null

        while (System.currentTimeMillis() < deadline) {
            try { s.onActivity { lifecycleState = it.lifecycle.currentState.name } } catch (_: Throwable) {}
            topPackage = currentPackageOnTop()
            if (lifecycleState != "RESUMED") { reason = "activity not RESUMED (got $lifecycleState)"; Thread.sleep(150); continue }
            if (topPackage != PKG) { reason = "foreign window on top: $topPackage"; Thread.sleep(150); continue }
            predicateValue = eval(s, jsPredicate)
            if (predicateValue != "true") { reason = "DOM predicate false (got $predicateValue)"; Thread.sleep(150); continue }
            paintOk = awaitFrameCommitted(s, timeoutMs = 2000)
            if (!paintOk) { reason = "WebView frame not committed within 2000ms"; Thread.sleep(150); continue }
            reason = null
            break
        }
        // Diagnostic-only field: capture ONCE after the gate loop (not per-iteration), so a slow
        // `dumpsys window` on a loaded CI/FTL VM cannot eat the retry budget. It reflects the final
        // state at the gate decision (or at deadline on failure), which is what a postmortem wants.
        focusedWindow = focusedWindowFromDumpsys()

        val dir = java.io.File(instr.targetContext.getExternalFilesDir(null), "journeys").apply { mkdirs() }
        val pngFile = java.io.File(dir, "$name.png")
        val diagFile = java.io.File(dir, "$name.diag.json")
        val wasGated = (reason == null)
        val diag = GatingDiagnostics(
            shotName = name,
            lifecycleState = lifecycleState,
            currentPackage = topPackage,
            focusedWindow = focusedWindow,
            paintLatchSignaled = paintOk,
            domPredicate = jsPredicate,
            domPredicateValue = predicateValue,
            wasGated = wasGated,
            failureReason = reason,
            timestampMs = System.currentTimeMillis(),
        )

        // Write the sidecar only after the PixelCopy outcome is known, so the on-disk diagnostics
        // never claim wasGated=true for a shot whose PNG was never produced (PixelCopy null path).
        if (!wasGated) { diagFile.writeText(diag.toJsonString()); return ShotResult.Failure(reason ?: "unknown gate failure", diag) }
        val bmp = pixelCopyWindow(s)
        if (bmp == null) {
            val failDiag = diag.copy(failureReason = "PixelCopy returned null", wasGated = false)
            diagFile.writeText(failDiag.toJsonString())
            return ShotResult.Failure("PixelCopy returned null", failDiag)
        }
        java.io.FileOutputStream(pngFile).use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        diagFile.writeText(diag.toJsonString())
        return ShotResult.Success(pngFile, diag)
    }

    private fun focusedWindowFromDumpsys(): String {
        // Diagnostic-only field for the .diag.json postmortem (the gate itself uses
        // currentPackageOnTop). executeShellCommand runs the binary directly with NO
        // shell, so a `| grep` pipe is passed as literal args and fails - filter the
        // dumpsys output in-process instead.
        return try {
            val pfd = instr.uiAutomation.executeShellCommand("dumpsys window")
            val text = java.io.FileInputStream(pfd.fileDescriptor).bufferedReader().use { it.readText() }
            val line = text.lineSequence().firstOrNull { it.contains("mCurrentFocus") }
                ?: text.lineSequence().firstOrNull { it.contains("mFocusedApp") }
                ?: ""
            // The focus line reads like: mCurrentFocus=Window{<hash> u0 com.alpapan.scope/.MainActivity}
            // so `u0 (<token>)` captures the package/activity (or the raw line if the shape differs).
            val m = Regex("u0 ([^ }]+)").find(line)
            m?.groupValues?.get(1) ?: line.trim()
        } catch (_: Throwable) { "" }
    }

    /**
     * Screenshot a SYSTEM dialog (the dialog itself is the asserted state).
     * Gates: a UI object with byResId must exist within timeoutMs. Since
     * PixelCopy of the Scope window will NOT see the dialog (it lives in a
     * separate system window), this primitive falls back to UiDevice.takeScreenshot
     * BUT only after explicitly confirming via UiAutomator that the dialog is
     * present. The diag.json records which dialog id was matched.
     */
    fun proveDialogState(
        name: String,
        byResId: String,        // "pkg:id/elem"
        timeoutMs: Long = 6000L,
    ): ShotResult {
        val (pkg, id) = byResId.split(":id/")
        val seen = device.wait(Until.hasObject(By.res(pkg, id)), timeoutMs)
        val topPackage = currentPackageOnTop()
        val focusedWindow = focusedWindowFromDumpsys()
        val dir = java.io.File(instr.targetContext.getExternalFilesDir(null), "journeys").apply { mkdirs() }
        val pngFile = java.io.File(dir, "$name.png")
        val diagFile = java.io.File(dir, "$name.diag.json")
        val diag = GatingDiagnostics(
            shotName = name,
            lifecycleState = "N/A (dialog)",
            currentPackage = topPackage,
            focusedWindow = focusedWindow,
            paintLatchSignaled = false,
            domPredicate = byResId,
            domPredicateValue = if (seen) "present" else "absent",
            wasGated = seen,
            failureReason = if (seen) null else "dialog $byResId never appeared",
            timestampMs = System.currentTimeMillis(),
        )
        diagFile.writeText(diag.toJsonString())
        if (!seen) return ShotResult.Failure("dialog $byResId never appeared", diag)
        device.takeScreenshot(pngFile)
        return ShotResult.Success(pngFile, diag)
    }

    /**
     * Variant of proveScopeState that ALSO requires the activity to be in PiP
     * mode. lifecycle.currentState may report STARTED (not RESUMED) in PiP,
     * which the regular proveScopeState rejects - so this is a separate gate.
     */
    fun proveScopePipState(
        s: ActivityScenario<MainActivity>,
        name: String,
        timeoutMs: Long = 6000L,
    ): ShotResult {
        val deadline = System.currentTimeMillis() + timeoutMs
        var inPip = false
        while (System.currentTimeMillis() < deadline && !inPip) {
            try { s.onActivity { inPip = it.isInPictureInPictureMode } } catch (_: Throwable) {}
            if (!inPip) Thread.sleep(200)
        }
        val dir = java.io.File(instr.targetContext.getExternalFilesDir(null), "journeys").apply { mkdirs() }
        val diagFile = java.io.File(dir, "$name.diag.json")
        val diag = GatingDiagnostics(
            shotName = name, lifecycleState = if (inPip) "STARTED (PiP)" else "NOT_IN_PIP",
            currentPackage = currentPackageOnTop(), focusedWindow = focusedWindowFromDumpsys(),
            paintLatchSignaled = false, domPredicate = "isInPictureInPictureMode", domPredicateValue = inPip.toString(),
            wasGated = inPip, failureReason = if (inPip) null else "activity did not enter PiP",
            timestampMs = System.currentTimeMillis(),
        )
        // Write the sidecar only after the PixelCopy outcome is known (see proveScopeState).
        if (!inPip) { diagFile.writeText(diag.toJsonString()); return ShotResult.Failure("activity did not enter PiP", diag) }
        val bmp = pixelCopyWindow(s)
        if (bmp == null) {
            val failDiag = diag.copy(failureReason = "PixelCopy returned null in PiP", wasGated = false)
            diagFile.writeText(failDiag.toJsonString())
            return ShotResult.Failure("PixelCopy returned null in PiP", failDiag)
        }
        val pngFile = java.io.File(dir, "$name.png")
        java.io.FileOutputStream(pngFile).use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        diagFile.writeText(diag.toJsonString())
        return ShotResult.Success(pngFile, diag)
    }

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

    /**
     * Play a looping USAGE_MEDIA tone from the androidTest asset (a small compressed OGG) so the
     * system-audio capture has a real signal to pick up. ToneGenerator's output is not reliably
     * captured on physical devices; a MediaPlayer with explicit USAGE_MEDIA routes through the
     * normal media path the capture taps. Caller must stop()/release() the returned player.
     */
    fun startMediaTone(): android.media.MediaPlayer {
        // Force the media stream audible - devices can boot with STREAM_MUSIC at 0, which would
        // leave the tone silent (nothing for the capture, and the mic would pick up only the room).
        try {
            val am = instr.targetContext.getSystemService(android.media.AudioManager::class.java)
            am.setStreamVolume(
                android.media.AudioManager.STREAM_MUSIC,
                am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC),
                0,
            )
        } catch (_: Throwable) {}
        val afd = instr.context.assets.openFd("test-tone.ogg")
        return android.media.MediaPlayer().apply {
            setAudioAttributes(
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            afd.close()
            isLooping = true
            setVolume(1f, 1f)
            prepare()
            start()
        }
    }

    /** Click the system-capture button and accept consent (best-effort on emulators that auto-grant). Returns when capture is active. */
    fun startSystemCapture(s: ActivityScenario<MainActivity>) {
        clickId(s, "mobile-capture")
        tapDialog("android:id/button1", 6000)
        assertJs(s, "document.getElementById('mobile-start').hidden === true")
    }

    /** Click the mic-capture button (RECORD_AUDIO pre-granted in setup, so the dialog is optional). Returns when capture is active. */
    fun startMicCapture(s: ActivityScenario<MainActivity>) {
        clickId(s, "mobile-capture-mic")
        tapDialog("com.android.permissioncontroller:id/permission_allow_foreground_only_button", 3000)
        assertJs(s, "document.getElementById('mobile-start').hidden === true")
    }

    fun currentView(s: ActivityScenario<MainActivity>): String =
        eval(s, "(document.getElementById('mobile-view')||{}).value || ''")

    /** Cycle the view with window.cycleView until it reads [target]; throws if unreachable. */
    fun cycleToView(s: ActivityScenario<MainActivity>, target: String) {
        var i = 0
        while (i++ < 15 && currentView(s) != target) {
            eval(s, "window.cycleView && window.cycleView(1); 'ok'")
            Thread.sleep(400)
        }
        check(currentView(s) == target) { "could not reach view '$target' (stuck at '${currentView(s)}')" }
    }

    fun openDrawer(s: ActivityScenario<MainActivity>) {
        eval(s, "document.body.classList.add('drawer-open'); 'ok'")
        assertJs(s, "document.getElementById('mobile-drawer').getBoundingClientRect().bottom > 50")
    }

    fun closeDrawer(s: ActivityScenario<MainActivity>) {
        eval(s, "document.body.classList.remove('drawer-open'); 'ok'")
    }

    /** Set a range/input's value and fire the 'input' event so the wired listener runs. */
    fun setRange(s: ActivityScenario<MainActivity>, id: String, value: String) {
        eval(s, "var e=document.getElementById('$id'); e.value='$value'; e.dispatchEvent(new Event('input',{bubbles:true})); 'ok'")
    }

    /** Read the active generic palette chip's data-theme, or 'sns' if the exclusive chip is active, else ''. */
    fun currentTheme(s: ActivityScenario<MainActivity>): String =
        eval(s, "(function(){var c=document.querySelector('#mobile-theme-chips .chip.active'); if(c) return c.dataset.theme; var x=document.getElementById('mobile-sns-chip'); return (x&&x.classList.contains('active'))?'sns':'';})()")

    // Gesture drivers. Primary path = synthetic touch events on #stage (the only
    // <canvas>, wired in main.js wireGestures). The JS feature-detects the
    // Touch/TouchEvent constructors and returns 'nosupport' if absent (older WebView);
    // the Kotlin helper then falls back to a native UIAutomator gesture at the screen
    // centre. Coordinates always derive from the canvas rect / display size.

    /** Tap the canvas once (single-tap -> palette cycle after the 300ms window). */
    fun tapCanvas(s: ActivityScenario<MainActivity>) {
        if (eval(s, TAP_JS) != "ok") { android.util.Log.v(LOG, "tap: JS touch unsupported, native fallback"); nativeTap() }
    }

    /** Double-tap the canvas (-> view cycle). JS path dispatches both taps in one atomic eval so the 300ms window is guaranteed; the native fallback may miss it on slow devices. */
    fun doubleTapCanvas(s: ActivityScenario<MainActivity>) {
        if (eval(s, DOUBLE_TAP_JS) != "ok") { android.util.Log.v(LOG, "doubletap: JS touch unsupported, native fallback"); nativeTap(); nativeTap() }
    }

    /** Swipe down on the canvas (-> drawer opens). */
    fun swipeDownCanvas(s: ActivityScenario<MainActivity>) {
        if (eval(s, SWIPE_DOWN_JS) != "ok") { android.util.Log.v(LOG, "swipe: JS touch unsupported, native fallback"); nativeSwipeDown() }
    }

    private const val LOG = "ScopeTest"
    private fun nativeTap() { device.click(device.displayWidth / 2, device.displayHeight / 2) }
    private fun nativeSwipeDown() {
        val cx = device.displayWidth / 2
        device.swipe(cx, (device.displayHeight * 0.30).toInt(), cx, (device.displayHeight * 0.70).toInt(), 20)
    }

    // swipe delta = 0.40 * canvas height; swipe-detector.js MIN_DISTANCE_PX = 40, so on
    // any device this is far above the tap/swipe threshold and unambiguously a swipe.
    private const val TAP_JS = """
        (function(){try{ if(typeof Touch!=='function'||typeof TouchEvent!=='function') return 'nosupport';
        var c=document.getElementById('stage'); var r=c.getBoundingClientRect();
        var x=r.left+r.width/2, y=r.top+r.height/2;
        function t(type){var tch=new Touch({identifier:1,target:c,clientX:x,clientY:y});
        c.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,changedTouches:[tch],targetTouches:[],touches:[]}));}
        t('touchstart'); t('touchend'); return 'ok';}catch(e){return 'nosupport';}})()
    """
    private const val DOUBLE_TAP_JS = """
        (function(){try{ if(typeof Touch!=='function'||typeof TouchEvent!=='function') return 'nosupport';
        var c=document.getElementById('stage'); var r=c.getBoundingClientRect();
        var x=r.left+r.width/2, y=r.top+r.height/2;
        function tap(){var s=new Touch({identifier:1,target:c,clientX:x,clientY:y});
        c.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,changedTouches:[s],targetTouches:[],touches:[]}));
        c.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,changedTouches:[s],targetTouches:[],touches:[]}));}
        tap(); tap(); return 'ok';}catch(e){return 'nosupport';}})()
    """
    private const val SWIPE_DOWN_JS = """
        (function(){try{ if(typeof Touch!=='function'||typeof TouchEvent!=='function') return 'nosupport';
        var c=document.getElementById('stage'); var r=c.getBoundingClientRect();
        var x=r.left+r.width/2, y0=r.top+r.height*0.30, y1=r.top+r.height*0.70;
        function t(type,y){var tch=new Touch({identifier:1,target:c,clientX:x,clientY:y});
        c.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,changedTouches:[tch],targetTouches:[],touches:[]}));}
        t('touchstart',y0); t('touchend',y1); return 'ok';}catch(e){return 'nosupport';}})()
    """
}
