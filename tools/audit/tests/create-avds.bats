#!/usr/bin/env bats

load helpers/setup

setup() {
  audit_setup
  : > "${BATS_TEST_TMPDIR}/avd-store"
  # Fake `android`: only `emulator list` is used (the existence check). The real
  # CLI prints one bare AVD name per line, which is what this emits.
  cat > "${BATS_TEST_TMPDIR}/android" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "emulator list") cat "${BATS_TEST_TMPDIR}/avd-store" ;;
esac
EOF
  chmod +x "${BATS_TEST_TMPDIR}/android"
  # Fake `avdmanager` under ANDROID_HOME/cmdline-tools/latest/bin: records each
  # `create avd --name X`, errors if it already exists (like the real tool). The
  # real `android emulator create` only takes a device profile, so named/API
  # AVDs must be made with avdmanager.
  export ANDROID_HOME="${BATS_TEST_TMPDIR}/sdk"
  mkdir -p "${ANDROID_HOME}/cmdline-tools/latest/bin"
  cat > "${ANDROID_HOME}/cmdline-tools/latest/bin/avdmanager" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null   # consume the piped "no" answer to the custom-profile prompt
if [[ "$1 $2" == "create avd" ]]; then
  shift 2
  NAME=""
  while [[ $# -gt 0 ]]; do
    case "$1" in --name) NAME="$2"; shift 2 ;; *) shift ;; esac
  done
  if grep -Fxq "$NAME" "${BATS_TEST_TMPDIR}/avd-store" 2>/dev/null; then
    echo "Error: AVD ${NAME} already exists." >&2; exit 1
  fi
  echo "$NAME" >> "${BATS_TEST_TMPDIR}/avd-store"
fi
EOF
  chmod +x "${ANDROID_HOME}/cmdline-tools/latest/bin/avdmanager"
}

@test "create-avds.sh exists and is executable" {
  [ -x "${REPO_ROOT}/tools/audit/create-avds.sh" ]
}

@test "creates exactly three AVDs named scope-api34, scope-api35, scope-api36" {
  run "${REPO_ROOT}/tools/audit/create-avds.sh"
  [ "$status" -eq 0 ]
  grep -Fxq "scope-api34" "${BATS_TEST_TMPDIR}/avd-store"
  grep -Fxq "scope-api35" "${BATS_TEST_TMPDIR}/avd-store"
  grep -Fxq "scope-api36" "${BATS_TEST_TMPDIR}/avd-store"
  [ "$(wc -l < "${BATS_TEST_TMPDIR}/avd-store")" -eq 3 ]
}

@test "is idempotent - running twice still leaves three AVDs and exits 0" {
  run "${REPO_ROOT}/tools/audit/create-avds.sh"
  [ "$status" -eq 0 ]
  run "${REPO_ROOT}/tools/audit/create-avds.sh"
  [ "$status" -eq 0 ]
  [ "$(wc -l < "${BATS_TEST_TMPDIR}/avd-store")" -eq 3 ]
}
