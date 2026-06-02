#!/usr/bin/env bash
# Build the Scope APK and run one journey against one AVD. Refuses journeys
# marked emulator:false in manifest.yaml so audio-dependent flows are not
# false-failed on emulators. Lint+typecheck gate before any gradle build;
# release build with debug fallback; serial-scoped boot-wait; annotated
# screenshot with a plain fallback.
set -euo pipefail

AVD="${1:?usage: run-journey.sh <avd-name> <journey.xml>}"
JOURNEY="${2:?usage: run-journey.sh <avd-name> <journey.xml>}"

# Resolve the repo root from this script's own location so the relative paths
# below work regardless of the caller's CWD.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Fail fast on a bad journey path rather than building/installing for a journey
# that cannot be run.
[[ -f "$JOURNEY" ]] || { echo "ERROR: journey file not found: $JOURNEY" >&2; exit 1; }

MANIFEST="docs/audits/2026-06-audit/journeys/manifest.yaml"
JOURNEY_ID="$(basename "$JOURNEY" .xml)"

# Injection seams: real defaults for live runs; the bats suite overrides these
# to keep all writes inside its temp dir and to shim the gradle wrapper (an
# explicit ./gradlew would bypass a PATH-based stub).
APK_BASE="${SCOPE_APK_BASE:-android/app/build/outputs/apk}"
OUT_BASE="${SCOPE_OUT_BASE:-docs/audits/2026-06-audit/emulator-runs}"
GRADLEW="${GRADLEW:-./gradlew}"

OUT_DIR="${OUT_BASE}/${AVD}"
mkdir -p "$OUT_DIR"

# Manifest gate.
if awk -v id="$JOURNEY_ID" '
  /^  - id: / {cur=$3}
  cur==id && /emulator: false/ {found=1; exit}
  END {exit !found}
' "$MANIFEST"; then
  echo "REFUSED: ${JOURNEY_ID} is marked emulator:false in manifest.yaml." >&2
  exit 2
fi

# Lint + typecheck must pass before any gradle build.
npm run lint
npm run typecheck

# Build with debug fallback.
EXPECTS_RELEASE_SIGNED=true
if ! ( cd android && "$GRADLEW" --no-daemon assembleRelease ); then
  echo "Release build failed; falling back to debug APK." >&2
  ( cd android && "$GRADLEW" --no-daemon assembleDebug )
  EXPECTS_RELEASE_SIGNED=false
fi
if [[ "$EXPECTS_RELEASE_SIGNED" == "true" ]]; then
  APK="$(find "$APK_BASE/release" -name '*.apk' -type f -print -quit)"
else
  APK="$(find "$APK_BASE/debug" -name '*.apk' -type f -print -quit)"
fi
[[ -n "$APK" ]] || { echo "No APK produced." >&2; exit 1; }

# Boot the AVD headless (the audit host has no display) in the background, then
# poll sys.boot_completed against the explicit emulator serial. Other (LAN/USB)
# devices may be attached, so every adb call is serial-scoped. The android CLI's
# `emulator start` cannot run headless, so the emulator binary is used directly.
EMULATOR_BIN="${ANDROID_HOME:-$HOME/Android/Sdk}/emulator/emulator"
ADB="${HOME}/Android/Sdk/platform-tools/adb"
"$EMULATOR_BIN" @"$AVD" -no-window -no-snapshot -no-audio -no-boot-anim -gpu swiftshader_indirect &
EMU_PID=$!
MAX_WAIT=300
WAITED=0
EMU_SERIAL=""
while true; do
  EMU_SERIAL="$("$ADB" devices | awk '/^emulator-[0-9]+[[:space:]]+device/ {print $1; exit}')"
  if [[ -n "$EMU_SERIAL" ]] \
     && [[ "$("$ADB" -s "$EMU_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '[:space:]')" == "1" ]]; then
    break
  fi
  sleep 3
  WAITED=$((WAITED+3))
  if [[ "$WAITED" -ge "$MAX_WAIT" ]]; then
    echo "ERROR: emulator did not finish booting within ${MAX_WAIT}s." >&2
    [[ -n "$EMU_SERIAL" ]] && "$ADB" -s "$EMU_SERIAL" emu kill 2>/dev/null || true
    exit 1
  fi
done

# Install (uninstall first when downgrading to a debug-signed APK).
if [[ "$EXPECTS_RELEASE_SIGNED" == "false" ]]; then
  "$ADB" -s "$EMU_SERIAL" uninstall com.alpapan.scope || true
fi
"$ADB" -s "$EMU_SERIAL" install -r "$APK"

# Launch the app so the screenshot shows it (install alone leaves the launcher
# up), then give the Capacitor WebView time to render. The WebView package can
# still be settling right after a cold boot, so allow generous headroom.
"$ADB" -s "$EMU_SERIAL" shell monkey -p com.alpapan.scope -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 10

# Capture a screenshot via the emulator's adb (serial-scoped, since other
# devices may be attached). `android screen capture` cannot target a specific
# device when multiple are online, so use adb screencap directly.
SHOT="${OUT_DIR}/${JOURNEY_ID}.png"
"$ADB" -s "$EMU_SERIAL" exec-out screencap -p > "$SHOT"
[[ -s "$SHOT" ]] || { echo "ERROR: screenshot failed." >&2; exit 3; }

"$ADB" -s "$EMU_SERIAL" emu kill 2>/dev/null || true
wait "$EMU_PID" 2>/dev/null || true
