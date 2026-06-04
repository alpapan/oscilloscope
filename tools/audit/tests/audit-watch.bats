#!/usr/bin/env bats

# Watch wrapper around audio-causality-probe.sh. Loops until every named
# device has produced a PASS verdict.txt, or until a deadline elapses.

load helpers/setup

setup() {
  audit_setup
  export OUT="${BATS_TEST_TMPDIR}/runs"
  mkdir -p "$OUT"
  # Shim the probe: read PROBE_BEHAVIOR map to decide pass/fail per device.
  cat > "${BATS_TEST_TMPDIR}/audio-causality-probe.sh" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
dev="$1"
mkdir -p "${OUT}/${dev}"
varname="PROBE_BEHAVIOR_FOR_${dev}"
behavior="${!varname:-fail}"
if [[ "$behavior" == "pass" ]]; then
  echo "PASS play_median=1 pause_median=0 resume_median=1" > "${OUT}/${dev}/verdict.txt"
  exit 0
else
  exit 1
fi
EOF
  chmod +x "${BATS_TEST_TMPDIR}/audio-causality-probe.sh"
  export PROBE="${BATS_TEST_TMPDIR}/audio-causality-probe.sh"
  export WATCH="${REPO_ROOT}/tools/audit/audit-watch.sh"
}

@test "exits 0 immediately when every named device already has a PASS verdict" {
  for dev in lion sabrina; do
    mkdir -p "${OUT}/${dev}"
    echo "PASS already" > "${OUT}/${dev}/verdict.txt"
  done
  run env MAX_SEC=10 POLL_SEC=1 "${WATCH}" lion sabrina
  [ "$status" -eq 0 ]
  [[ "$output" == *"all named devices PASS"* ]]
}

@test "runs the probe for a device that has no verdict yet" {
  run env PROBE_BEHAVIOR_FOR_nokia=pass MAX_SEC=10 POLL_SEC=1 "${WATCH}" nokia
  [ "$status" -eq 0 ]
  [ -f "${OUT}/nokia/verdict.txt" ]
  grep -q "^PASS" "${OUT}/nokia/verdict.txt"
}

@test "keeps retrying a failing device and exits with the deadline reached" {
  run env MAX_SEC=3 POLL_SEC=1 "${WATCH}" lion
  [ "$status" -ne 0 ]
  [[ "$output" == *"deadline reached"* ]]
  [[ "$output" == *"lion"* ]]
}

@test "skips a device that PASSed in an earlier iteration on subsequent rounds" {
  # Pre-seed lion as already-PASS, sabrina as failing.
  mkdir -p "${OUT}/lion"
  echo "PASS already" > "${OUT}/lion/verdict.txt"
  run env MAX_SEC=3 POLL_SEC=1 "${WATCH}" lion sabrina
  # Watch should NOT have re-touched lion's verdict.txt.
  [ "$status" -ne 0 ]
  grep -q "^PASS already" "${OUT}/lion/verdict.txt"
}

@test "kills a hung probe after PROBE_TIMEOUT and retries on the next iteration" {
  # Shim sleeps longer than PROBE_TIMEOUT; watch must not wedge.
  cat > "${BATS_TEST_TMPDIR}/audio-causality-probe.sh" <<'EOF'
#!/usr/bin/env bash
sleep 30
EOF
  chmod +x "${BATS_TEST_TMPDIR}/audio-causality-probe.sh"
  start=$(date +%s)
  run env MAX_SEC=4 POLL_SEC=1 PROBE_TIMEOUT=1 "${WATCH}" lion
  elapsed=$(( $(date +%s) - start ))
  # Without the timeout the script would sleep 30s. With the timeout it
  # should hit MAX_SEC=4 and exit at ~4-5s. Generous upper bound 12s.
  [ "$status" -ne 0 ]
  [ "$elapsed" -lt 12 ]
}
