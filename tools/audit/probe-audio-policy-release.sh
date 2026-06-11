#!/usr/bin/env bash
# Measure the audio-policy release latency (bug #2): after a system-audio capture is stopped,
# how long until a fresh back-to-back capture actually produces audio (RMS > 0)? The
# AudioPolicyReleaseProbeTest instrumentation does N capture/stop/recapture iterations and logs
# `SCOPE_AUDIO_PROBE T_release_ms=<ms>` per iteration (-1 == capture never produced audio within
# the deadline, i.e. the policy was still held). This wrapper runs it, dumps logcat, and parses
# the markers into a JSON array so Phase C3 can pick the workaround from the distribution.
#
# Usage: tools/audit/probe-audio-policy-release.sh <adb-serial>
set -euo pipefail

SERIAL="${1:-}"
if [[ -z "$SERIAL" ]]; then
  echo "usage: tools/audit/probe-audio-policy-release.sh <adb-serial>" >&2
  exit 2
fi

ADB="${ADB:-adb}"
PKG="com.alpapan.scope"
RUNNER="${PKG}.test/androidx.test.runner.AndroidJUnitRunner"
SERIAL_SAFE="${SERIAL//[^A-Za-z0-9._-]/_}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${SCOPE_PROBE_OUT:-docs/audits/2026-06-audit/probes/${TS}-${SERIAL_SAFE}}"
mkdir -p "$OUT_DIR"

# Clear, run the probe (am instrument exits 0 even on test failure; the signal is the logcat
# markers, not the exit code), then dump the buffer.
"$ADB" -s "$SERIAL" logcat -c || true
"$ADB" -s "$SERIAL" shell am instrument -w -e class "${PKG}.AudioPolicyReleaseProbeTest" "$RUNNER" 2>&1 | tee "$OUT_DIR/instrument.log" || true
"$ADB" -s "$SERIAL" logcat -d > "$OUT_DIR/logcat.txt" 2>/dev/null || true

# Parse every `T_release_ms=<int>` (keep the -1 failure sentinel) into a JSON array.
values="$(grep -oE 'T_release_ms=-?[0-9]+' "$OUT_DIR/logcat.txt" 2>/dev/null | sed -E 's/.*=(-?[0-9]+).*/\1/' | paste -sd, || true)"
printf '{"T_release_ms":[%s]}\n' "$values" > "$OUT_DIR/report.json"

echo "Report: $OUT_DIR/report.json"
grep -h . "$OUT_DIR/report.json"
