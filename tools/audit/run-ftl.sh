#!/usr/bin/env bash
# Run a Robo test of the latest release APK across the FTL physical-device
# matrix. Stays inside the Spark free-tier daily budget by capping --timeout
# at 3m and limiting devices to 4.
#
# PREREQUISITE before first real run: edit the four `model=` placeholders below
# (a35x, redmi13, salami, rmx3370) to the values chosen in
# docs/audits/2026-06-audit/ftl-matrix/chosen-devices.md. Unedited placeholders
# will fail `gcloud firebase test android run` against the live catalog.
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

# Lint + typecheck must run before gradle.
npm run lint
npm run typecheck

# Build with debug fallback (only when no APK is present yet).
APK_PATH="${APK_BASE}/release/app-release.apk"
if [[ ! -f "$APK_PATH" ]]; then
  ( cd android && ./gradlew --no-daemon assembleRelease ) || \
    ( cd android && ./gradlew --no-daemon assembleDebug )
fi
APK="$(find "$APK_BASE" -name 'app-*.apk' -type f -print -quit)"
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

RESULTS_DIR="${RESULTS_BASE}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RESULTS_DIR"

gcloud firebase test android run \
  --type robo \
  --app "$APK" \
  --device model=a35x,version=36,locale=en,orientation=portrait \
  --device model=redmi13,version=35,locale=en,orientation=portrait \
  --device model=salami,version=34,locale=en,orientation=portrait \
  --device model=rmx3370,version=34,locale=en,orientation=portrait \
  --robo-script "$SCRIPT" \
  --timeout 3m \
  --results-dir "$RESULTS_DIR" \
  --results-history-name "scope-audit"
