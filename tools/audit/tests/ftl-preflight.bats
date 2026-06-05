#!/usr/bin/env bats

load helpers/setup

setup() {
  audit_setup
  export GCLOUD_LOG="${BATS_TEST_TMPDIR}/gcloud.log"
  export SCOPE_FTL_PROJECT="${SCOPE_FTL_PROJECT:-scope-audit-202606b}"
  # Per-test results dir so the daily-quota count is deterministic.
  export SCOPE_FTL_RESULTS_BASE="${BATS_TEST_TMPDIR}/ftl-results"
  mkdir -p "${SCOPE_FTL_RESULTS_BASE}"

  # The catalog stub loops over the live model set parsed from run-ftl.sh
  # at setup time (not a hardcoded copy), so changes to run-ftl.sh's device
  # list propagate without the stub going stale.
  MODELS_FROM_RUN_FTL="$(grep -oE 'model=[a-zA-Z0-9]+' "${REPO_ROOT}/tools/audit/run-ftl.sh" | cut -d= -f2 | sort -u | tr '\n' ' ')"
  export MODELS_FROM_RUN_FTL

  # gcloud stub. Behavior switches on argv to simulate the two queries the
  # preflight makes (billing describe, models list). Env overrides inject the
  # failure modes each test wants.
  cat > "${BATS_TEST_TMPDIR}/gcloud" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${GCLOUD_LOG}"
case "$*" in
  *"billing projects describe"*)
    if [[ "${FAKE_BILLING_ENABLED:-false}" == "true" ]]; then
      echo "billingEnabled: true"
    else
      echo "billingEnabled: false"
    fi
    exit 0
    ;;
  *"firebase test android models list"*)
    # Print one model ID per line, suppressing any from FAKE_MISSING_MODELS
    # (space-separated). Model set comes from run-ftl.sh via env.
    missing=" ${FAKE_MISSING_MODELS:-} "
    for m in ${MODELS_FROM_RUN_FTL}; do
      [[ "$missing" == *" $m "* ]] && continue
      echo "$m"
    done
    exit 0
    ;;
esac
exit 0
EOF
  chmod +x "${BATS_TEST_TMPDIR}/gcloud"
}

@test "exits 0 on the happy path (billing off, all 4 models, 0 runs today)" {
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -eq 0 ]
}

@test "exits 1 when billing is enabled" {
  run env FAKE_BILLING_ENABLED=true "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -ne 0 ]
  grep -qi "billing" "${GCLOUD_LOG}"
}

@test "exits 1 when a model is missing from the live catalog" {
  # Pick a model that IS in run-ftl.sh so the stub can suppress it. Reading
  # the first model from the live list keeps this resilient to run-ftl.sh
  # edits (no hardcoded ID that goes stale on the next device-matrix change).
  missing="$(printf '%s' "${MODELS_FROM_RUN_FTL}" | awk '{print $1}')"
  run env FAKE_MISSING_MODELS="$missing" "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -ne 0 ]
}

@test "exits 1 when daily quota is already at 5" {
  today="$(date -u +%Y%m%d)"
  for i in 1 2 3 4 5; do
    mkdir -p "${SCOPE_FTL_RESULTS_BASE}/${today}T0${i}0000Z"
  done
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -ne 0 ]
}

@test "passes when an old run from a prior day exists but today is fresh" {
  mkdir -p "${SCOPE_FTL_RESULTS_BASE}/20260101T000000Z"
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -eq 0 ]
}

@test "a 1-slot dry-run today still leaves room for the 4-slot full run (PASS)" {
  # The dry-run-then-full pattern: a 1-device dry-run consumed 1 of the 5 daily
  # slots. The 4-device full run needs 4 more; 1 + 4 = 5 fits. The old dir-count
  # gate FAILed here because it saw "1 run today".
  today="$(date -u +%Y%m%d)"
  mkdir -p "${SCOPE_FTL_RESULTS_BASE}/${today}T010000Z"
  echo 1 > "${SCOPE_FTL_RESULTS_BASE}/${today}T010000Z/.slot-count"
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | grep -qE "^\[PASS\] quota"
}

@test "a today dir without a slot-count manifest counts as 1 slot, full run still permitted" {
  today="$(date -u +%Y%m%d)"
  mkdir -p "${SCOPE_FTL_RESULTS_BASE}/${today}T020000Z"
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -eq 0 ]
}

@test "blocks the full run once today's used slots leave fewer than 4 free" {
  # 2 slots already used today; the 4-device full run would push 2 + 4 = 6 over
  # the 5/day Spark cap.
  today="$(date -u +%Y%m%d)"
  mkdir -p "${SCOPE_FTL_RESULTS_BASE}/${today}T030000Z"
  echo 2 > "${SCOPE_FTL_RESULTS_BASE}/${today}T030000Z/.slot-count"
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -ne 0 ]
  printf '%s\n' "$output" | grep -qiE "quota|slot"
}

@test "queries gcloud for every model listed in run-ftl.sh (one source of truth)" {
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -eq 0 ]
  for m in $(grep -oE 'model=[a-zA-Z0-9]+' "${REPO_ROOT}/tools/audit/run-ftl.sh" | cut -d= -f2 | sort -u); do
    grep -qE "(^|[^a-zA-Z0-9])${m}([^a-zA-Z0-9]|$)" "${GCLOUD_LOG}"
  done
  # Pin the filter SYNTAX so a mutation like IFS='@' in the construction
  # cannot pass merely because each model ID happens to appear in the log.
  # Must use gcloud's regex operator `~`, not the colon operator (which silently
  # returns empty for alternation - confirmed against the live FTL catalog).
  grep -qE -- "--filter=id~" "${GCLOUD_LOG}"
  grep -qE -- "\^\([a-zA-Z0-9]+(\|[a-zA-Z0-9]+)+\)\\\$" "${GCLOUD_LOG}"
}

@test "exits 1 when run-ftl.sh has no model= entries (and says so)" {
  empty="${BATS_TEST_TMPDIR}/empty-run-ftl.sh"
  echo "#!/usr/bin/env bash" > "$empty"
  run env SCOPE_FTL_RUN_FTL="$empty" "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -ne 0 ]
  printf '%s\n' "$output" | grep -qE "^\[FAIL\] models"
}

@test "default RESULTS_BASE resolves to <repo-root>/docs/audits, not <repo-root>/tools/docs" {
  unset SCOPE_FTL_RESULTS_BASE
  # Make the quota check pass either way; we only inspect the message text.
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  # Path must contain '/docs/audits/' but never '/tools/docs/'.
  printf '%s\n' "$output" | grep -q "/docs/audits/"
  ! printf '%s\n' "$output" | grep -q "/tools/docs/"
}

@test "prints one summary line per check" {
  run "${REPO_ROOT}/tools/audit/ftl-preflight.sh"
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | grep -qE "^\[(PASS|FAIL)\] billing"
  printf '%s\n' "$output" | grep -qE "^\[(PASS|FAIL)\] models"
  printf '%s\n' "$output" | grep -qE "^\[(PASS|FAIL)\] quota"
}
