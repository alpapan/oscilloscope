#!/usr/bin/env bats
# Behaviour of the audio-policy release probe wrapper (probe-audio-policy-release.sh).
# It clears logcat, runs the AudioPolicyReleaseProbeTest instrumentation, dumps logcat,
# then parses the `SCOPE_AUDIO_PROBE ... T_release_ms=NNN` markers into a JSON report.
# Seam: adb is a bare command (PATH-stubbable) AND honoured via ${ADB}; OUT_DIR via SCOPE_PROBE_OUT.

setup() {
  TESTDIR="$(mktemp -d)"
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../.." && pwd)"
  WRAP="${REPO_ROOT}/tools/audit/probe-audio-policy-release.sh"
  BIN="${TESTDIR}/bin"; mkdir -p "$BIN"
  # stub adb: record argv; emit a canned logcat carrying three probe markers, one of which is
  # the -1 failure sentinel (capture never produced audio within the deadline).
  cat > "$BIN/adb" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${TESTDIR}/adb.argv"
case "\$*" in
  *"logcat -c"*) ;;
  *"am instrument"*) echo "INSTRUMENTATION_STATUS_CODE: 0"; echo "OK (1 test)" ;;
  *"logcat -d"*)
    echo "06-09 12:00:00.000 123 456 I SCOPE_AUDIO_PROBE: T_release_ms=120 firstRms=0.40 iteration=1"
    echo "06-09 12:00:01.000 123 456 I SCOPE_AUDIO_PROBE: T_release_ms=210 firstRms=0.40 iteration=2"
    echo "06-09 12:00:02.000 123 456 I SCOPE_AUDIO_PROBE: T_release_ms=-1 firstRms=0.40 iteration=3"
    ;;
esac
exit 0
EOF
  chmod +x "$BIN/adb"
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

@test "probe-audio-policy-release: parses markers (incl. -1) into a T_release_ms JSON array" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  [[ "$output" == *"T_release_ms"* ]]
  run cat "${SCOPE_PROBE_OUT}/report.json"
  [[ "$output" == *'"T_release_ms":[120,210,-1]'* ]]
}

@test "probe-audio-policy-release: clears logcat, instruments the probe class, then dumps logcat" {
  run env "$WRAP" 192.168.0.99:5555
  [ "$status" -eq 0 ]
  grep -q -- "logcat -c" "${TESTDIR}/adb.argv"
  grep -q -- "am instrument" "${TESTDIR}/adb.argv"
  grep -q "com.alpapan.scope.AudioPolicyReleaseProbeTest" "${TESTDIR}/adb.argv"
  grep -q -- "logcat -d" "${TESTDIR}/adb.argv"
}
