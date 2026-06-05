#!/usr/bin/env bash
# Free-tier safety checks before running tools/audit/run-ftl.sh.
# Verifies (1) billing is OFF on the FTL project, (2) the 4 device models in
# run-ftl.sh exist in the live Firebase Test Lab catalog, (3) today's UTC FTL
# results dir is empty. Exits non-zero on any failed check. All three are
# read-only queries; no submit happens.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Script lives at tools/audit/, so repo root is two levels up.
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROJECT="${SCOPE_FTL_PROJECT:-scope-audit-202606b}"
RESULTS_BASE="${SCOPE_FTL_RESULTS_BASE:-$REPO_ROOT/docs/audits/2026-06-audit/ftl-results}"
RUN_FTL="${SCOPE_FTL_RUN_FTL:-$SCRIPT_DIR/run-ftl.sh}"

fail=0
say() { printf '[%s] %s: %s\n' "$1" "$2" "$3"; }

# --report mode: query gcloud for cap and Cloud Monitoring for usage, print quota summary, exit early.
if [[ "${1:-}" == "--report" ]]; then
  # Get Spark physical daily cap; fall back to 5 if not a positive integer.
  cap="$(gcloud alpha services quota list --service=testing.googleapis.com --consumer="projects/${PROJECT}" --filter='metric:testing.googleapis.com/spark_physical_tests' --format='value(consumerQuotaLimits[0].quotaBuckets[0].effectiveLimit)' 2>/dev/null || true)"
  [[ "$cap" =~ ^[0-9]+$ ]] && [[ "$cap" -gt 0 ]] || cap=5

  # Query Cloud Monitoring for net_usage DELTA points since today's quota-day reset (midnight Pacific).
  pday="$(TZ=America/Los_Angeles date +%Y-%m-%d)"
  start="$(date -u -d "TZ=\"America/Los_Angeles\" ${pday} 00:00:00" +%Y-%m-%dT%H:%M:%SZ)"
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  token="$(gcloud auth print-access-token 2>/dev/null || true)"
  # `used` stays empty (=> degraded branch) if EITHER signal fails: curl -sf
  # makes an HTTP 4xx/5xx (auth/permission) a non-zero exit rather than a 200
  # error-body that jq would silently reduce to 0; and jq failing to parse a
  # malformed 200 body leaves `used` empty too. A real 0-usage day returns a
  # parseable body and yields used=0, which is NOT degraded.
  used=""
  if raw="$(curl -sf -G "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries" \
      --data-urlencode 'filter=metric.type="serviceruntime.googleapis.com/quota/rate/net_usage" AND metric.labels.quota_metric="testing.googleapis.com/spark_physical_tests"' \
      --data-urlencode "interval.startTime=${start}" \
      --data-urlencode "interval.endTime=${end}" \
      -H "Authorization: Bearer ${token}" 2>/dev/null)"; then
    used="$(printf '%s' "$raw" | jq '[.timeSeries[]?.points[]?.value.int64Value | tonumber] | add // 0' 2>/dev/null || true)"
  fi

  if [[ "$used" =~ ^[0-9]+$ ]]; then
    remaining=$(( cap - used ))
    (( remaining < 0 )) && remaining=0
    printf '[REPORT] quota: used %d/%d Spark physical FTL slots today (resets midnight Pacific); %d remaining\n' "$used" "$cap" "$remaining"
    exit 0
  fi

  # Usage genuinely unknown: do NOT print a remaining count that an operator
  # might trust to spend a slot. Surface the failure and exit non-zero.
  printf '[REPORT] quota: UNVERIFIED - Cloud Monitoring usage query failed (auth/network/API); Spark physical cap is %d/day, used-today unknown\n' "$cap"
  printf 'ftl-preflight: could not read Spark physical usage from Cloud Monitoring; do not assume the full cap is free.\n' >&2
  exit 2
fi

# 1. Billing must be OFF (Spark eligibility).
billing="$(gcloud beta billing projects describe "$PROJECT" 2>/dev/null || true)"
if printf '%s' "$billing" | grep -qiE 'billingEnabled:[[:space:]]*true'; then
  say FAIL billing "project $PROJECT has billing ENABLED (Blaze) - run-ftl.sh would bill"
  fail=1
else
  say PASS billing "$PROJECT billing disabled (Spark)"
fi

# 2. Every model listed in run-ftl.sh must appear in the live catalog. One
# source of truth: grep run-ftl.sh for `model=NAME` rather than duplicating.
# Case-sensitive [a-zA-Z0-9]+ because real FTL model IDs are mixed-case
# (e.g. CPH2449, RE58C2, dm1q, a35x).
mapfile -t models < <(grep -oE 'model=[a-zA-Z0-9]+' "$RUN_FTL" | cut -d= -f2 | sort -u)
if [[ "${#models[@]}" -eq 0 ]]; then
  say FAIL models "no model= entries found in $RUN_FTL"
  fail=1
else
  # gcloud Cloud Resource Filter: `id:(a|b)` does NOT do OR matching -
  # it returns empty. Use the regex operator `~` with an anchored alternation.
  # --format='value(id)' forces one bare model ID per line so the loop below
  # cannot false-match on header rows or decorated output.
  filter="id~\"^($(IFS='|'; echo "${models[*]}"))\$\""
  catalog="$(gcloud firebase test android models list --filter="$filter" --format='value(id)' 2>/dev/null || true)"
  missing=()
  for m in "${models[@]}"; do
    printf '%s' "$catalog" | grep -qE "(^|[^a-z0-9])${m}([^a-z0-9]|$)" || missing+=("$m")
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    say FAIL models "missing from live catalog: ${missing[*]}"
    fail=1
  else
    say PASS models "all ${#models[@]} models present: ${models[*]}"
  fi
fi

# 3. Today's UTC quota, counted in Spark device-slots rather than result dirs.
# A 4-device matrix consumes 4 of the 5 daily slots from a single dir; a
# 1-device dry-run consumes 1. run-ftl.sh records the slots it consumed in
# <run-dir>/.slot-count; a today-dir without that file is counted as 1 slot (at
# least one device was submitted). The next run's slot need is the count of
# `--device model=` entries in run-ftl.sh (same source of truth as the model
# check above). FAIL only if used + next would exceed the daily cap, so the
# dry-run-then-full pattern is not blocked. Re-resolve `today` here (not at
# script start) so a midnight roll-over during the run does not race the check.
DAILY_CAP="${SCOPE_FTL_DAILY_CAP:-5}"
next_slots=$(grep -cE 'model=[a-zA-Z0-9]+' "$RUN_FTL" 2>/dev/null || true)
[[ "$next_slots" =~ ^[0-9]+$ ]] || next_slots=0
today="$(date -u +%Y%m%d)"
used_slots=0
if [[ -d "$RESULTS_BASE" ]]; then
  while IFS= read -r d; do
    n=1
    if [[ -f "$d/.slot-count" ]]; then
      read -r n < "$d/.slot-count" || n=1
      [[ "$n" =~ ^[0-9]+$ ]] || n=1
    fi
    used_slots=$((used_slots + n))
  done < <(find "$RESULTS_BASE" -mindepth 1 -maxdepth 1 -type d -name "${today}T*" 2>/dev/null)
fi
if (( used_slots + next_slots > DAILY_CAP )); then
  say FAIL quota "today uses ${used_slots} slot(s); next run needs ${next_slots}; ${used_slots}+${next_slots} exceeds ${DAILY_CAP}/day Spark cap under $RESULTS_BASE"
  fail=1
else
  say PASS quota "${used_slots}/${DAILY_CAP} slots used today; next run (${next_slots}) fits under $RESULTS_BASE"
fi

exit "$fail"
