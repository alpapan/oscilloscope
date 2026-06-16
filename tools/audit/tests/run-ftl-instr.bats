#!/usr/bin/env bats
# Wrapper behaviour for the FTL instrumentation suite (run-ftl-instr.sh).

setup() {
  TESTDIR="$(mktemp -d)"
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../.." && pwd)"
  WRAP="${REPO_ROOT}/tools/audit/run-ftl-instr.sh"
  BIN="${TESTDIR}/bin"; mkdir -p "$BIN"
  # stub gcloud: record argv, succeed, print a GCS results URL the wrapper greps for
  cat > "$BIN/gcloud" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${TESTDIR}/gcloud.argv"
echo "Raw results will be stored in your GCS bucket at [https://console.developers.google.com/storage/browser/test-lab-xyz/RUN/]"
echo "gs://test-lab-xyz/RUN/"
exit 0
EOF
  cat > "$BIN/gsutil" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${TESTDIR}/gsutil.argv"; exit 0
EOF
  cat > "$BIN/npm" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${TESTDIR}/npm.argv"; exit 0
EOF
  for t in gcloud gsutil npm; do chmod +x "$BIN/$t"; done
  # fake gradle that "produces" both APKs the wrapper looks for
  APK_BASE="${TESTDIR}/apk"
  mkdir -p "${APK_BASE}/debug" "${APK_BASE}/androidTest/debug"
  cat > "${TESTDIR}/gradlew" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${TESTDIR}/gradlew.argv"
touch "${APK_BASE}/debug/scope-0.7.apk" "${APK_BASE}/androidTest/debug/app-debug-androidTest.apk"; exit 0
EOF
  chmod +x "${TESTDIR}/gradlew"
  # default ftl-preflight stub: ample physical quota so a --physical run clears the gate.
  # (run-ftl-instr.sh calls ftl-preflight by RELATIVE PATH, which PATH stubs cannot intercept,
  #  so the seam is an env var - mirroring GRADLEW/ADB - not a PATH stub.)
  cat > "${TESTDIR}/ftl-preflight" <<EOF
#!/usr/bin/env bash
[[ "\$1" == "--report" ]] && { echo "[REPORT] quota: used 0/5 Spark physical FTL slots today (resets midnight Pacific); 5 remaining"; exit 0; }
exit 0
EOF
  chmod +x "${TESTDIR}/ftl-preflight"
  export PATH="$BIN:$PATH"
  export GRADLEW="${TESTDIR}/gradlew"
  export FTL_PREFLIGHT="${TESTDIR}/ftl-preflight"
  export SCOPE_APK_BASE="$APK_BASE"
  export SCOPE_FTL_RESULTS_BASE="${TESTDIR}/results"
}
teardown() { rm -rf "$TESTDIR"; }

@test "default run submits --type instrumentation with both APKs and pull dir" {
  run env "$WRAP"
  [ "$status" -eq 0 ]
  grep -q -- "--type instrumentation" "${TESTDIR}/gcloud.argv"
  grep -q -- "--app" "${TESTDIR}/gcloud.argv"
  grep -q -- "--test" "${TESTDIR}/gcloud.argv"
  grep -q -- "app-debug-androidTest.apk" "${TESTDIR}/gcloud.argv"
  grep -q -- "--directories-to-pull /sdcard/scope-journeys" "${TESTDIR}/gcloud.argv"
  grep -q -- "--project scope-audit-202606b" "${TESTDIR}/gcloud.argv"
}

@test "run uses Android Test Orchestrator with clearPackageData to isolate per-test state" {
  run env "$WRAP"
  [ "$status" -eq 0 ]
  grep -q -- "--use-orchestrator" "${TESTDIR}/gcloud.argv"
  grep -q -- "--environment-variables clearPackageData=true" "${TESTDIR}/gcloud.argv"
}

@test "default uses the virtual device matrix" {
  run env "$WRAP"
  [ "$status" -eq 0 ]
  grep -q "MediumPhone" "${TESTDIR}/gcloud.argv"
}

@test "--physical switches to the OEM matrix" {
  run env "$WRAP" --physical
  [ "$status" -eq 0 ]
  grep -qE "model=(a35x|dm1q|CPH2449|RE58C2)" "${TESTDIR}/gcloud.argv"
}

@test "records slot-count and class for the preflight model" {
  run env "$WRAP" --physical
  [ "$status" -eq 0 ]
  sc="$(find "${TESTDIR}/results" -name .slot-count -exec cat {} +)"
  [ "$sc" -ge 1 ]
  find "${TESTDIR}/results" -name .slot-class -exec grep -q physical {} +
}

@test "gradle is invoked with the assembleDebug + androidTest targets" {
  run env "$WRAP"
  [ "$status" -eq 0 ]
  grep -q ":app:assembleDebug" "${TESTDIR}/gradlew.argv"
  grep -q ":app:assembleDebugAndroidTest" "${TESTDIR}/gradlew.argv"
}

@test "pulls artifacts locally with gsutil" {
  run env "$WRAP"
  [ "$status" -eq 0 ]
  grep -q "gs://test-lab-xyz/RUN" "${TESTDIR}/gsutil.argv"
}

@test "gcloud non-zero exit is surfaced but the run continues to pull artifacts" {
  # gcloud fails (e.g. some instrumentation tests failed) but still emitted a results path
  cat > "${BIN}/gcloud" <<EOF
#!/usr/bin/env bash
echo "gs://test-lab-xyz/RUN/"
exit 10
EOF
  chmod +x "${BIN}/gcloud"
  run env "$WRAP"
  [ "$status" -eq 0 ]                                       # run still completes (pull is best-effort)
  [[ "$output" == *"gcloud"* ]]                             # the failure is reported...
  [[ "$output" == *"10"* ]]                                 # ...with the exit code
  grep -q "gs://test-lab-xyz/RUN" "${TESTDIR}/gsutil.argv"  # and the pull is still attempted
}

@test "gsutil pull failure is surfaced, not masked, and does not abort the run" {
  # override the gsutil stub to fail for this test only
  cat > "${BIN}/gsutil" <<EOF
#!/usr/bin/env bash
exit 1
EOF
  chmod +x "${BIN}/gsutil"
  run env "$WRAP"
  [ "$status" -eq 0 ]                                   # if handled, the run still succeeds
  [[ "$output" == *"artifacts remain on GCS"* ]]        # the failure is reported, not swallowed
  [[ "$output" == *"gs://test-lab-xyz/RUN"* ]]          # with the GCS path for manual retrieval
}

@test "lint and typecheck run before gradle" {
  run env "$WRAP"
  [ "$status" -eq 0 ]
  grep -q "run lint" "${TESTDIR}/npm.argv"
  grep -q "run typecheck" "${TESTDIR}/npm.argv"
}

@test "--test-targets is forwarded to gcloud" {
  run env "$WRAP" --test-targets "class com.alpapan.scope.ViewWalkTest"
  [ "$status" -eq 0 ]
  grep -q -- "--test-targets" "${TESTDIR}/gcloud.argv"
  grep -q "ViewWalkTest" "${TESTDIR}/gcloud.argv"
}

@test "default run targets the curated journey class set (not the whole APK)" {
  run env "$WRAP"
  [ "$status" -eq 0 ]
  # curated default: the journey classes the local harness validates, EACH with its own `class ` prefix
  # (gcloud --test-targets is a comma list of full filters: "class A,class B", never "class A,B").
  grep -q -- "--test-targets class com.alpapan.scope.AudioCaptureTest" "${TESTDIR}/gcloud.argv"
  grep -q "class com.alpapan.scope.PermissionGrantTest" "${TESTDIR}/gcloud.argv"
  grep -q "class com.alpapan.scope.NowPlayingTest" "${TESTDIR}/gcloud.argv"
  # ...and NOT the @LargeTest probe or the helper meta-tests / extra journeys
  ! grep -q "AudioPolicyReleaseProbeTest" "${TESTDIR}/gcloud.argv"
  ! grep -q "ProveScopeStateTest" "${TESTDIR}/gcloud.argv"
  ! grep -q "SpikeCaptureTest" "${TESTDIR}/gcloud.argv"
}

@test "explicit --test-targets overrides the curated default" {
  run env "$WRAP" --test-targets "class com.alpapan.scope.AwaitFrameCommittedTest"
  [ "$status" -eq 0 ]
  grep -q "class com.alpapan.scope.AwaitFrameCommittedTest" "${TESTDIR}/gcloud.argv"   # override IS present
  ! grep -q "com.alpapan.scope.AudioCaptureTest" "${TESTDIR}/gcloud.argv"              # curated default replaced
}

# --- Phase E1: physical preflight quota gate ---

@test "physical run aborts (before building) when preflight reports insufficient slots" {
  cat > "${TESTDIR}/ftl-preflight" <<EOF
#!/usr/bin/env bash
[[ "\$1" == "--report" ]] && { echo "[REPORT] quota: used 5/5 Spark physical FTL slots today (resets midnight Pacific); 0 remaining"; exit 0; }
exit 0
EOF
  chmod +x "${TESTDIR}/ftl-preflight"
  run env "$WRAP" --physical
  [ "$status" -ne 0 ]
  [[ "$output" == *"remaining"* ]]
  [ ! -f "${TESTDIR}/gcloud.argv" ]   # never submitted
  [ ! -f "${TESTDIR}/gradlew.argv" ]  # aborted before the build, too
}

@test "physical run aborts when preflight quota is UNVERIFIED" {
  cat > "${TESTDIR}/ftl-preflight" <<EOF
#!/usr/bin/env bash
[[ "\$1" == "--report" ]] && { echo "[REPORT] quota: UNVERIFIED - Cloud Monitoring usage query failed"; exit 2; }
exit 0
EOF
  chmod +x "${TESTDIR}/ftl-preflight"
  run env "$WRAP" --physical
  [ "$status" -ne 0 ]
  [[ "$output" == *"UNVERIFIED"* || "$output" == *"could not verify"* ]]
  [ ! -f "${TESTDIR}/gcloud.argv" ]
}

@test "virtual run is NOT blocked by the physical-only preflight" {
  # --report covers physical slots only; a virtual run must not be gated on physical exhaustion.
  cat > "${TESTDIR}/ftl-preflight" <<EOF
#!/usr/bin/env bash
[[ "\$1" == "--report" ]] && { echo "[REPORT] quota: used 5/5 Spark physical FTL slots today; 0 remaining"; exit 0; }
exit 0
EOF
  chmod +x "${TESTDIR}/ftl-preflight"
  run env "$WRAP"
  [ "$status" -eq 0 ]
  grep -q -- "--type instrumentation" "${TESTDIR}/gcloud.argv"
}

# --- Phase E3: diag.json gate-failure scan after the pull ---

@test "surfaces gate failures when a pulled diag.json reports wasGated:false" {
  cat > "${BIN}/gsutil" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${TESTDIR}/gsutil.argv"
dest="\${@: -1}"
mkdir -p "\${dest}journeys"
printf '%s' '{"shotName":"bad","wasGated":false,"failureReason":"foreign window on top"}' > "\${dest}journeys/bad.diag.json"
exit 0
EOF
  chmod +x "${BIN}/gsutil"
  run env "$WRAP"
  [[ "$output" == *"gate failure"* ]]
  [[ "$output" == *"bad.diag.json"* ]]
}
