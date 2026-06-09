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
        enableScopeNotificationListenerInSettings()

        // The UI grant must actually flip the system setting - this is the authoritative gate.
        val enabled = device.executeShellCommand("settings get secure enabled_notification_listeners")
        check(enabled.contains("MediaMetadataService")) {
            "notification listener not enabled after the UI grant flow; got: $enabled"
        }

        // Return to the app via an explicit re-foreground Intent (REORDER_TO_FRONT), NOT pressBack
        // counting: the Settings activity stack depth is OEM-/version-variable and an over-pop lands
        // on the launcher (then the now-playing assertion would falsely pass on the backgrounded WebView).
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
     * now-playing must still work afterwards. This Settings flow is OS-version / OEM specific; the
     * element ids below match Pixel / AOSP Android 16 and may need adjusting on other builds.
     */
    private fun enableScopeNotificationListenerInSettings() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val label = ctx.applicationInfo.loadLabel(ctx.packageManager).toString()
        // The list is long: scroll the Scope row into view, then open its detail page.
        val list = UiScrollable(UiSelector().scrollable(true)).apply { setAsVerticalList() }
        val found = try { list.scrollIntoView(UiSelector().text(label)) } catch (_: Throwable) { false }
        check(found) { "could not scroll to '$label' in the notification-access list" }
        requireNotNull(device.findObject(By.text(label))) { "'$label' row not found after scroll" }.click()
        // Detail page: flip the "Allow notification access" toggle (switchWidget).
        val toggle = device.wait(Until.findObject(By.res("com.android.settings", "switchWidget")), 6000)
        requireNotNull(toggle) { "'Allow notification access' toggle not found on the detail page" }.click()
        // Confirmation dialog ("Allow notification access for $label?") -> Allow.
        val allow = device.wait(Until.findObject(By.res("com.android.settings", "allow_button")), 5000)
            ?: device.wait(Until.findObject(By.text("Allow")), 3000)
        requireNotNull(allow) { "notification-access confirm dialog (Allow) not found" }.click()
        // Deselect every auto-selected category checkbox. Re-query each pass so a stale handle from
        // the re-render does not skip one; cap the loop as a backstop.
        device.wait(Until.hasObject(By.res("android", "checkbox")), 5000)
        var guard = 0
        while (guard++ < 6) {
            val checked = device.findObjects(By.res("android", "checkbox")).firstOrNull { it.isChecked } ?: break
            checked.click()
            Thread.sleep(300)
        }
        check(JourneySupport.proveDialogState("perm-05-categories-deselected", "android:id/checkbox", timeoutMs = 3000) is ShotResult.Success)
    }
}
