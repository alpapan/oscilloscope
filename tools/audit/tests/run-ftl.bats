#!/usr/bin/env bats

load helpers/setup

setup() {
  audit_setup
  export GCLOUD_LOG="${BATS_TEST_TMPDIR}/gcloud.log"
  # Keep all reads/writes inside the test temp dir: never touch the real
  # android/ build outputs or the real docs/ ftl-results tree.
  export SCOPE_APK_BASE="${BATS_TEST_TMPDIR}/apk"
  export SCOPE_FTL_RESULTS_BASE="${BATS_TEST_TMPDIR}/ftl-results"

  cat > "${BATS_TEST_TMPDIR}/npm" <<'EOF'
#!/usr/bin/env bash
[[ "$1 $2" == "run lint" ]] && exit "${FAKE_LINT_EXIT:-0}"
[[ "$1 $2" == "run typecheck" ]] && exit "${FAKE_TYPECHECK_EXIT:-0}"
exit 0
EOF
  cat > "${BATS_TEST_TMPDIR}/gcloud" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${GCLOUD_LOG}"
exit 0
EOF
  chmod +x "${BATS_TEST_TMPDIR}"/{npm,gcloud}

  # Stand-in release APK under the injected APK base (never the real build dir).
  mkdir -p "${SCOPE_APK_BASE}/release"
  echo "stub" > "${SCOPE_APK_BASE}/release/app-release.apk"
}

@test "exits non-zero when lint fails before invoking gcloud" {
  run env FAKE_LINT_EXIT=1 "${REPO_ROOT}/tools/audit/run-ftl.sh"
  [ "$status" -ne 0 ]
  [ ! -f "${GCLOUD_LOG}" ]
}

@test "invokes gcloud with exactly four --device flags" {
  run "${REPO_ROOT}/tools/audit/run-ftl.sh"
  [ "$status" -eq 0 ]
  count=$(grep -oE -- "--device" "${GCLOUD_LOG}" | wc -l)
  [ "$count" -eq 4 ]
}

@test "invokes gcloud with --timeout 3m (quota safety)" {
  run "${REPO_ROOT}/tools/audit/run-ftl.sh"
  grep -q -- "--timeout 3m" "${GCLOUD_LOG}"
}

@test "defaults Robo Script to robo-script-by-resourceid.json" {
  run "${REPO_ROOT}/tools/audit/run-ftl.sh"
  grep -q "robo-script-by-resourceid.json" "${GCLOUD_LOG}"
}

@test "SCRIPT env var overrides the Robo Script choice" {
  run env SCRIPT="docs/audits/2026-06-audit/ftl-matrix/robo-script-by-contentdesc.json" \
    "${REPO_ROOT}/tools/audit/run-ftl.sh"
  grep -q "robo-script-by-contentdesc.json" "${GCLOUD_LOG}"
}

@test "creates a per-run timestamped results subdirectory" {
  run "${REPO_ROOT}/tools/audit/run-ftl.sh"
  find "${SCOPE_FTL_RESULTS_BASE}" -mindepth 1 -maxdepth 1 -type d | grep -q .
}
