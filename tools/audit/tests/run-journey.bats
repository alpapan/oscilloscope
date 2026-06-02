#!/usr/bin/env bats

load helpers/setup

setup() {
  audit_setup
  # Keep every write inside the test temp dir: build outputs and screenshots
  # never touch the real android/ or docs/ trees.
  export SCOPE_APK_BASE="${BATS_TEST_TMPDIR}/apk"
  export SCOPE_OUT_BASE="${BATS_TEST_TMPDIR}/out"
  export GRADLEW="${BATS_TEST_TMPDIR}/gradlew"
  mkdir -p "$SCOPE_OUT_BASE"

  # npm shim: lint/typecheck exit codes are controllable via env.
  cat > "${BATS_TEST_TMPDIR}/npm" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "run" && "$2" == "lint" ]] && exit "${FAKE_LINT_EXIT:-0}"
[[ "$1" == "run" && "$2" == "typecheck" ]] && exit "${FAKE_TYPECHECK_EXIT:-0}"
exit 0
EOF

  # No-op sleep so boot-wait/sleep calls don't really block.
  cat > "${BATS_TEST_TMPDIR}/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  mkdir -p "${BATS_TEST_TMPDIR}/Sdk/platform-tools"
  cat > "${BATS_TEST_TMPDIR}/Sdk/platform-tools/adb" <<'EOF'
#!/usr/bin/env bash
# Strip a leading `-s <serial>` so the patterns match both bare and
# serial-targeted invocations.
while [[ "$1" == "-s" ]]; do shift 2; done
case "$*" in
  devices*)                           echo "emulator-5554	device" ;;
  "shell getprop sys.boot_completed") echo "1" ;;
  "exec-out screencap -p")            printf 'PNGDATA' ;;
  "shell monkey "*)                   touch "${BATS_TEST_TMPDIR}/launched.flag" ;;
  install*|"install -r "*)            touch "${BATS_TEST_TMPDIR}/installed.flag" ;;
  uninstall*)                         touch "${BATS_TEST_TMPDIR}/uninstalled.flag" ;;
esac
EOF

  # Fake headless emulator binary at ANDROID_HOME/emulator/emulator; the script
  # launches it in the background. Records that it was invoked.
  mkdir -p "${BATS_TEST_TMPDIR}/Sdk/emulator"
  cat > "${BATS_TEST_TMPDIR}/Sdk/emulator/emulator" <<'EOF'
#!/usr/bin/env bash
touch "${BATS_TEST_TMPDIR}/emulator-launched.flag"
exit 0
EOF
  chmod +x "${BATS_TEST_TMPDIR}/Sdk/emulator/emulator"

  cat > "${BATS_TEST_TMPDIR}/gradlew" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--no-daemon" && "$2" == "assembleRelease" ]] && exit "${FAKE_GRADLE_RELEASE_EXIT:-0}"
[[ "$1" == "--no-daemon" && "$2" == "assembleDebug" ]] && exit "${FAKE_GRADLE_DEBUG_EXIT:-0}"
exit 0
EOF

  chmod +x "${BATS_TEST_TMPDIR}"/{npm,sleep,gradlew} \
           "${BATS_TEST_TMPDIR}/Sdk/platform-tools/adb"

  # Redirect ${HOME}/Android/Sdk/platform-tools/adb onto the shim above.
  export HOME="${BATS_TEST_TMPDIR}"
  ln -fs "." "${BATS_TEST_TMPDIR}/Android"

  # Stand-in release APK under the injected APK base (never the real build dir).
  # Named like the project's real artifact (scope-<version>.apk), NOT gradle's
  # default app-release.apk - the find pattern must not assume the default name.
  mkdir -p "${SCOPE_APK_BASE}/release"
  echo "stub" > "${SCOPE_APK_BASE}/release/scope-0.6.apk"
}

@test "refuses with exit 2 when journey is marked emulator:false" {
  run "${REPO_ROOT}/tools/audit/run-journey.sh" scope-api36 \
    "${REPO_ROOT}/docs/audits/2026-06-audit/journeys/start-capture-system.xml"
  [ "$status" -eq 2 ]
  [[ "$output" == *"REFUSED"* ]]
}

@test "exits non-zero when lint fails before invoking gradle" {
  run env FAKE_LINT_EXIT=1 "${REPO_ROOT}/tools/audit/run-journey.sh" scope-api36 \
    "${REPO_ROOT}/docs/audits/2026-06-audit/journeys/drawer-capture-toggle.xml"
  [ "$status" -ne 0 ]
  [ ! -f "${BATS_TEST_TMPDIR}/installed.flag" ]
}

@test "falls back to assembleDebug when assembleRelease fails, and uninstalls first" {
  rm -f "${SCOPE_APK_BASE}/release/scope-0.6.apk"
  mkdir -p "${SCOPE_APK_BASE}/debug"
  echo "stub" > "${SCOPE_APK_BASE}/debug/scope-0.6.apk"
  run env FAKE_GRADLE_RELEASE_EXIT=1 "${REPO_ROOT}/tools/audit/run-journey.sh" scope-api36 \
    "${REPO_ROOT}/docs/audits/2026-06-audit/journeys/drawer-capture-toggle.xml"
  [ "$status" -eq 0 ]
  [ -f "${BATS_TEST_TMPDIR}/uninstalled.flag" ]
  [ -f "${BATS_TEST_TMPDIR}/installed.flag" ]
}

@test "waits for boot_completed=1 before calling adb install" {
  cat > "${BATS_TEST_TMPDIR}/Sdk/platform-tools/adb" <<'EOF'
#!/usr/bin/env bash
while [[ "$1" == "-s" ]]; do shift 2; done
case "$*" in
  devices*) echo "emulator-5554	device" ;;
  "shell getprop sys.boot_completed")
    COUNT_FILE="${BATS_TEST_TMPDIR}/boot-calls"
    n=$(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$COUNT_FILE"
    [ "$n" -ge 2 ] && echo "1" || echo ""
    ;;
  "exec-out screencap -p") printf 'PNGDATA' ;;
  install*|"install -r "*) touch "${BATS_TEST_TMPDIR}/installed.flag" ;;
esac
EOF
  chmod +x "${BATS_TEST_TMPDIR}/Sdk/platform-tools/adb"
  run "${REPO_ROOT}/tools/audit/run-journey.sh" scope-api36 \
    "${REPO_ROOT}/docs/audits/2026-06-audit/journeys/drawer-capture-toggle.xml"
  [ "$status" -eq 0 ]
  [ -f "${BATS_TEST_TMPDIR}/installed.flag" ]
  [ -f "${BATS_TEST_TMPDIR}/emulator-launched.flag" ]
  [ "$(cat "${BATS_TEST_TMPDIR}/boot-calls")" -ge 2 ]
}

@test "launches the app, then captures a non-empty screenshot via adb screencap" {
  run "${REPO_ROOT}/tools/audit/run-journey.sh" scope-api36 \
    "${REPO_ROOT}/docs/audits/2026-06-audit/journeys/drawer-capture-toggle.xml"
  [ "$status" -eq 0 ]
  [ -f "${BATS_TEST_TMPDIR}/launched.flag" ]
  find "${SCOPE_OUT_BASE}/scope-api36" -name '*.png' -type f -size +0c | grep -q .
}

@test "exits non-zero with a clear error when the journey file does not exist" {
  run "${REPO_ROOT}/tools/audit/run-journey.sh" scope-api36 \
    "${REPO_ROOT}/docs/audits/2026-06-audit/journeys/does-not-exist.xml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not found"* ]]
}
