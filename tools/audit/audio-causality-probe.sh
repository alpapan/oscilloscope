#!/usr/bin/env bash
# Audio-response journey probe for the Scope owned-device baseline (audit Task 3).
#
# Drives one already-paired Android device end-to-end:
#   verify music playing -> launch Scope -> tap "Capture audio" -> accept consent
#   -> verify foreground service -> close drawer -> cycle view to waveform
#   -> 3x burst capture (PLAY / PAUSE / RESUME) -> pixel-AE diff -> verdict.
#
# All decisions about WHERE to tap are derived live from `uiautomator dump`
# parsed by tools/audit/lib/probe-helpers.sh (unit-tested separately).
# No coordinates are hard-coded in this script.
#
# Re-runnable. Idempotent: every invocation force-stops Scope first.
# No destructive ops: no uninstall, no kill-server, no git.
#
# Usage:
#   tools/audit/audio-causality-probe.sh <device-codename>
#
# Codenames: tangorpro lion frankel nokia sabrina  (matches owned-device-baseline.sh)
# Env: ADB, OUT, MIN_OK_BYTES, BURST_FRAMES, BURST_INTERVAL_S, FUZZ.
set -uo pipefail

ADB="${ADB:-$HOME/Android/Sdk/platform-tools/adb}"
PKG=com.alpapan.scope
OUT="${OUT:-docs/audits/2026-06-audit/emulator-runs}"
BURST_FRAMES="${BURST_FRAMES:-8}"
BURST_INTERVAL_S="${BURST_INTERVAL_S:-0.25}"
FUZZ="${FUZZ:-8%}"
MIN_OK_BYTES="${MIN_OK_BYTES:-20000}"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/probe-helpers.sh"

# Tools we shell out to that the script can't proceed without.
for tool in "$ADB" "${XMLLINT:-xmllint}" compare; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FAIL: required tool not found: $tool" >&2; exit 1; }
done

# Scratch dir for intermediate UIA dumps (not evidence). Cleaned on exit.
SCRATCH=$(mktemp -d -t scope-probe.XXXXXX)
# Clean scratch on normal exit AND on Ctrl-C / SIGTERM (the latter is how
# `timeout` from audit-watch.sh kills a wedged run). SIGKILL cannot be
# trapped; if the script is hard-killed the scratch dir leaks until reboot
# or until a periodic /tmp sweep.
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

declare -A ATTACH=(
  [frankel]="ip:192.168.0.132"
  [tangorpro]="ip:192.168.0.182"
  [sabrina]="mdns:adb-24051HFDD5SPZ5-nWzCND._adb-tls-connect._tcp"
  [lion]="mdns:adb-ZY22JTN6Z9-4W437s._adb-tls-connect._tcp"
  [nokia]="ip:192.168.0.101"
)

die() { echo "FAIL: $*" >&2; exit 1; }
log() { echo "[$(date '+%H:%M:%S')] $*"; }

resolve_serial() {
  # Prefer an already-connected device. mDNS is fragile on wireless ADB and
  # often goes quiet between probes (see memory adb-wireless-link-fragile).
  # Fall back to mDNS-discovery only when adb does not already know the device.
  local hint="${ATTACH[$1]:-}" kind val
  [[ -z "$hint" ]] && die "unknown device codename: $1"
  kind="${hint%%:*}"; val="${hint#*:}"
  if [[ "$kind" == mdns ]]; then
    echo "$val"; return 0
  fi
  local serial
  if serial=$(find_serial_for_ip "$("$ADB" devices 2>/dev/null)" "$val"); then
    echo "$serial"; return 0
  fi
  local line port
  line=$("$ADB" mdns services 2>/dev/null | grep -F "$val:" | head -n1)
  port="${line##*:}"
  [[ "$port" =~ ^[0-9]+$ ]] || die "no current connection to $val and no mDNS service (pair first)"
  serial="$val:$port"
  "$ADB" connect "$serial" >/dev/null 2>&1
  echo "$serial"
}

adb_shell()   { "$ADB" -s "$SER" shell "$@"; }
adb_screencap() { "$ADB" -s "$SER" exec-out screencap -p; }

uia_dump() {
  # Pulls a fresh /sdcard/uia.xml to the given local path. Cleans up on-device.
  local dest="$1"
  adb_shell "uiautomator dump /sdcard/uia.xml" >/dev/null 2>&1 || return 1
  "$ADB" -s "$SER" pull /sdcard/uia.xml "$dest" >/dev/null 2>&1 || return 1
  adb_shell "rm -f /sdcard/uia.xml" >/dev/null 2>&1
  [[ -s "$dest" ]]
}

tap_by_id() {
  # Re-dumps UIA each call so it sees the latest layout. Retries up to 3 times.
  local rid="$1" tries=3 i uia xy
  for ((i=1; i<=tries; i++)); do
    uia="${SCRATCH}/uia-${rid//[^a-zA-Z0-9]/_}.xml"
    if uia_dump "$uia" && xy=$(parse_button_center "$uia" "$rid"); then
      adb_shell "input tap ${xy}" >/dev/null 2>&1
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_view_text() {
  # Polls mobile_view_text until it equals $1 or timeout (seconds).
  local want="$1" timeout="${2:-10}" elapsed=0 uia got
  while (( elapsed < timeout )); do
    uia="${SCRATCH}/uia-view.xml"
    if uia_dump "$uia" && got=$(mobile_view_text "$uia") && [[ "$got" == "$want" ]]; then
      return 0
    fi
    sleep 1; elapsed=$(( elapsed + 1 ))
  done
  return 1
}

capture_burst() {
  local label="$1" prefix="$2"
  local dir="${RUN_DIR}/${label}-burst"
  local i
  mkdir -p "$dir"
  for ((i=1; i<=BURST_FRAMES; i++)); do
    adb_screencap > "${dir}/${prefix}${i}.png"
    sleep "$BURST_INTERVAL_S"
  done
}

burst_diffs() {
  local dir="$1" prefix="$2" i j d
  for ((i=1; i<BURST_FRAMES; i++)); do
    j=$((i+1))
    d=$(compare -metric AE -fuzz "$FUZZ" "${dir}/${prefix}${i}.png" "${dir}/${prefix}${j}.png" /dev/null 2>&1)
    # `compare` prints "X (Y)" when same dimensions, just "X" otherwise. Take first token.
    echo "${d%% *}"
  done
}

[[ $# -ge 1 ]] || die "usage: $0 <device-codename>"
DEVICE="$1"
SER=$(resolve_serial "$DEVICE") || exit 1
state=$("$ADB" -s "$SER" get-state 2>&1)
[[ "$state" == "device" ]] || die "device $DEVICE not reachable (state=$state)"
log "device: $DEVICE  serial: $SER"

RUN_DIR="${OUT}/${DEVICE}"
mkdir -p "$RUN_DIR"
EV="${RUN_DIR}/evidence"
mkdir -p "$EV"

# 0. battery + scope version - record into evidence for sanity
adb_shell "dumpsys battery" > "${EV}/battery.txt" 2>&1
adb_shell "dumpsys package $PKG" > "${EV}/scope-package.txt" 2>&1

# 1. music must be playing (USAGE_MEDIA + CONTENT_TYPE_MUSIC + state:started)
adb_shell "dumpsys audio" > "${EV}/audio-pre.txt" 2>&1
if ! music_is_playing "${EV}/audio-pre.txt"; then
  # Try resume - keyevent 126 - in case it's just paused
  log "music not playing; sending MEDIA_PLAY (126)"
  adb_shell "input keyevent 126" >/dev/null 2>&1
  sleep 3
  adb_shell "dumpsys audio" > "${EV}/audio-pre.txt" 2>&1
  music_is_playing "${EV}/audio-pre.txt" || die "no AudioTrack started+USAGE_MEDIA+CONTENT_TYPE_MUSIC; start music first"
fi
log "music playing (kernel-confirmed)"

# 2. cold-launch Scope
adb_shell "am force-stop $PKG" >/dev/null 2>&1
adb_shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
sleep 5
adb_screencap > "${RUN_DIR}/01-start-screen.png"

# 3. tap Capture audio
tap_by_id "mobile-capture" || die "could not find mobile-capture button on start screen"
sleep 2
adb_screencap > "${RUN_DIR}/02-after-tap-capture.png"

# 4. accept MediaProjection consent
tap_by_id "android:id/button1" || die "could not find consent dialog button1"
sleep 3
adb_screencap > "${RUN_DIR}/03-after-consent.png"

# 5. verify capture service is foreground
adb_shell "dumpsys activity services $PKG" > "${EV}/services-after-consent.txt" 2>&1
capture_service_running "${EV}/services-after-consent.txt" \
  || die "AudioCaptureService not running after consent"
log "capture pipeline live (AudioCaptureService running)"

# 6. close drawer if open (BACK), then cycle view to Waveform.
# Synthesized double-tap in a single adb shell (avoids per-call shell startup
# that would push the second tap outside the 300ms double-tap window in mobile-ui.js).
# Tap the screen CENTRE derived from `wm size`, never a hardcoded point: the
# now-playing card is pointer-events:none so a centre tap reaches the canvas, and
# a fixed coord (old 1280x300, a tangorpro-tablet point) is off-screen on a
# portrait phone (frankel is 1080 wide), so the double-tap never landed.
# The wait_for_view_text poll below is the gate: if the chained tap silently
# delivered only one tap, the view stays on "Now Playing", the poll times out,
# and the retry fires.
# Command-substitution (not read < <(...)) so a parse failure in the helper
# actually propagates to `|| die` - process substitution would hide its exit.
TAP_CENTER="$(screen_center_from_wm_size "$(adb_shell 'wm size')")" \
  || die "could not parse screen size from 'wm size' for the view-cycle tap"
read -r TAPX TAPY <<< "$TAP_CENTER"
adb_shell "input keyevent 4" >/dev/null 2>&1
sleep 1
adb_shell "input tap $TAPX $TAPY;input tap $TAPX $TAPY" >/dev/null 2>&1
if ! wait_for_view_text "Waveform" 10; then
  adb_shell "input tap $TAPX $TAPY;input tap $TAPX $TAPY" >/dev/null 2>&1
  wait_for_view_text "Waveform" 10 \
    || die "view did not cycle to Waveform after double-tap"
fi
adb_screencap > "${RUN_DIR}/04-waveform-active.png"
log "view = Waveform"

# 7. PLAY burst
adb_shell "dumpsys audio" > "${EV}/audio-play.txt" 2>&1
capture_burst play p
log "play-burst done"

# 8. PAUSE burst (keyevent 127), then re-confirm music actually paused
adb_shell "input keyevent 127" >/dev/null 2>&1
sleep 3
adb_shell "dumpsys audio" > "${EV}/audio-pause.txt" 2>&1
capture_burst pause q
log "pause-burst done"

# 9. RESUME burst (keyevent 126)
adb_shell "input keyevent 126" >/dev/null 2>&1
sleep 3
adb_shell "dumpsys audio" > "${EV}/audio-resume.txt" 2>&1
capture_burst resume r
log "resume-burst done"

# 10. pixel-AE diffs
PLAY_D=$(burst_diffs "${RUN_DIR}/play-burst" p | tr '\n' ' ')
PAUSE_D=$(burst_diffs "${RUN_DIR}/pause-burst" q | tr '\n' ' ')
RESUME_D=$(burst_diffs "${RUN_DIR}/resume-burst" r | tr '\n' ' ')
{
  echo "play_diffs:   $PLAY_D"
  echo "pause_diffs:  $PAUSE_D"
  echo "resume_diffs: $RESUME_D"
} > "${RUN_DIR}/pixel-diffs.txt"

# 11. verdict
VERDICT=$(verdict_from_diffs "$PLAY_D" "$PAUSE_D" "$RESUME_D")
RC=$?
echo "$VERDICT" | tee "${RUN_DIR}/verdict.txt"
exit $RC
