#!/usr/bin/env bats
# Behaviour of the local-device instrumentation runner (run-instr-local.sh).
# One deterministic pass: build -> clean install -> single `am instrument` -> pull.

setup() {
  TESTDIR="$(mktemp -d)"
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../.." && pwd)"
  WRAP="${REPO_ROOT}/tools/audit/run-instr-local.sh"
  BIN="${TESTDIR}/bin"; mkdir -p "$BIN"
  # stub adb: record argv; answer `pm list packages` so the install-verify passes;
  # emit a benign am-instrument result.
  cat > "$BIN/adb" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${TESTDIR}/adb.argv"
case "\$*" in
  *"get-state"*) echo "device" ;;
  *"settings get global stay_on_while_plugged_in"*) echo "0" ;;
  *"dumpsys power"*) [[ "\${STUB_WAKEFULNESS:-Awake}" == "__none__" ]] || echo "mWakefulness=\${STUB_WAKEFULNESS:-Awake}" ;;
  *"pm list packages"*) echo "package:com.alpapan.scope"; echo "package:com.alpapan.scope.test" ;;
  *"am instrument"*)
    # The static "OK (7 tests)" count is intentional: this is a purpose-built unit stub,
    # not a realistic per-class test runner, so every invocation reports the same count.
    # A test can force ONE class to hard-fail (to exercise the aggregate summary + non-zero
    # exit path) by exporting STUB_FAIL_CLASS=<fully.qualified.Class>.
    if [[ -n "\${STUB_FAIL_CLASS:-}" && "\$*" == *"\${STUB_FAIL_CLASS}"* ]]; then
      echo "INSTRUMENTATION_RESULT: stream="; echo "FAILURES!!!"
    else
      echo "INSTRUMENTATION_RESULT: stream=OK (7 tests)"; echo "OK (7 tests)"
    fi
    ;;
  *"pull"*"journeys"*)
    # Simulate the device pull: drop one diag.json whose gate verdict the test controls.
    d="\${SCOPE_INSTR_OUT}/journeys"; mkdir -p "\$d"
    printf '%s' "{\"shotName\":\"sample\",\"wasGated\":\${STUB_DIAG_WASGATED:-true}}" > "\$d/sample.diag.json"
    ;;
esac
exit 0
EOF
  chmod +x "$BIN/adb"
  APK_BASE="${TESTDIR}/apk"
  mkdir -p "${APK_BASE}/debug" "${APK_BASE}/androidTest/debug" "${APK_BASE}/release"
  touch "${APK_BASE}/release/scope-0.7.apk"   # pre-existing release build for the restore step
  cat > "${TESTDIR}/gradlew" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${TESTDIR}/gradlew.argv"
touch "${APK_BASE}/debug/scope-0.7.apk" "${APK_BASE}/androidTest/debug/app-debug-androidTest.apk"; exit 0
EOF
  chmod +x "${TESTDIR}/gradlew"
  export PATH="$BIN:$PATH"
  export ADB="${BIN}/adb"
  export GRADLEW="${TESTDIR}/gradlew"
  export SCOPE_APK_BASE="$APK_BASE"
  export SCOPE_INSTR_OUT="${TESTDIR}/out"
}
teardown() { rm -rf "$TESTDIR"; }

@test "exits non-zero when no serial is given" {
  run env "$WRAP"
  [ "$status" -ne 0 ]
}

@test "builds both debug + androidTest APKs" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -q ":app:assembleDebug" "${TESTDIR}/gradlew.argv"
  grep -q ":app:assembleDebugAndroidTest" "${TESTDIR}/gradlew.argv"
}

@test "uninstalls then installs both app and test APKs on the given serial" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -q -- "-s 192.168.0.99:5555 uninstall com.alpapan.scope" "${TESTDIR}/adb.argv"
  grep -qE -- "-s 192.168.0.99:5555 install .*scope-0.7.apk" "${TESTDIR}/adb.argv"
  grep -qE -- "-s 192.168.0.99:5555 install .*app-debug-androidTest.apk" "${TESTDIR}/adb.argv"
}

@test "runs am instrument with the runner and the full class list" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -q "am instrument" "${TESTDIR}/adb.argv"
  grep -q "androidx.test.runner.AndroidJUnitRunner" "${TESTDIR}/adb.argv"
  grep -q "com.alpapan.scope.PermissionGrantTest" "${TESTDIR}/adb.argv"
  grep -q "com.alpapan.scope.AudioCaptureTest" "${TESTDIR}/adb.argv"
  grep -q "com.alpapan.scope.ViewWalkTest" "${TESTDIR}/adb.argv"
  grep -q "com.alpapan.scope.NowPlayingTest" "${TESTDIR}/adb.argv"
}

@test "checks connection state and does not blindly reconnect when already connected" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -q -- "get-state" "${TESTDIR}/adb.argv"                  # it checks whether the link is up
  ! grep -q -- "connect 192.168.0.99:5555" "${TESTDIR}/adb.argv" # and does NOT reconnect a live one
}

@test "sends the device to the home screen before running the suite" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -q -- "input keyevent KEYCODE_HOME" "${TESTDIR}/adb.argv"
}

@test "pulls the journeys screenshots" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -q -- "pull /sdcard/Android/data/com.alpapan.scope/files/journeys" "${TESTDIR}/adb.argv"
}

@test "restores the device by reinstalling the release build after the run" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -qE -- "install .*release/scope-0.7.apk" "${TESTDIR}/adb.argv"
}

@test "a custom class filter is passed through to am instrument" {
  run env "$WRAP" 192.168.0.99:5555 com.alpapan.scope.GestureTest
  [ "$status" -eq 0 ]
  grep -q "com.alpapan.scope.GestureTest" "${TESTDIR}/adb.argv"
  ! grep -q "com.alpapan.scope.ViewWalkTest" "${TESTDIR}/adb.argv"
}

# --- Phase E2: diag.json gate-failure scan after the pull ---

@test "surfaces gate failures when a pulled diag.json reports wasGated:false" {
  export STUB_DIAG_WASGATED=false
  run env "$WRAP" 192.168.0.99:5555
  [[ "$output" == *"gate failure"* ]]
  [[ "$output" == *"sample.diag.json"* ]]
}

@test "a clean run reports no gate failures" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  [[ "$output" != *"gate failure"* ]]
}

# --- Per-class process isolation (foamy-giggling-moon) ---

@test "clears the on-device journeys dir before the loop" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  [ "$status" -eq 0 ]
  grep -q -- "rm -rf /sdcard/Android/data/com.alpapan.scope/files/journeys" "${TESTDIR}/adb.argv"
  # The clear must precede the first am-instrument so every pulled screenshot is from this run.
  rm_line="$(grep -n -- "rm -rf /sdcard/Android/data/com.alpapan.scope/files/journeys" "${TESTDIR}/adb.argv" | head -1 | cut -d: -f1)"
  instr_line="$(grep -n -- "am instrument" "${TESTDIR}/adb.argv" | head -1 | cut -d: -f1)"
  [ -n "$rm_line" ] && [ -n "$instr_line" ] && [ "$rm_line" -lt "$instr_line" ]
}

@test "runs am instrument once per class" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  [ "$status" -eq 0 ]
  [ "$(grep -c "am instrument" "${TESTDIR}/adb.argv")" -eq 3 ]
}

@test "passes a single class per invocation, never the comma list" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  [ "$status" -eq 0 ]
  ! grep -q -- "com.test.A,com.test.B" "${TESTDIR}/adb.argv"
}

@test "force-stops the app between classes" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  [ "$status" -eq 0 ]
  # One force-stop before each of the 3 classes (a trailing teardown force-stop is also fine).
  [ "$(grep -c -- "am force-stop com.alpapan.scope" "${TESTDIR}/adb.argv")" -ge 3 ]
}

@test "pulls the journeys dir exactly once" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  [ "$status" -eq 0 ]
  [ "$(grep -c -- "pull.*journeys" "${TESTDIR}/adb.argv")" -eq 1 ]
}

@test "one class failure does not abort the loop" {
  export STUB_FAIL_CLASS=com.test.B
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  # All three classes still ran their own am-instrument despite B failing mid-loop.
  [ "$(grep -c "am instrument" "${TESTDIR}/adb.argv")" -eq 3 ]
}

@test "writes a per-class log under OUT_DIR" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  [ "$status" -eq 0 ]
  [ -f "${TESTDIR}/out/instr-com.test.A.log" ]
  [ -f "${TESTDIR}/out/instr-com.test.B.log" ]
  [ -f "${TESTDIR}/out/instr-com.test.C.log" ]
}

@test "all-pass run reports success and exits 0" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  [ "$status" -eq 0 ]
  [[ "$output" == *"all classes passed"* ]]
  # No per-class log is missing its "OK (" line.
  [ -z "$(grep -L 'OK (' "${TESTDIR}/out"/instr-*.log)" ]
}

@test "a failing class is surfaced and the script exits non-zero" {
  export STUB_FAIL_CLASS=com.test.B
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B,com.test.C
  [ "$status" -ne 0 ]
  [[ "$output" == *"com.test.B"* ]]
  # The loop still ran every class (failure surfaced, not aborted).
  [ "$(grep -c "am instrument" "${TESTDIR}/adb.argv")" -eq 3 ]
}

# --- Wake + hold the screen on (a headless run can find the device asleep/locked) ---

@test "wakes the device and holds the screen on before the instrument loop" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B
  [ "$status" -eq 0 ]
  grep -q -- "input keyevent KEYCODE_WAKEUP" "${TESTDIR}/adb.argv"
  grep -q -- "svc power stayon true" "${TESTDIR}/adb.argv"
  grep -q -- "wm dismiss-keyguard" "${TESTDIR}/adb.argv"
  # The wake must precede the first am-instrument: ActivityScenario.launch only reaches
  # RESUMED on a lit, unlocked screen; a dark screen leaves the activity in CREATED.
  wake_line="$(grep -n -- "svc power stayon true" "${TESTDIR}/adb.argv" | head -1 | cut -d: -f1)"
  instr_line="$(grep -n -- "am instrument" "${TESTDIR}/adb.argv" | head -1 | cut -d: -f1)"
  [ -n "$wake_line" ] && [ -n "$instr_line" ] && [ "$wake_line" -lt "$instr_line" ]
}

@test "restores the prior stay-on setting after the run" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B
  [ "$status" -eq 0 ]
  # The stub reports the prior value as 0; the script must put it back after the run,
  # leaving the device as a user would expect (same restore ethos as the release reinstall).
  grep -q -- "settings put global stay_on_while_plugged_in 0" "${TESTDIR}/adb.argv"
  # Restore is cleanup: it must come AFTER the last am-instrument, not mid-run.
  restore_line="$(grep -n -- "settings put global stay_on_while_plugged_in" "${TESTDIR}/adb.argv" | tail -1 | cut -d: -f1)"
  instr_line="$(grep -n -- "am instrument" "${TESTDIR}/adb.argv" | tail -1 | cut -d: -f1)"
  [ -n "$restore_line" ] && [ -n "$instr_line" ] && [ "$restore_line" -gt "$instr_line" ]
}

@test "puts the device back to sleep at the end if it was asleep before the run" {
  export STUB_WAKEFULNESS=Asleep
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B
  [ "$status" -eq 0 ]
  grep -q -- "input keyevent KEYCODE_SLEEP" "${TESTDIR}/adb.argv"
  # The sleep is cleanup: it must come AFTER the last am-instrument, and AFTER the stay-on restore
  # (a device with stay-on still set would refuse to sleep).
  sleep_line="$(grep -n -- "input keyevent KEYCODE_SLEEP" "${TESTDIR}/adb.argv" | tail -1 | cut -d: -f1)"
  instr_line="$(grep -n -- "am instrument" "${TESTDIR}/adb.argv" | tail -1 | cut -d: -f1)"
  restore_line="$(grep -n -- "settings put global stay_on_while_plugged_in" "${TESTDIR}/adb.argv" | tail -1 | cut -d: -f1)"
  [ -n "$sleep_line" ] && [ -n "$instr_line" ] && [ "$sleep_line" -gt "$instr_line" ]
  [ -n "$restore_line" ] && [ "$sleep_line" -gt "$restore_line" ]
}

@test "leaves an already-awake device awake at the end (no sleep restore)" {
  export STUB_WAKEFULNESS=Awake
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B
  [ "$status" -eq 0 ]
  ! grep -q -- "input keyevent KEYCODE_SLEEP" "${TESTDIR}/adb.argv"
}

@test "does not sleep the device when the prior wake state is unreadable" {
  # An empty/failed dumpsys-power read must NOT trigger a power-state change: only a positively
  # confirmed not-awake prior state sleeps the device at the end.
  export STUB_WAKEFULNESS=__none__
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B
  [ "$status" -eq 0 ]
  ! grep -q -- "input keyevent KEYCODE_SLEEP" "${TESTDIR}/adb.argv"
}

# --- Restricted-settings block (Android 14 sideload): clear ACCESS_RESTRICTED_SETTINGS ---

@test "clears the ACCESS_RESTRICTED_SETTINGS app-op after install so the notification-listener toggle is grantable" {
  run env "$WRAP" 192.168.0.99:5555 com.test.A,com.test.B
  [ "$status" -eq 0 ]
  grep -q -- "appops set com.alpapan.scope ACCESS_RESTRICTED_SETTINGS allow" "${TESTDIR}/adb.argv"
  # The op gates the notification-listener / accessibility toggle for an untrusted-installer
  # (sideloaded) build on Android 13/14, and it RESETS to deny on every (re)install - so the clear
  # must run AFTER the app install (the package must exist) and BEFORE the first am-instrument
  # (so the toggle is not blocked by the ActionDisabledByAppOpsDialog).
  appop_line="$(grep -n -- "appops set com.alpapan.scope ACCESS_RESTRICTED_SETTINGS allow" "${TESTDIR}/adb.argv" | head -1 | cut -d: -f1)"
  install_line="$(grep -n -E -- "install .*debug/scope-0.7.apk" "${TESTDIR}/adb.argv" | head -1 | cut -d: -f1)"
  instr_line="$(grep -n -- "am instrument" "${TESTDIR}/adb.argv" | head -1 | cut -d: -f1)"
  [ -n "$appop_line" ] && [ -n "$install_line" ] && [ -n "$instr_line" ]
  [ "$appop_line" -gt "$install_line" ]
  [ "$appop_line" -lt "$instr_line" ]
}
