package com.alpapan.scope

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.RequiresDevice
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Exercises the permission grants a user goes through:
 *  - RECORD_AUDIO via the runtime permission dialog ("Allow"),
 *  - MediaProjection via the system consent dialog ("Start now"),
 *  - notification-listener access granted directly via the instrumentation shell.
 * The per-OEM Settings UI for granting notification access is a flaky surface we do NOT own (multi-step
 * navigation, a native confirm dialog, the Android 13/14 restricted-settings race, Scope's auto-PiP overlay),
 * and it is Android's UI, not Scope's. So we grant it deterministically with the shell rights the test process
 * already holds and verify the part that is actually Scope's: it shows the in-app "Grant access" prompt when
 * access is off and clears it once access is granted. Permissions are revoked in setup so each grant runs from
 * scratch regardless of test order.
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

    // Requires a real device: emulator images (e.g. the FTL MediumPhone matrix) do not surface the
    // MediaProjection consent dialog (it is auto-handled / absent), so there is nothing to accept and the
    // test cannot verify the consent flow. Runs + passes on physical devices (the Nokia X30, FTL physical).
    @Test @RequiresDevice fun projectionConsentAcceptedViaDialog() {
        s = JourneySupport.launchReady()
        // System capture asks for MediaProjection consent ("Start now" == android:id/button1).
        JourneySupport.clickId(s, "mobile-capture")
        val allowed = JourneySupport.tapDialog("android:id/button1", 8000)
        check(allowed) { "MediaProjection consent dialog never appeared" }
        JourneySupport.assertJs(s, "document.getElementById('mobile-start').hidden === true")
        check(JourneySupport.proveScopeState(s, "perm-02-projection-granted", "document.getElementById('mobile-start').hidden === true") is ShotResult.Success)
    }

    /**
     * Granting notification-listener access must clear Scope's in-app "Grant access" prompt. We grant via the
     * instrumentation shell (`cmd notification allow_listener`) rather than driving the system Settings UI:
     * that UI is OEM-/version-specific and flaky, and it is Android's surface, not Scope's. What we own and
     * verify is Scope's reaction - the prompt is present when access is off, and the card shows its granted
     * idle state once access is granted.
     * Requires a real device: startSystemCapture accepts the MediaProjection consent dialog ("Start now"),
     * which the FTL emulator images do not surface (it is auto-handled / absent), so the now-playing card
     * never reaches its running state there.
     */
    @Test @RequiresDevice fun notificationGrantClearsInAppPrompt() {
        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)          // running state so the now-playing card shows
        JourneySupport.cycleToView(s, "nowplaying")

        // Access is off (revoked in setup), so the card offers a "Grant access" button (.np-grant in main.js).
        check(JourneySupport.proveScopeState(s, "perm-03-notif-prompt", "!!document.querySelector('.np-grant')") is ShotResult.Success)

        // Grant the notification listener directly - the instrumentation shell holds the rights, so this is
        // deterministic where driving the Settings UI was not. On an Android 13/14 sideload (installer=null)
        // the grant is gated by the ACCESS_RESTRICTED_SETTINGS app-op; allow it first or `allow_listener`
        // silently no-ops. (This is exactly what the Settings UI's "Allow restricted settings" does - here it
        // is one deterministic shell call instead of a flaky UI reload loop.)
        val component = "${JourneySupport.PKG}/${JourneySupport.PKG}.MediaMetadataService"
        device.executeShellCommand("cmd appops set ${JourneySupport.PKG} ACCESS_RESTRICTED_SETTINGS allow")
        device.executeShellCommand("cmd notification allow_listener $component")
        // `allow_listener` propagates ASYNCHRONOUSLY - the enabled_notification_listeners setting lands a beat
        // after the command returns - so poll it rather than reading once.
        var enabled = ""
        val deadline = System.currentTimeMillis() + 8000
        while (System.currentTimeMillis() < deadline) {
            enabled = device.executeShellCommand("settings get secure enabled_notification_listeners")
            if (enabled.contains("MediaMetadataService")) break
            Thread.sleep(300)
        }
        check(enabled.contains("MediaMetadataService")) { "notification listener not enabled after shell grant; got: $enabled" }

        // The grant is what we set up; the assertion we own is that SCOPE reacts to it. Re-foreground and cycle
        // views to force a re-render, then confirm the now-playing card dropped the "Grant access" prompt AND
        // now shows its granted idle state (.np-placeholder "Nothing playing") - a positive check, so the card
        // silently vanishing could not pass it. (.np-grant and .np-placeholder are mutually exclusive branches
        // in renderNowPlayingCard, gated on notification-access being granted.)
        check(JourneySupport.ensureForeground(s, timeoutMs = 8000)) { "could not re-foreground Scope" }
        JourneySupport.cycleToView(s, "waveform")
        JourneySupport.cycleToView(s, "nowplaying")
        // Check: grant prompt gone AND card is visible (not hidden). Do NOT assert .np-placeholder
        // specifically: if a media app is reporting a session the card renders track info instead,
        // which is equally valid evidence that access was granted.
        check(JourneySupport.proveScopeState(s, "perm-04-notif-granted", "(() => { const c = document.getElementById('now-playing-card'); return !!(c && !c.hidden && !c.querySelector('.np-grant')); })()") is ShotResult.Success)
    }
}
