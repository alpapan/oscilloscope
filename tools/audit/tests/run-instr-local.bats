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
  *"pm list packages"*) echo "package:com.alpapan.scope"; echo "package:com.alpapan.scope.test" ;;
  *"am instrument"*) echo "INSTRUMENTATION_RESULT: stream=OK (7 tests)"; echo "OK (7 tests)" ;;
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
