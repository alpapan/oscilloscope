package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiScrollable
import androidx.test.uiautomator.UiSelector
import androidx.test.uiautomator.Until
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Exercises the real permission-grant UI a user goes through, rather than pre-granting via shell:
 *  - RECORD_AUDIO via the runtime permission dialog ("Allow"),
 *  - MediaProjection via the system consent dialog ("Start now"),
 *  - notification-listener access via the in-app "Grant access" button -> system settings toggle.
 * Permissions are revoked in setup so each grant flow runs from scratch regardless of test order.
 */
@RunWith(AndroidJUnit4::class)
class PermissionGrantTest {
    private lateinit var s: ActivityScenario<MainActivity>
    private val device get() = JourneySupport.device

    @Before fun setup() {
        JourneySupport.resetApp()
        JourneySupport.revokeMic()
        JourneySupport.revokeNotificationAccess()
    }
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun micPermissionGrantedViaDialog() {
        s = JourneySupport.launchReady()
        // Mic capture requests RECORD_AUDIO; the dialog appears because we revoked it in setup.
        JourneySupport.clickId(s, "mobile-capture-mic")
        // The runtime dialog MUST appear and be clicked - requireNotNull means no false pass if the
        // permission was somehow already granted (dialog absent).
        // proveDialogState already waits for the dialog (Until.hasObject) and screenshots it, so it
        // owns the appearance gate - don't pre-wait for the same element. After it confirms present,
        // a short findObject wait gets a fresh clickable handle.
        check(JourneySupport.proveDialogState("perm-01-mic-dialog", "com.android.permissioncontroller:id/permission_allow_foreground_only_button") is ShotResult.Success) {
            "RECORD_AUDIO permission dialog did not appear"
        }
        val allow = device.wait(Until.findObject(By.res("com.android.permissioncontroller", "permission_allow_foreground_only_button")), 2000)
        requireNotNull(allow) { "RECORD_AUDIO dialog vanished after it was confirmed present" }.click()
        JourneySupport.assertJs(s, "document.getElementById('mobile-start').hidden === true")
        // Confirm the permission actually flipped to granted, not just that capture reported success.
        val perm = device.executeShellCommand("dumpsys package ${JourneySupport.PKG} | grep RECORD_AUDIO")
        check(perm.contains("granted=true")) { "RECORD_AUDIO not granted after the dialog; dumpsys: $perm" }
        check(JourneySupport.proveScopeState(s, "perm-01-mic-granted", "document.getElementById('mobile-start').hidden === true") is ShotResult.Success)
    }

    @Test fun projectionConsentAcceptedViaDialog() {
        s = JourneySupport.launchReady()
        // System capture asks for MediaProjection consent ("Start now" == android:id/button1).
        JourneySupport.clickId(s, "mobile-capture")
        val allowed = JourneySupport.tapDialog("android:id/button1", 8000)
        check(allowed) { "MediaProjection consent dialog never appeared" }
        JourneySupport.assertJs(s, "document.getElementById('mobile-start').hidden === true")
        check(JourneySupport.proveScopeState(s, "perm-02-projection-granted", "document.getElementById('mobile-start').hidden === true") is ShotResult.Success)
    }

    @Test fun notificationAccessGrantedViaSettings() {
        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)          // running state so the now-playing card shows
        JourneySupport.cycleToView(s, "nowplaying")

        // Access is off, so the card offers a "Grant access" button (.np-grant in main.js).
        check(JourneySupport.proveScopeState(s, "perm-03-notif-prompt", "!!document.querySelector('.np-grant')") is ShotResult.Success)

        // Tapping it opens the system notification-access settings (a real Activity, leaving the WebView).
        JourneySupport.eval(s, "document.querySelector('.np-grant').click(); 'ok'")

        // Wait for the notification-access list to be up, then drive the real Settings UI to grant.
        // Capture stays running (the now-playing card needs state.running); Scope auto-PiPs to the
        // bottom-right when it backgrounds, which does not cover the (left-side) Scope row. The row
        // and toggle are driven with shell `input tap` coordinates (see tapCenter), which land
        // regardless of the PiP window.
        device.wait(Until.hasObject(By.scrollable(true)), 8000)
        enableScopeNotificationListenerInSettings()

        // The UI grant must actually flip the system setting - this is the authoritative gate.
        val enabled = device.executeShellCommand("settings get secure enabled_notification_listeners")
        check(enabled.contains("MediaMetadataService")) {
            "notification listener not enabled after the UI grant flow; got: $enabled"
        }

        // Return to the app (REORDER_TO_FRONT, not pressBack counting - Settings stack depth is
        // OEM-/version-variable), then confirm the grant prompt is now gone in the now-playing view.
        check(JourneySupport.ensureForeground(s, timeoutMs = 8000)) { "could not re-foreground Scope after Settings excursion" }
        JourneySupport.cycleToView(s, "waveform")
        JourneySupport.cycleToView(s, "nowplaying")
        check(JourneySupport.proveScopeState(s, "perm-04-notif-granted", "!document.querySelector('.np-grant')") is ShotResult.Success)
    }

    /**
     * Grant notification access through the real settings UI, then DESELECT all four category
     * checkboxes (Real-time / Conversations / Notifications / Silent). Granting access auto-selects
     * them, but Scope needs none - it reads media sessions via getActiveSessions, never delivered
     * notification content - so we turn them off to keep Scope's notification surface minimal, and
     * now-playing must still work afterwards. This Settings flow is OS-version / OEM specific, so the
     * toggle and category checkboxes are matched by stable framework resource ids in the android:
     * namespace rather than Settings-app-private ids, and the Allow confirm falls back to its text.
     */
    private fun enableScopeNotificationListenerInSettings() {
        try {
            enableScopeNotificationListenerInSettingsImpl()
        } catch (t: Throwable) {
            // DIAGNOSTIC (removed once the mechanism is chosen): the in-process reads fail at a
            // RANDOM site run-to-run under Scope's auto-PiP window, so probe on ANY failure rather
            // than one fixed spot, recording which read mechanism can see the row label + the detail
            // switch at the failing instant.
            runCatching { probeReadMechanisms() }
            throw t
        }
    }

    /** Record, for each of three read mechanisms, whether it can see the Scope row label and the
     *  detail-page switch at the moment a Settings-excursion read failed. */
    private fun probeReadMechanisms() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val label = ctx.applicationInfo.loadLabel(ctx.packageManager).toString()
        val dir = JourneySupport.journeysDir()
        val sb = StringBuilder()
        // (a) legacy UiObject/UiSelector query path (different from UiObject2 By):
        sb.append("legacyLabel=").append(runCatching { device.findObject(UiSelector().text(label)).exists() }.getOrDefault(false)).append('\n')
        sb.append("legacySwitch=").append(runCatching { device.findObject(UiSelector().resourceId("android:id/switch_widget")).exists() }.getOrDefault(false)).append('\n')
        // (b) shell uiautomator dump (SEPARATE process / separate UiAutomation connection):
        val shell = runCatching {
            device.executeShellCommand("uiautomator dump /sdcard/diag-shell.xml")
            device.executeShellCommand("cat /sdcard/diag-shell.xml")
        }.getOrDefault("")
        sb.append("shellLabel=").append(shell.contains("text=\"$label\"")).append('\n')
        sb.append("shellSwitch=").append(shell.contains("switch_widget")).append('\n')
        java.io.File(dir, "diag-shell-dump.xml").writeText(shell)
        // (c) in-process dumpWindowHierarchy (SAME connection as findObject):
        val inproc = runCatching {
            val f = java.io.File(dir, "diag-inproc-hier.xml"); device.dumpWindowHierarchy(f); f.readText()
        }.getOrDefault("")
        sb.append("inprocLabel=").append(inproc.contains("text=\"$label\"")).append('\n')
        sb.append("inprocSwitch=").append(inproc.contains("switch_widget")).append('\n')
        java.io.File(dir, "diag-mechanisms.txt").writeText(sb.toString())
        runCatching { device.takeScreenshot(java.io.File(dir, "diag-detail.png")) }
    }

    private fun enableScopeNotificationListenerInSettingsImpl() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val label = ctx.applicationInfo.loadLabel(ctx.packageManager).toString()
        // Drive the Settings UI with shell `input tap` (tapCenter), NOT UiObject2/UiDevice.click:
        // with Scope's auto-PiP window present, in-process UiAutomation taps do not navigate, while a
        // shell `input tap` at the same coordinates does (confirmed on-device). READ via legacy
        // UiObject (UiSelector / .exists() / .waitForExists()), NOT UiObject2 `By` + `Until.*`: under
        // the PiP window the UiObject2 live queries return false negatives (e.g. the onDetail switch
        // wait reporting absent while the toggle is plainly on screen), which spuriously re-ran the
        // row loop on the detail page; legacy UiObject reads are reliable on the Nokia (diag-proven).
        val switchSel = UiSelector().resourceId("android:id/switch_widget")
        var onDetail = false
        var attempt = 0
        while (!onDetail && attempt++ < 4) {
            // Already on the detail page? Then a prior pass navigated but its post-tap wait missed it -
            // break instead of re-tapping the (now off-screen) list row, which would throw "row not
            // found". The instant exists() check is reliable once the page settles (diag-proven), even
            // when the post-tap detail wait was not.
            if (device.findObject(switchSel).exists()) { onDetail = true; break }
            val list = UiScrollable(UiSelector().scrollable(true)).apply { setAsVerticalList() }
            val found = try { list.scrollIntoView(UiSelector().text(label)) } catch (_: Throwable) { false }
            check(found) { "could not scroll to '$label' in the notification-access list" }
            // Match the Settings list-row title (android:id/title) specifically, not a bare text
            // match: Scope's own auto-PiP WebView exposes its window title "$label" as a node, so an
            // unscoped match taps the PiP window instead of the row and the detail page never opens.
            val row = device.findObject(UiSelector().resourceId("android:id/title").text(label))
            check(row.exists()) { "'$label' row not found after scroll" }
            tapCenter(row)
            // Poll for the detail page via the reliable instant exists() check: both UiObject2
            // Until.* and legacy waitForExists return false negatives right after navigation under the
            // PiP window (re-querying a fresh handle each pass avoids that), so do not gate on them.
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline && !device.findObject(switchSel).exists()) Thread.sleep(200)
            onDetail = device.findObject(switchSel).exists()
        }
        check(onDetail) { "notification-access detail page did not open after $attempt row-tap attempts" }
        // Detail page: flip the "Allow notification access" toggle on (framework switch id
        // android:id/switch_widget; fall back to the Switch class). Guard on its checked state so a
        // re-run that finds it already on does not toggle it back off.
        var toggle = device.findObject(switchSel)
        if (!toggle.exists()) toggle = device.findObject(UiSelector().className("android.widget.Switch"))
        check(toggle.exists()) { "'Allow notification access' toggle not found on the detail page" }
        if (!toggle.isChecked) {
            tapCenter(toggle)
            // Confirmation dialog ("Allow notification access for $label?") -> Allow. waitForExists
            // polls up to 5s for an "Allow" text node (OEM-portable); if it never appears, fall back
            // to a Settings-scoped allow_button id.
            var allow = device.findObject(UiSelector().text("Allow"))
            if (!allow.waitForExists(5000)) {
                allow = device.findObject(UiSelector().resourceId("com.android.settings:id/allow_button"))
            }
            check(allow.exists()) { "notification-access confirm dialog (Allow) not found" }
            tapCenter(allow)
        }
        // Deselect every auto-selected category checkbox. Re-query each pass (legacy UiObject is a
        // live handle) so a stale snapshot does not skip a freshly re-rendered row; cap as a backstop.
        device.findObject(UiSelector().resourceId("android:id/checkbox")).waitForExists(5000)
        var guard = 0
        while (guard++ < 6) {
            val checked = device.findObject(UiSelector().resourceId("android:id/checkbox").checked(true))
            if (!checked.exists()) break
            tapCenter(checked)
            Thread.sleep(300)
        }
        check(JourneySupport.proveDialogState("perm-05-categories-deselected", "android:id/checkbox", timeoutMs = 3000) is ShotResult.Success)
    }

    /**
     * Tap a screen point / a node's visible centre via the `input` shell command (external
     * InputManager injection), NOT UiObject(2)/UiDevice.click (in-process UiAutomation injection):
     * with Scope's auto-PiP window present the UiAutomation-dispatched tap does not navigate while a
     * shell `input tap` at the same coordinates does (confirmed on-device). executeShellCommand
     * blocks until the command completes.
     */
    private fun tapCenter(x: Int, y: Int) { device.executeShellCommand("input tap $x $y") }
    private fun tapCenter(o: androidx.test.uiautomator.UiObject) { val b = o.visibleBounds; tapCenter(b.centerX(), b.centerY()) }
}
