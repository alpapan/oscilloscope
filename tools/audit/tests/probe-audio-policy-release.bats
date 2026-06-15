#!/usr/bin/env bats
# Behaviour of the audio-policy release probe wrapper (probe-audio-policy-release.sh).
# It clears a stale on-device results file, runs the AudioPolicyReleaseProbeTest instrumentation
# (which appends one `T_release_ms=NNN firstRms=R iteration=I` line per iteration to that file),
# pulls the file, and parses the `T_release_ms` values into a JSON report. A FILE is used rather
# than logcat because a multi-minute run overflows the logcat ring buffer and evicts early markers.
# Seam: adb is a bare command (PATH-stubbable) AND honoured via ${ADB}; OUT_DIR via SCOPE_PROBE_OUT.

setup() {
  TESTDIR="$(mktemp -d)"
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../.." && pwd)"
  WRAP="${REPO_ROOT}/tools/audit/probe-audio-policy-release.sh"
  BIN="${TESTDIR}/bin"; mkdir -p "$BIN"
  # stub adb: record argv; on `pull`, drop a canned results file (three markers, one the -1 failure
  # sentinel) at the local destination (the LAST argument) so the wrapper has a file to parse.
  cat > "$BIN/adb" <<'EOF'
#!/usr/bin/env bash
echo "$@" >> "${ADB_ARGV}"
case "$*" in
  *"logcat -c"*) ;;
  *"shell rm"*) ;;
  *"am instrument"*) echo "INSTRUMENTATION_STATUS_CODE: 0"; echo "OK (1 test)" ;;
  *"pull"*)
    dst="${@: -1}"
    printf '%s\n' \
      "T_release_ms=120 firstRms=0.40 iteration=1" \
      "T_release_ms=210 firstRms=0.40 iteration=2" \
      "T_release_ms=-1 firstRms=0.40 iteration=3" > "$dst"
    ;;
  *"logcat -d"*) ;;
esac
exit 0
EOF
  chmod +x "$BIN/adb"
  export ADB_ARGV="${TESTDIR}/adb.argv"
  export PATH="$BIN:$PATH"
  export ADB="${BIN}/adb"
  export SCOPE_PROBE_OUT="${TESTDIR}/probe-out"
}
teardown() { rm -rf "$TESTDIR"; }

@test "probe-audio-policy-release: requires a serial argument" {
  run env "$WRAP"
  [ "$status" -eq 2 ]
  [[ "$output" == *"usage:"* ]]
}

@test "probe-audio-policy-release: parses the pulled results file (incl. -1) into a T_release_ms JSON array" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  [[ "$output" == *"T_release_ms"* ]]
  run cat "${SCOPE_PROBE_OUT}/report.json"
  [[ "$output" == *'"T_release_ms":[120,210,-1]'* ]]
}

@test "probe-audio-policy-release: clears the stale results file, instruments the probe, then pulls the file" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -q -- "shell rm" "${TESTDIR}/adb.argv"
  grep -q -- "am instrument" "${TESTDIR}/adb.argv"
  grep -q "com.alpapan.scope.AudioPolicyReleaseProbeTest" "${TESTDIR}/adb.argv"
  grep -q -- "pull" "${TESTDIR}/adb.argv"
  grep -q "audio-probe-results.txt" "${TESTDIR}/adb.argv"
}
