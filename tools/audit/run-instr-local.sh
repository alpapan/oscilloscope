#!/usr/bin/env bash
# Run the Scope instrumentation suite on a LOCALLY-CONNECTED device in ONE deterministic
# pass (no retries, no looping): build the debug + androidTest APKs, clean-install both,
# run the whole suite once via `am instrument`, and pull the per-step screenshots locally.
#
# The tests self-grant RECORD_AUDIO and notification-listener access (for now-playing) from
# inside the instrumentation, so no host-side permission grants are needed here.
#
# Usage: tools/audit/run-instr-local.sh <adb-serial> [comma,separated,test,classes]
set -euo pipefail

SERIAL="${1:-}"
if [[ -z "$SERIAL" ]]; then
  echo "usage: tools/audit/run-instr-local.sh <adb-serial> [test-classes]" >&2
  exit 2
fi
# AudioCaptureTest is listed FIRST deliberately: it is the only class that asserts captured-audio
# RMS>0, and a prior class's force-stopped AudioPlaybackCapture orphans an audio-policy mix that makes
# the next capture read pure silence (an Android AudioPlaybackCapture limitation with no app-side or
# non-root recovery in a boot session - proven on the Nokia X30; only a reboot clears it). Running it
# before any capture-churn class gives it a clean mix. The other capturing classes only assert that a
# view renders, not audio content, so their (possibly silenced) captures still pass.
CLASSES="${2:-com.alpapan.scope.AudioCaptureTest,com.alpapan.scope.PermissionGrantTest,com.alpapan.scope.ViewWalkTest,com.alpapan.scope.PaletteWalkTest,com.alpapan.scope.DrawerControlsTest,com.alpapan.scope.GestureTest,com.alpapan.scope.PipLifecycleTest,com.alpapan.scope.MicModeViewExclusionTest,com.alpapan.scope.NowPlayingTest,com.alpapan.scope.TvJourneyTest}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

ADB="${ADB:-adb}"
GRADLEW="${GRADLEW:-./gradlew}"
PKG="com.alpapan.scope"
RUNNER="${PKG}.test/androidx.test.runner.AndroidJUnitRunner"
APK_BASE="${SCOPE_APK_BASE:-android/app/build/outputs/apk}"
SERIAL_SAFE="${SERIAL//[^A-Za-z0-9._-]/_}"
OUT_DIR="${SCOPE_INSTR_OUT:-docs/audits/2026-06-audit/local-instr/${SERIAL_SAFE}-$(date -u +%Y%m%dT%H%M%SZ)}"

# Only (re)connect when the link is actually down. A redundant `adb connect` to a live wireless
# session can drop and re-pair it, so guard every reconnect on the current state.
ensure_connected() {
  [[ "$("$ADB" -s "$SERIAL" get-state 2>/dev/null)" == "device" ]] && return 0
  "$ADB" connect "$SERIAL" >/dev/null 2>&1 || true
  # BOUND this: a bare `adb wait-for-device` blocks forever if the link dropped and the wireless
  # port rotated (so connecting on the old SERIAL never succeeds). Cap it so the run can't hang.
  timeout 25 "$ADB" -s "$SERIAL" wait-for-device >/dev/null 2>&1 || true
}

# Abandon orphaned PackageInstaller sessions left by interrupted adb installs. An `adb install` cut off
# AFTER the device commits the session but BEFORE it finalizes (a wireless blip, or the install timeout
# below killing the client) leaves a committed-but-unfinalized session on the device. PackageManager
# can finalize one LATER - mid-test - force-stopping the instrumentation process ("Process crashed");
# and in bulk they jam PackageInstaller so fresh installs hang. They do not clear on their own
# (mCommitted, stuck at ~90% progress), so abandoning is the only recovery. Touch ONLY shell/uid-2000
# (adb-initiated) sessions still live (mDestroyed=false) - never Play/system (com.android.vending)
# sessions. Every device call is bounded so a jammed installer cannot hang the run.
abandon_orphan_install_sessions() {
  local dump ids sid
  dump="$(timeout 20 "$ADB" -s "$SERIAL" shell dumpsys package installer 2>/dev/null || true)"
  # Parse ONLY the "Active install sessions:" section. dumpsys also prints "Finalized install
  # sessions:" (already-applied/destroyed sessions whose mDestroyed=true lines would otherwise bleed
  # into and clear the last Active block's live flag). The section is bounded: it opens at the
  # "Active install sessions:" header and ends at the next non-indented (column-0) line. Within it,
  # one target per "Active Session N:" block: shell-initiated AND not already destroyed; flush the
  # previous block's id at the next header, at the section end, or at EOF.
  ids="$(printf '%s\n' "$dump" | awk '
    /^Active install sessions:/ { sect=1; next }
    /^[^ ]/ { if (sect && id != "" && shell && live) print id; id=""; sect=0 }
    sect && /Active Session [0-9]+:/ { if (id != "" && shell && live) print id; id=$3; sub(/:/,"",id); shell=0; live=0 }
    sect && /installInitiatingPackageName=com\.android\.shell/ { shell=1 }
    sect && /mDestroyed=false/ { live=1 }
    sect && /mDestroyed=true/  { live=0 }
    END { if (sect && id != "" && shell && live) print id }
  ')"
  for sid in $ids; do
    [ -n "$sid" ] && timeout 8 "$ADB" -s "$SERIAL" shell pm install-abandon "$sid" >/dev/null 2>&1 || true
  done
}

# Install resiliently: a wireless link can drop mid-push ("failed to read copy response: EOF"),
# and A16 Pixels print false failures, so judge success by package presence and retry through a
# CONDITIONAL reconnect. $1 = apk path, $2 = package id to verify is present afterwards.
install_apk() {
  local apk="$1" pkg="$2" attempt
  for attempt in 1 2 3; do
    ensure_connected
    # timeout every device op: an 8MB push over a flaky wireless link can stall indefinitely.
    timeout 90 "$ADB" -s "$SERIAL" install -r --no-streaming "$apk" >/dev/null 2>&1 || true
    ensure_connected
    if timeout 20 "$ADB" -s "$SERIAL" shell pm list packages 2>/dev/null | grep -q "${pkg}$"; then return 0; fi
    # This attempt did not stick. A `timeout 90` that fired (or a link drop) can leave a committed-but-
    # unfinalized orphan session behind; abandon orphans before retrying so they do not accumulate and
    # jam PackageInstaller (making the next attempt hang) or finalize later mid-test.
    abandon_orphan_install_sessions
    echo "install of $pkg did not stick (attempt $attempt/3); reconnecting and retrying" >&2
  done
  return 1
}

# Generate the composite test tone (a build artifact, kept out of git; see gen-test-tones.sh).
bash "$(dirname "$0")/gen-test-tones.sh"
# Build both APKs (single pass).
( cd android && "$GRADLEW" --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest )

APP_APK="$(find "$APK_BASE/debug" -name '*.apk' -type f -print -quit)"
TEST_APK="$(find "$APK_BASE/androidTest/debug" -name '*androidTest*.apk' -type f -print -quit)"
if [[ -z "$APP_APK" || -z "$TEST_APK" ]]; then
  { echo "ERROR: APK(s) not found under $APK_BASE"; echo "  app='${APP_APK:-<none>}' test='${TEST_APK:-<none>}'"; } >&2
  exit 1
fi

# Clean install: debug signing differs from any release build, so an existing install must go.
ensure_connected
timeout 30 "$ADB" -s "$SERIAL" uninstall "$PKG" >/dev/null 2>&1 || true
timeout 30 "$ADB" -s "$SERIAL" uninstall "${PKG}.test" >/dev/null 2>&1 || true
install_apk "$APP_APK" "$PKG"          || { echo "ERROR: app APK did not install on $SERIAL" >&2; exit 1; }
install_apk "$TEST_APK" "${PKG}.test"  || { echo "ERROR: androidTest APK did not install on $SERIAL" >&2; exit 1; }

# Android 13/14 "restricted settings": a sideloaded (untrusted-installer) build is blocked from
# being granted notification-listener / accessibility access - tapping the toggle raises
# com.android.settings.ActionDisabledByAppOpsDialog ("For your security, this setting is currently
# unavailable"). Setting the ACCESS_RESTRICTED_SETTINGS app-op to "allow" is the exact equivalent of
# the user choosing App info -> Allow restricted settings (AOSP Settings sets the same op/mode). The
# op RESETS to deny on every (re)install on Android 14, so it must be (re)set here - after the
# install above, before the instrumentation runs. Non-fatal: devices where the op is absent or
# restricted settings do not apply (e.g. Android 16, FTL emulators) simply no-op.
ensure_connected
timeout 20 "$ADB" -s "$SERIAL" shell appops set "$PKG" ACCESS_RESTRICTED_SETTINGS allow >/dev/null 2>&1 || true

# Start from a clean foreground: go to the home screen so the suite launches from a known state,
# not on top of whatever app is currently open (a foreground app can interfere with system-UI
# steps such as the notification-access settings navigation).
ensure_connected
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_HOME || true

# Wake + hold the screen on for the whole run. A headless run can find the device asleep or on the
# lockscreen, and ActivityScenario.launch only reaches RESUMED on a lit, unlocked screen - a dark
# screen leaves the activity in CREATED, so the RECORD_AUDIO dialog never shows and capture never
# starts. KEYCODE_WAKEUP alone is not enough (the screen-off timeout would re-sleep mid-class), so
# set stay-on; capture the prior value to restore it afterwards (same ethos as the release reinstall).
ensure_connected
# Record the pre-run wake state so we can restore it: an asleep device woken for the run must be put
# back to sleep at the end (which also re-locks a swipe lock), an already-awake device left awake.
WAKE_STATE="$("$ADB" -s "$SERIAL" shell dumpsys power 2>/dev/null || true)"
# Only a POSITIVELY confirmed not-awake prior state should be slept back at the end. A confirmed
# Awake state, or an empty/unreadable read (adb hiccup), is left awake - a failed read must not
# cause a power-state change.
case "$WAKE_STATE" in
  *mWakefulness=Awake*) WAS_AWAKE=1 ;;   # confirmed awake -> leave awake
  "")                   WAS_AWAKE=1 ;;   # unreadable -> do not change power state
  *)                    WAS_AWAKE=0 ;;   # confirmed not-awake (Asleep/Dozing) -> sleep at end
esac
PRIOR_STAYON="$("$ADB" -s "$SERIAL" shell settings get global stay_on_while_plugged_in 2>/dev/null | tr -d '\r' || true)"
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell svc power stayon true >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true

# Per-class process isolation. am instrument exits 0 even when tests fail, so the
# result is read from the log, not the exit code.
mkdir -p "$OUT_DIR"
IFS=',' read -ra CLASS_ARR <<< "$CLASSES"
ensure_connected
# Fresh evidence: wipe the device journeys dir once before the loop (install does not clear it).
"$ADB" -s "$SERIAL" shell rm -rf "/sdcard/Android/data/${PKG}/files/journeys" 2>/dev/null || true
# Clear any orphaned install sessions before the class loop. A committed-but-unfinalized session from
# an interrupted install (this run's setup retries, or a prior run) can be finalized by PackageManager
# mid-class, force-stopping the instrumentation ("Process crashed"). Abandon them now so none applies
# while a test is running - this is the load-bearing guard against the mid-run "Process crashed".
abandon_orphan_install_sessions
for cls in "${CLASS_ARR[@]}"; do
  ensure_connected
  # Fresh process per class: force-stop releases MediaProjection + the AudioPlaybackCapture
  # policy slot and dismisses the auto-PiP window (all process-owned). pm clear is NOT used
  # (it would wipe the journeys dir we accumulate). Home first so the next class launches clean.
  "$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
  # A failed notification-access grant leaves a com.android.settings ActionDisabledByAppOpsDialog
  # ("Restricted setting") modal on screen; force-stopping only Scope leaves it up, where it poisons
  # the next class ("could not scroll"). Clear Settings too so one failure does not cascade.
  "$ADB" -s "$SERIAL" shell am force-stop com.android.settings >/dev/null 2>&1 || true
  # Revoke RECORD_AUDIO between classes: a class that granted it (AudioCaptureTest) leaves it granted,
  # and PermissionGrantTest's @Before revokes it IN-PROCESS - revoking a GRANTED runtime permission
  # force-stops the app, which is the instrumentation process, so that class reports "Process crashed".
  # Revoking it here (app already force-stopped) makes the in-test revoke a harmless no-op.
  "$ADB" -s "$SERIAL" shell pm revoke "$PKG" android.permission.RECORD_AUDIO >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
  sleep 0.3   # bounded insurance for the async AudioPlaybackCapture policy-slot release.
  set +e
  timeout 120 "$ADB" -s "$SERIAL" shell am instrument -w -e class "$cls" "$RUNNER" 2>&1 | tee "$OUT_DIR/instr-${cls}.log"
  rc=${PIPESTATUS[0]}
  set -e
  [[ "$rc" == 124 ]] && echo "TIMEOUT (rc=124) on class $cls" >&2
done
ensure_connected
"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true

# Pull the screenshots regardless of pass/fail. timeout: a large pull over a flaky wireless link
# can stall forever, which is what made the script "wait forever after the tests finished".
ensure_connected
timeout 90 "$ADB" -s "$SERIAL" pull "/sdcard/Android/data/${PKG}/files/journeys" "$OUT_DIR" >/dev/null 2>&1 || true

# Restore the device: the suite installs a DEBUG build, so uninstall it and reinstall the
# normal RELEASE build, leaving the device as a user would expect to find it.
RELEASE_APK="$(find "$APK_BASE/release" -name '*.apk' -type f -print -quit 2>/dev/null || true)"
ensure_connected
timeout 30 "$ADB" -s "$SERIAL" uninstall "$PKG" >/dev/null 2>&1 || true
timeout 30 "$ADB" -s "$SERIAL" uninstall "${PKG}.test" >/dev/null 2>&1 || true
if [[ -n "$RELEASE_APK" ]]; then
  if install_apk "$RELEASE_APK" "$PKG"; then
    echo "Restored release build: $RELEASE_APK"
  else
    echo "WARN: release reinstall did not verify on $SERIAL" >&2
  fi
else
  echo "WARN: no release APK under $APK_BASE/release; left ${PKG} uninstalled on $SERIAL" >&2
fi

# Restore the stay-on setting we changed to keep the device awake during the run (only if we read a
# numeric prior value; an empty/unknown reading is left untouched rather than guessed).
if [[ "${PRIOR_STAYON:-}" =~ ^[0-9]+$ ]]; then
  ensure_connected
  "$ADB" -s "$SERIAL" shell settings put global stay_on_while_plugged_in "$PRIOR_STAYON" >/dev/null 2>&1 || true
fi
# If the device was asleep before we woke it, return it to sleep (also re-locks a swipe lock). This
# MUST follow the stay-on restore above: a device that still has stay-on set refuses to sleep.
if [[ "${WAS_AWAKE:-1}" == 0 ]]; then
  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_SLEEP >/dev/null 2>&1 || true
fi

echo "----"
notok="$(grep -L 'OK (' "$OUT_DIR"/instr-*.log 2>/dev/null || true)"
hardfail="$(grep -l 'FAILURES!!!' "$OUT_DIR"/instr-*.log 2>/dev/null || true)"
rc_suite=0
if [[ -n "$notok$hardfail" ]]; then
  echo "RESULT: SOME CLASSES FAILED/HUNG:"; printf '  %s\n' $notok $hardfail; rc_suite=1
else
  echo "RESULT: all classes passed"
fi
# Phase E2: a second, independent gate-failure signal straight from the pulled evidence. The in-test
# check(r is ShotResult.Success) already fails such a test in the am-instrument log above; this scan
# catches the case where a shot's diag.json reports wasGated:false. Non-fatal (artifacts already local).
gate_failures="$(find "$OUT_DIR" -name '*.diag.json' -exec grep -l '"wasGated":false' {} + 2>/dev/null || true)"
if [[ -n "$gate_failures" ]]; then
  echo "RESULT: gate failure(s) detected - a shot's diag.json reports wasGated:false:" >&2
  echo "$gate_failures" >&2
fi
echo "Artifacts under: $OUT_DIR"
if [[ -d "$OUT_DIR/journeys" ]]; then
  find "$OUT_DIR/journeys" -maxdepth 1 -type f -printf '%f\n' | sort
else
  echo "(no screenshots pulled)"
fi

exit "$rc_suite"
