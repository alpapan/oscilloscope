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
CLASSES="${2:-com.alpapan.scope.PermissionGrantTest,com.alpapan.scope.AudioCaptureTest,com.alpapan.scope.ViewWalkTest,com.alpapan.scope.PaletteWalkTest,com.alpapan.scope.DrawerControlsTest,com.alpapan.scope.GestureTest,com.alpapan.scope.PipLifecycleTest,com.alpapan.scope.MicModeViewExclusionTest,com.alpapan.scope.NowPlayingTest}"

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
    echo "install of $pkg did not stick (attempt $attempt/3); reconnecting and retrying" >&2
  done
  return 1
}

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

# Start from a clean foreground: go to the home screen so the suite launches from a known state,
# not on top of whatever app is currently open (a foreground app can interfere with system-UI
# steps such as the notification-access settings navigation).
ensure_connected
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_HOME || true

# Single instrumentation pass (no retries). am instrument exits 0 even when tests fail, so the
# result is read from the log, not the exit code.
mkdir -p "$OUT_DIR"
ensure_connected
# One am instrument session for all classes (fast). resetApp() in each test's @Before clears the
# plugin's isCapturing flag, so captures restart cleanly between tests without per-process isolation.
# Bounded at 120s so a hung test cannot block the script; the result is read from the log, not exit.
timeout 120 "$ADB" -s "$SERIAL" shell am instrument -w -e class "$CLASSES" "$RUNNER" 2>&1 | tee "$OUT_DIR/instrument.log" || true

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

echo "----"
if grep -q "FAILURES!!!" "$OUT_DIR/instrument.log"; then
  echo "RESULT: SOME TESTS FAILED - see $OUT_DIR/instrument.log"
else
  echo "RESULT: no test failures reported"
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
