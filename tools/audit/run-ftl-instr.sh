#!/usr/bin/env bash
# Run the Scope instrumentation suite on Firebase Test Lab and pull the per-step
# screenshots locally. One gcloud invocation == one Spark slot per --device.
# Default matrix is VIRTUAL (10/day); --physical uses the OEM matrix (5/day).
# Authoritative quota: tools/audit/ftl-preflight.sh --report.
# Usage: tools/audit/run-ftl-instr.sh [--physical] [--test-targets "class ..."]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

APK_BASE="${SCOPE_APK_BASE:-android/app/build/outputs/apk}"
RESULTS_BASE="${SCOPE_FTL_RESULTS_BASE:-docs/audits/2026-06-audit/ftl-instr-results}"
GRADLEW="${GRADLEW:-./gradlew}"
PROJECT="${SCOPE_FTL_PROJECT:-scope-audit-202606b}"
PULL_DIR="/sdcard/Android/data/com.alpapan.scope/files/journeys"

CLASS_VIRTUAL=(
  "model=MediumPhone.arm,version=34,locale=en,orientation=portrait"
  "model=MediumPhone.arm,version=35,locale=en,orientation=portrait"
  "model=MediumPhone.arm,version=36,locale=en,orientation=portrait"
)
CLASS_PHYSICAL=(
  "model=a35x,version=36,locale=en,orientation=portrait"
  "model=dm1q,version=35,locale=en,orientation=portrait"
  "model=CPH2449,version=34,locale=en,orientation=portrait"
  "model=RE58C2,version=35,locale=en,orientation=portrait"
)

SLOT_CLASS="virtual"
DEVICE_MODELS=("${CLASS_VIRTUAL[@]}")
TEST_TARGETS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --physical) SLOT_CLASS="physical"; DEVICE_MODELS=("${CLASS_PHYSICAL[@]}"); shift ;;
    --test-targets) TEST_TARGETS="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Phase E1: physical-matrix preflight quota gate, run BEFORE the build so an out-of-quota run
# never wastes time assembling APKs. ftl-preflight --report is authoritative for Spark PHYSICAL
# slots only (it queries spark_physical_tests); the virtual matrix (10/day) is not covered, so the
# hard gate applies to --physical runs and virtual runs are logged-through, not silently skipped.
FTL_PREFLIGHT="${FTL_PREFLIGHT:-tools/audit/ftl-preflight.sh}"
if [[ "$SLOT_CLASS" == "physical" ]]; then
  preflight_report="$("$FTL_PREFLIGHT" --report 2>/dev/null || true)"
  remaining="$(printf '%s\n' "$preflight_report" | grep -oE '[0-9]+ remaining' | grep -oE '^[0-9]+' || true)"
  needed=${#DEVICE_MODELS[@]}
  if [[ ! "$remaining" =~ ^[0-9]+$ ]]; then
    echo "ERROR: ftl-preflight could not verify remaining physical quota; aborting to avoid burning a slot." >&2
    echo "  report: ${preflight_report:-<no output>}" >&2
    exit 3
  fi
  if (( remaining < needed )); then
    echo "ERROR: ftl-preflight reports ${remaining} physical slot(s) remaining but this run needs ${needed}; aborting." >&2
    exit 3
  fi
  echo "Preflight: ${remaining} physical slot(s) remaining; this run needs ${needed} - proceeding."
else
  echo "Preflight: virtual matrix (ftl-preflight --report covers physical slots only); physical quota gate not applicable."
fi

npm run lint
npm run typecheck

( cd android && "$GRADLEW" --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest )

APP_APK="$(find "$APK_BASE/debug" -name '*.apk' -type f -print -quit)"
TEST_APK="$(find "$APK_BASE/androidTest/debug" -name '*androidTest*.apk' -type f -print -quit)"
if [[ -z "$APP_APK" || -z "$TEST_APK" ]]; then
  {
    echo "ERROR: APK(s) not found under $APK_BASE"
    echo "  app  APK: '${APP_APK:-<none>}'"
    echo "  test APK: '${TEST_APK:-<none>}'"
    echo "  --- *.apk present under $APK_BASE ---"
    find "$APK_BASE" -name '*.apk' -type f -printf '  %p\n' 2>/dev/null || echo "  (none)"
  } >&2
  exit 1
fi

device_args=()
for d in "${DEVICE_MODELS[@]}"; do device_args+=( --device "$d" ); done

RESULTS_DIR="${RESULTS_BASE}/$(date -u +%Y%m%dT%H%M%SZ)-${SLOT_CLASS}"
mkdir -p "$RESULTS_DIR"
printf '%s\n' "${#DEVICE_MODELS[@]}" > "${RESULTS_DIR}/.slot-count"
printf '%s\n' "$SLOT_CLASS"        > "${RESULTS_DIR}/.slot-class"

targets_args=()
[[ -n "$TEST_TARGETS" ]] && targets_args+=( --test-targets "$TEST_TARGETS" )

LOG="${RESULTS_DIR}/gcloud.log"
# A non-zero gcloud exit usually means some instrumentation tests failed - we still
# want to pull the screenshots that WERE produced, so do not abort, but surface the
# exit code explicitly instead of masking it with `|| true`.
set +e
gcloud firebase test android run \
  --project "$PROJECT" \
  --type instrumentation \
  --app "$APP_APK" \
  --test "$TEST_APK" \
  "${device_args[@]}" \
  "${targets_args[@]}" \
  --directories-to-pull "$PULL_DIR" \
  --timeout 15m \
  --results-history-name "scope-instr" 2>&1 | tee "$LOG"
gc_rc=${PIPESTATUS[0]}
set -e
if [[ "$gc_rc" -ne 0 ]]; then
  echo "WARN: gcloud firebase test exited $gc_rc (some instrumentation tests may have failed); see $LOG and the pulled artifacts below" >&2
fi

GS="$(grep -oE 'gs://[^ ]+' "$LOG" | head -n1 || true)"
if [[ -n "$GS" ]]; then
  if gsutil -m cp -r "${GS%/}/**" "$RESULTS_DIR/"; then
    echo "Screenshots collated under: $RESULTS_DIR"
  else
    rc=$?
    {
      echo "WARN: gsutil pull failed (exit $rc); artifacts remain on GCS."
      echo "  GCS: $GS"
      echo "  retrieve manually: gsutil -m cp -r '${GS%/}/**' '$RESULTS_DIR/'"
    } >&2
  fi
else
  echo "WARN: no gs:// results path found in gcloud output; check $LOG" >&2
fi

# Phase E3: surface any shot whose diag.json reports a failed gate (wasGated:false). FTL nests
# artifacts per device, so search the whole results tree rather than a fixed journeys/ glob. This
# does NOT abort (the artifacts are already pulled and are the only postmortem surface) but makes a
# silent gate failure - a test that "passed" while its screenshot proves nothing - loud.
gate_failures="$(find "$RESULTS_DIR" -name '*.diag.json' -exec grep -l '"wasGated":false' {} + 2>/dev/null || true)"
if [[ -n "$gate_failures" ]]; then
  echo "RESULT: gate failure(s) detected - a shot's diag.json reports wasGated:false:" >&2
  echo "$gate_failures" >&2
fi
