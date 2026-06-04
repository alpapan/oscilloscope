#!/usr/bin/env bash
# Watch wrapper around audio-causality-probe.sh.
#
# Re-runs the probe for any named device that does not yet have a PASS verdict.
# Exits 0 the moment every named device has a `PASS ...` verdict.txt.
# Exits non-zero if the MAX_SEC deadline elapses with devices still failing.
#
# A device whose probe fails (network down, pairing stale, app not installed,
# etc) is silently retried POLL_SEC seconds later. The probe's own stderr/stdout
# is captured per-iteration into $OUT/$dev/.watch.log so failures stay debuggable.
#
# Usage:
#   tools/audit/audit-watch.sh <device-codename>...
# Env:
#   PROBE      path to audio-causality-probe.sh (default: alongside this script)
#   OUT        evidence root (default: docs/audits/2026-06-audit/emulator-runs)
#   MAX_SEC    deadline in seconds (default: 7200 = 2 hours)
#   POLL_SEC   sleep between iterations (default: 60)
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROBE="${PROBE:-${SCRIPT_DIR}/audio-causality-probe.sh}"
OUT="${OUT:-docs/audits/2026-06-audit/emulator-runs}"
MAX_SEC="${MAX_SEC:-7200}"
POLL_SEC="${POLL_SEC:-60}"
# Each individual probe run is capped so a wedged adb / uiautomator does
# not block the whole watch loop. The probe itself is sequential so the
# normal end-to-end run takes ~70s on a tablet; 180s is a generous ceiling.
PROBE_TIMEOUT="${PROBE_TIMEOUT:-180}"

# This wrapper assumes a SINGLE running watch instance per OUT dir.
# Two concurrent watches against the same OUT would race on the .watch.log
# append and on verdict.txt; the script does not lock against that case.

[[ $# -ge 1 ]] || { echo "usage: $0 <device-codename>..." >&2; exit 1; }
DEVICES=("$@")

has_pass() {
  local v="${OUT}/$1/verdict.txt"
  [[ -f "$v" ]] && grep -q '^PASS' "$v"
}

start=$(date +%s)
deadline=$(( start + MAX_SEC ))
while (( $(date +%s) < deadline )); do
  remaining=()
  for dev in "${DEVICES[@]}"; do
    has_pass "$dev" && continue
    mkdir -p "${OUT}/${dev}"
    if timeout "$PROBE_TIMEOUT" bash "$PROBE" "$dev" >> "${OUT}/${dev}/.watch.log" 2>&1; then
      :
    else
      remaining+=("$dev")
    fi
  done
  if (( ${#remaining[@]} == 0 )); then
    echo "all named devices PASS: ${DEVICES[*]}"
    exit 0
  fi
  sleep "$POLL_SEC"
done

still_failing=()
for dev in "${DEVICES[@]}"; do
  has_pass "$dev" || still_failing+=("$dev")
done
echo "deadline reached after ${MAX_SEC}s; still failing: ${still_failing[*]}"
exit 1
