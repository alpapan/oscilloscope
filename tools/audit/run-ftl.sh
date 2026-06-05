#!/usr/bin/env bash
# Run a Robo test of the latest release APK across the FTL physical-device
# matrix. Stays inside the Spark free-tier daily budget by capping --timeout
# at 3m and limiting devices to 4.
#
# Device matrix chosen from the plan's per-OEM fallback chains against the
# live FTL catalog on 2026-06-04 - see
# docs/audits/2026-06-audit/ftl-matrix/chosen-devices.md for the walk:
#   - a35x,version=36       Samsung Galaxy A35 5G   (Android 16)
#   - dm1q,version=35       Samsung Galaxy S23      (Android 15; 2nd Samsung at A15, substituted for absent Xiaomi)
#   - CPH2449,version=34    OnePlus 11 5G           (Android 14)
#   - RE58C2,version=35     realme C53              (Android 15)
set -euo pipefail

# Resolve repo root from this script's own location so relative paths work from
# any CWD.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Injection seams: real defaults for live runs; the bats suite points these at
# its temp dir so tests never read or write the real build/output trees.
APK_BASE="${SCOPE_APK_BASE:-android/app/build/outputs/apk}"
RESULTS_BASE="${SCOPE_FTL_RESULTS_BASE:-docs/audits/2026-06-audit/ftl-results}"
GRADLEW="${GRADLEW:-./gradlew}"

# Lint + typecheck must run before gradle.
npm run lint
npm run typecheck

# Build with debug fallback (only when no APK is present yet). The project names
# its artifact scope-<version>.apk, so match any *.apk in the build tree.
APK="$(find "$APK_BASE" -name '*.apk' -type f -print -quit)"
if [[ -z "$APK" ]]; then
  ( cd android && "$GRADLEW" --no-daemon assembleRelease ) || \
    ( cd android && "$GRADLEW" --no-daemon assembleDebug )
  APK="$(find "$APK_BASE" -name '*.apk' -type f -print -quit)"
fi
if [[ -z "$APK" ]]; then
  cat >&2 <<'MSG'
ERROR: Both assembleRelease AND assembleDebug failed; no APK produced.

To diagnose:
  cd android && ./gradlew --no-daemon assembleRelease
  cd android && ./gradlew --no-daemon assembleDebug

The release path needs ~/.android/scope-release.keystore.
MSG
  exit 1
fi

# Pick Robo script: default to by-resourceid, override via SCRIPT env var.
SCRIPT="${SCRIPT:-docs/audits/2026-06-audit/ftl-matrix/robo-script-by-resourceid.json}"

# Device matrix. One Spark slot is consumed per --device entry, so the array
# length is the slot count recorded below for the preflight quota model. Keep
# the literal `model=` in each entry: ftl-preflight.sh greps this file for
# `model=` as its single source of truth for the device list.
DEVICE_MODELS=(
  "model=a35x,version=36,locale=en,orientation=portrait"
  "model=dm1q,version=35,locale=en,orientation=portrait"
  "model=CPH2449,version=34,locale=en,orientation=portrait"
  "model=RE58C2,version=35,locale=en,orientation=portrait"
)
device_args=()
for d in "${DEVICE_MODELS[@]}"; do
  device_args+=( --device "$d" )
done

RESULTS_DIR="${RESULTS_BASE}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RESULTS_DIR"
# Record the slots this submission consumes (one per device) so ftl-preflight.sh
# sums real slots against the 5/day Spark cap instead of counting result dirs.
printf '%s\n' "${#DEVICE_MODELS[@]}" > "${RESULTS_DIR}/.slot-count"

gcloud firebase test android run \
  --type robo \
  --app "$APK" \
  "${device_args[@]}" \
  --robo-script "$SCRIPT" \
  --timeout 3m \
  --results-dir "$RESULTS_DIR" \
  --results-history-name "scope-audit"
