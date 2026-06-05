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
