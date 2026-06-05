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

@test "verdict_from_diffs LAYOUT=tv PASSes on PLAY/RESUME medians in [20000,50000)" {
  # TV renders the same geometry at a smaller on-screen scale, so its per-frame
  # AE counts run lower. 30000 motion FAILs the tablet floor but PASSes on TV.
  export LAYOUT=tv
  run verdict_from_diffs "30000 30000 30000" "0 0 0" "30000 30000 30000"
  [ "$status" -eq 0 ]
  [[ "$output" == PASS* ]]
}

@test "verdict_from_diffs default (tablet) FAILs the same 30000 medians (floor is 50000)" {
  run verdict_from_diffs "30000 30000 30000" "0 0 0" "30000 30000 30000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
}

@test "verdict_from_diffs LAYOUT=tablet (explicit) uses the 50000 floor (FAILs at 30000)" {
  export LAYOUT=tablet
  run verdict_from_diffs "30000 30000 30000" "0 0 0" "30000 30000 30000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
}

@test "verdict_from_diffs LAYOUT=tv FAILs when PLAY median is below the 20000 TV floor" {
  export LAYOUT=tv
  run verdict_from_diffs "10000 10000 10000" "0 0 0" "30000 30000 30000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
}

@test "verdict_from_diffs LAYOUT=tv still FAILs when PAUSE does not freeze (>5000)" {
  # The PAUSE freeze threshold is layout-independent: a TV that keeps moving
  # while paused is still a fail.
  export LAYOUT=tv
  run verdict_from_diffs "30000 30000 30000" "6000 6000 6000" "30000 30000 30000"
  [ "$status" -ne 0 ]
  [[ "$output" == FAIL* ]]
}

@test "verdict_from_diffs treats an unknown LAYOUT as the strict tablet floor" {
  export LAYOUT=bogus
  run verdict_from_diffs "30000 30000 30000" "0 0 0" "30000 30000 30000"
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

# screen_center_from_wm_size <wm-size-output> -> "<cx> <cy>"
# The view-cycle double-tap must land on the canvas regardless of device. The
# old probe hardcoded 1280 300 (a tangorpro-tablet coord) which is off-screen on
# a 1080-wide portrait phone (frankel), so the tap never registered.

@test "screen_center_from_wm_size centers a portrait phone (frankel 1080x2424)" {
  run screen_center_from_wm_size "Physical size: 1080x2424"
  [ "$status" -eq 0 ]
  [ "$output" = "540 1212" ]
}

@test "screen_center_from_wm_size centers the tangorpro tablet (1600x2560)" {
  run screen_center_from_wm_size "Physical size: 1600x2560"
  [ "$status" -eq 0 ]
  [ "$output" = "800 1280" ]
}

@test "screen_center_from_wm_size prefers an Override size over Physical size" {
  run screen_center_from_wm_size "$(printf 'Physical size: 1080x2424\nOverride size: 720x1612')"
  [ "$status" -eq 0 ]
  [ "$output" = "360 806" ]
}

@test "screen_center_from_wm_size exits non-zero when no resolution parses" {
  run screen_center_from_wm_size "wm: inaccessible or not found"
  [ "$status" -ne 0 ]
}
