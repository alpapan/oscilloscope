#!/usr/bin/env bats

load helpers/setup

setup() {
  audit_setup
  # Default fake `android`: claims everything installs fine.
  cat > "${BATS_TEST_TMPDIR}/android" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "android 1.2.3"; exit 0 ;;
  sdk) shift; case "$1" in
    install) shift; printf '%s\n' "$@" > "${BATS_TEST_TMPDIR}/installed.txt"; exit 0 ;;
    list) shift; case "$1" in
      --installed) echo "Unknown option: '--installed'" >&2; exit 1 ;;
      *) cat "${BATS_TEST_TMPDIR}/installed.txt" 2>/dev/null || true ;;
    esac ;;
  esac ;;
esac
EOF
  chmod +x "${BATS_TEST_TMPDIR}/android"
}

@test "script exists and is executable" {
  [ -x "${REPO_ROOT}/tools/audit/setup-android-cli.sh" ]
}

@test "script does NOT call install.sh when android is already on PATH" {
  cat > "${BATS_TEST_TMPDIR}/curl" <<'EOF'
#!/usr/bin/env bash
echo "REAL_NETWORK_CALL_$@" >> "${BATS_TEST_TMPDIR}/curl.log"
EOF
  chmod +x "${BATS_TEST_TMPDIR}/curl"
  run "${REPO_ROOT}/tools/audit/setup-android-cli.sh"
  [ "$status" -eq 0 ]
  [ ! -f "${BATS_TEST_TMPDIR}/curl.log" ]
}

@test "script installs three system images for API 34, 35, 36" {
  run "${REPO_ROOT}/tools/audit/setup-android-cli.sh"
  [ "$status" -eq 0 ]
  grep -q "system-images/android-34/google_apis/x86_64" "${BATS_TEST_TMPDIR}/installed.txt"
  grep -q "system-images/android-35/google_apis/x86_64" "${BATS_TEST_TMPDIR}/installed.txt"
  grep -q "system-images/android-36/google_apis/x86_64" "${BATS_TEST_TMPDIR}/installed.txt"
}

@test "script is idempotent - re-running succeeds with no error" {
  run "${REPO_ROOT}/tools/audit/setup-android-cli.sh"
  [ "$status" -eq 0 ]
  run "${REPO_ROOT}/tools/audit/setup-android-cli.sh"
  [ "$status" -eq 0 ]
}

@test "script exits non-zero if android sdk install fails" {
  cat > "${BATS_TEST_TMPDIR}/android" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "android 1.2.3"; exit 0 ;;
  sdk) exit 42 ;;
esac
EOF
  chmod +x "${BATS_TEST_TMPDIR}/android"
  run "${REPO_ROOT}/tools/audit/setup-android-cli.sh"
  [ "$status" -ne 0 ]
}
