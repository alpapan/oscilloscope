#!/usr/bin/env bats

# Pure helpers used by audio-causality-probe.sh. These parse UIA dumps,
# dumpsys text, and pixel-diff burst lists. No adb, no devices.
# Fixtures under tests/fixtures/ are real outputs captured on tangorpro.

load helpers/setup

setup() {
  audit_setup
  export FIX="${REPO_ROOT}/tools/audit/tests/fixtures"
  export LIB="${REPO_ROOT}/tools/audit/lib/probe-helpers.sh"
  # shellcheck disable=SC1090
  source "${LIB}"
}

@test "parse_button_center finds mobile-capture on the start screen" {
  run parse_button_center "${FIX}/uia-start.xml" "mobile-capture"
  [ "$status" -eq 0 ]
  [ "$output" = "1279 699" ]
}

@test "parse_button_center finds mobile-capture-mic on the start screen" {
  run parse_button_center "${FIX}/uia-start.xml" "mobile-capture-mic"
  [ "$status" -eq 0 ]
  [ "$output" = "1279 825" ]
}

@test "parse_button_center finds the MediaProjection consent button1" {
  run parse_button_center "${FIX}/uia-consent.xml" "android:id/button1"
  [ "$status" -eq 0 ]
  [ "$output" = "1538 1021" ]
}

@test "parse_button_center exits non-zero when resource-id absent" {
  run parse_button_center "${FIX}/uia-start.xml" "nonexistent-id"
  [ "$status" -ne 0 ]
}

@test "parse_button_center exits non-zero when bounds are [0,0][0,0] (hidden)" {
  # mobile-view on the start screen is hidden (drawer closed)
  run parse_button_center "${FIX}/uia-start.xml" "mobile-view"
  [ "$status" -ne 0 ]
}

@test "mobile_view_text returns 'Now Playing' on post-consent state" {
  run mobile_view_text "${FIX}/uia-postconsent.xml"
  [ "$status" -eq 0 ]
  [ "$output" = "Now Playing" ]
}

@test "mobile_view_text returns 'Waveform' after a successful view-cycle" {
  run mobile_view_text "${FIX}/uia-dbltap.xml"
  [ "$status" -eq 0 ]
  [ "$output" = "Waveform" ]
}

@test "music_is_playing detects YT Music AudioTrack started + USAGE_MEDIA + CONTENT_TYPE_MUSIC" {
  run music_is_playing "${FIX}/dumpsys-audio-playing.txt"
  [ "$status" -eq 0 ]
}

@test "music_is_playing returns non-zero when AudioTrack is paused" {
  run music_is_playing "${FIX}/dumpsys-audio-paused.txt"
  [ "$status" -ne 0 ]
}

@test "capture_service_running detects AudioCaptureService ServiceRecord" {
  run capture_service_running "${FIX}/dumpsys-services-capturing.txt"
  [ "$status" -eq 0 ]
}

@test "capture_service_running returns non-zero when AudioCaptureService absent" {
  printf 'no service here\n' > "${BATS_TEST_TMPDIR}/empty-svc.txt"
  run capture_service_running "${BATS_TEST_TMPDIR}/empty-svc.txt"
  [ "$status" -ne 0 ]
}

@test "verdict_from_diffs PASSes on real tangorpro PLAY/PAUSE/RESUME" {
  run verdict_from_diffs \
    "422143 389175 393373 394865 423714 377980 356644" \
    "0 0 0 0 0 0 203" \
    "462666 378844 427433 394073 432146 422257 443815"
  [ "$status" -eq 0 ]
  [[ "$output" == PASS* ]]
}

@test "verdict_from_diffs FAILs when PLAY motion is too low" {
  run verdict_from_diffs \
    "100 50 200 300 100 400 200" \
    "0 0 0 0 0 0 0" \
    "100 200 300 100 50 100 100"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
}

@test "verdict_from_diffs FAILs when PAUSE does not freeze" {
  run verdict_from_diffs \
    "400000 400000 400000 400000 400000 400000 400000" \
    "300000 300000 300000 300000 300000 300000 300000" \
    "400000 400000 400000 400000 400000 400000 400000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
}

@test "find_serial_for_ip returns the connected serial when adb already knows the device" {
  local devices_output='List of devices attached
192.168.0.182:40391    device product:tangorpro model:Pixel_Tablet device:tangorpro
'
  run find_serial_for_ip "$devices_output" "192.168.0.182"
  [ "$status" -eq 0 ]
  [ "$output" = "192.168.0.182:40391" ]
}

@test "find_serial_for_ip ignores entries that are not in 'device' state" {
  local devices_output='List of devices attached
192.168.0.182:40391    offline
'
  run find_serial_for_ip "$devices_output" "192.168.0.182"
  [ "$status" -ne 0 ]
}

@test "find_serial_for_ip exits non-zero when the IP is absent" {
  local devices_output='List of devices attached
192.168.0.999:1234    device
'
  run find_serial_for_ip "$devices_output" "192.168.0.182"
  [ "$status" -ne 0 ]
}

@test "_median of an even-length list is the mean of the two middle values" {
  # median(2 4 6 8) = (4 + 6) / 2 = 5
  run _median 2 4 6 8
  [ "$status" -eq 0 ]
  [ "$output" = "5" ]
}

@test "_median of an even-length list with non-integer mean truncates" {
  # median(1 2 3 4) = (2 + 3) / 2 = 2 (integer truncation, documented)
  run _median 1 2 3 4
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
}

@test "verdict_from_diffs FAILs with a clear reason when PLAY input is empty" {
  run verdict_from_diffs "" "0 0 0" "100000 100000 100000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
  [[ "$output" == *"play_diffs empty"* ]]
}

@test "verdict_from_diffs FAILs with a clear reason when PAUSE input is empty" {
  run verdict_from_diffs "100000 100000 100000" "" "100000 100000 100000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
  [[ "$output" == *"pause_diffs empty"* ]]
}

@test "verdict_from_diffs FAILs with a clear reason when RESUME input is empty" {
  run verdict_from_diffs "100000 100000 100000" "0 0 0" ""
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
  [[ "$output" == *"resume_diffs empty"* ]]
}

@test "verdict_from_diffs FAILs when an input is whitespace-only (quoted)" {
  run verdict_from_diffs "   " "0 0 0" "100000 100000 100000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
  [[ "$output" == *"play_diffs empty"* ]]
}

@test "verdict_from_diffs FAILs when an input contains only tabs and newlines" {
  run verdict_from_diffs "$(printf '\t\n  \t')" "0 0 0" "100000 100000 100000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
  [[ "$output" == *"play_diffs empty"* ]]
}
