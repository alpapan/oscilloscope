#!/usr/bin/env bash
# Measure the audio-policy release latency (bug #2): after a system-audio capture is stopped,
# how long until a fresh back-to-back capture actually produces audio (RMS > 0)? The
# AudioPolicyReleaseProbeTest instrumentation does N capture/stop/recapture iterations and APPENDS
# `T_release_ms=<ms> firstRms=<r> iteration=<i>` per iteration to a results FILE on the device
# (-1 == capture never produced audio within the deadline, i.e. the policy was still held).
#
# Markers go to a FILE, not logcat: a multi-minute run floods the logcat ring buffer and evicts the
# early iterations' markers (only the last ~2 survive a `logcat -d`), which silently truncated the
# distribution to 2 samples. The on-device file survives the whole run, so all N samples are read.
# logcat is still dumped as a debug artifact, but it is NOT the source of truth.
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
RESULTS_ON_DEVICE="/sdcard/Android/data/${PKG}/files/journeys/audio-probe-results.txt"
SERIAL_SAFE="${SERIAL//[^A-Za-z0-9._-]/_}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${SCOPE_PROBE_OUT:-docs/audits/2026-06-audit/probes/${TS}-${SERIAL_SAFE}}"
mkdir -p "$OUT_DIR"

# Clear any stale results file from a prior run (the test also truncates at start, but a crashed
# prior run could leave one behind), clear logcat, run the probe, then pull the durable results file.
"$ADB" -s "$SERIAL" shell rm -f "$RESULTS_ON_DEVICE" || true
"$ADB" -s "$SERIAL" logcat -c || true
"$ADB" -s "$SERIAL" shell am instrument -w -e class "${PKG}.AudioPolicyReleaseProbeTest" "$RUNNER" 2>&1 | tee "$OUT_DIR/instrument.log" || true
"$ADB" -s "$SERIAL" pull "$RESULTS_ON_DEVICE" "$OUT_DIR/audio-probe-results.txt" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" logcat -d > "$OUT_DIR/logcat.txt" 2>/dev/null || true

# Parse every `T_release_ms=<int>` (keep the -1 failure sentinel) from the pulled file into a JSON array.
# Distinguish the two empty-ish outcomes downstream: a value of -1 means that iteration ran but the
# recaptured audio never rose above the RMS floor within the deadline (policy still held); an EMPTY
# array (`"T_release_ms":[]`) means the probe wrote no markers at all - the instrumentation crashed
# or never started, so there is no distribution to interpret, not "zero latency".
values="$(grep -oE 'T_release_ms=-?[0-9]+' "$OUT_DIR/audio-probe-results.txt" 2>/dev/null | sed -E 's/.*=(-?[0-9]+).*/\1/' | paste -sd, || true)"
printf '{"T_release_ms":[%s]}\n' "$values" > "$OUT_DIR/report.json"

echo "Report: $OUT_DIR/report.json"
grep -h . "$OUT_DIR/report.json"
