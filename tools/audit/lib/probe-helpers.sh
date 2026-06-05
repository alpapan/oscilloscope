# shellcheck shell=bash
# Pure helpers for the audio-causality probe.
# No adb, no devices, no network. Source this file; do not execute it.
# Tests: tools/audit/tests/probe-helpers.bats

XMLLINT="${XMLLINT:-xmllint}"

# parse_button_center <uia.xml> <resource-id>
# Echoes "<cx> <cy>" (center of the node's bounds) and exits 0.
# Exits non-zero if the resource-id is absent OR the node is hidden ([0,0][0,0]).
parse_button_center() {
  local file="$1" rid="$2" bounds
  bounds=$("$XMLLINT" --xpath "string(//node[@resource-id=\"${rid}\"]/@bounds)" "$file" 2>/dev/null)
  [[ -z "$bounds" ]] && return 1
  [[ "$bounds" == "[0,0][0,0]" ]] && return 1
  local x1 y1 x2 y2
  if [[ "$bounds" =~ ^\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]$ ]]; then
    x1="${BASH_REMATCH[1]}"; y1="${BASH_REMATCH[2]}"
    x2="${BASH_REMATCH[3]}"; y2="${BASH_REMATCH[4]}"
    echo "$(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))"
    return 0
  fi
  return 1
}

# mobile_view_text <uia.xml>
# Echoes the text of the mobile-view element (the view-cycle dropdown).
mobile_view_text() {
  local file="$1" txt
  txt=$("$XMLLINT" --xpath "string(//node[@resource-id=\"mobile-view\"]/@text)" "$file" 2>/dev/null)
  [[ -z "$txt" ]] && return 1
  echo "$txt"
}

# music_is_playing <dumpsys-audio.txt>
# Exits 0 if any AudioTrack line shows state:started + USAGE_MEDIA + CONTENT_TYPE_MUSIC.
music_is_playing() {
  grep -qE 'AudioTrack.*state:started.*USAGE_MEDIA.*CONTENT_TYPE_MUSIC' "$1"
}

# capture_service_running <dumpsys-activity-services.txt>
# Exits 0 if a ServiceRecord for com.alpapan.scope/.AudioCaptureService is present.
capture_service_running() {
  grep -qE 'ServiceRecord.*com\.alpapan\.scope/\.AudioCaptureService' "$1"
}

# verdict_from_diffs <play_diffs> <pause_diffs> <resume_diffs>
# Each arg is a space-separated list of integers (px-AE counts).
# The PLAY/RESUME motion floor depends on $LAYOUT (default tablet); the TV
# renders the same geometry at a smaller on-screen scale, so it moves fewer
# pixels per frame and gets a lower floor. The PAUSE freeze ceiling is the same
# for both. An unrecognised LAYOUT falls back to the strict tablet floor so a
# typo cannot silently relax the threshold.
#   LAYOUT=tablet (default):  median(PLAY|RESUME) >= 50000
#   LAYOUT=tv:                median(PLAY|RESUME) >= 20000
#   both:                     median(PAUSE)       <=  5000
# Echoes "PASS ..." or "FAIL: ..." and exits 0 or 1.
verdict_from_diffs() {
  local play="$1" pause="$2" resume="$3"
  local motion_floor=50000
  case "${LAYOUT:-tablet}" in
    tv) motion_floor=20000 ;;
  esac
  # Strip ALL whitespace (spaces, tabs, newlines, carriage returns) before
  # checking. A quoted whitespace-only argument is treated as empty input
  # and reported with a clear FAIL reason.
  local empty=
  [[ -z "${play//[[:space:]]/}"   ]] && empty="${empty}play_diffs empty; "
  [[ -z "${pause//[[:space:]]/}"  ]] && empty="${empty}pause_diffs empty; "
  [[ -z "${resume//[[:space:]]/}" ]] && empty="${empty}resume_diffs empty; "
  if [[ -n "$empty" ]]; then
    echo "FAIL: ${empty% }"
    return 1
  fi
  local mp mq mr
  # word-split each list intentionally so _median sees per-number args
  # shellcheck disable=SC2086
  mp=$(_median $play)
  # shellcheck disable=SC2086
  mq=$(_median $pause)
  # shellcheck disable=SC2086
  mr=$(_median $resume)
  local fail=
  (( mp < motion_floor )) && fail="${fail}play_median=${mp}<${motion_floor} "
  (( mr < motion_floor )) && fail="${fail}resume_median=${mr}<${motion_floor} "
  (( mq > 5000  )) && fail="${fail}pause_median=${mq}>5000 "
  if [[ -n "$fail" ]]; then
    echo "FAIL: ${fail% }"
    return 1
  fi
  echo "PASS play_median=${mp} pause_median=${mq} resume_median=${mr}"
}

# find_serial_for_ip <adb-devices-output> <ip>
# Echoes the adb serial whose line starts with <ip>: and is in state "device".
# Exits non-zero if no such entry exists. Pure: no adb invocation.
find_serial_for_ip() {
  local devices_output="$1" ip="$2"
  local line
  line=$(printf '%s\n' "$devices_output" | grep -E "^${ip}:[0-9]+[[:space:]]+device([[:space:]]|$)" | head -n1)
  [[ -z "$line" ]] && return 1
  echo "${line%%[[:space:]]*}"
}

# screen_center_from_wm_size <wm-size-output>
# Echoes "<cx> <cy>", the centre of the effective display reported by
# `adb shell wm size`. Prefers an "Override size:" line (what `input tap` honours
# when a size override is set) over "Physical size:". Exits non-zero if no WxH
# parses. Pure: the caller captures `wm size` and passes it in. Replaces the old
# hardcoded 1280x300 view-cycle tap, which was off-screen on portrait phones.
screen_center_from_wm_size() {
  local out="$1" size w h
  size=$(printf '%s\n' "$out" | grep -E 'Override size:' | grep -oE '[0-9]+x[0-9]+')
  [[ -z "$size" ]] && size=$(printf '%s\n' "$out" | grep -E 'Physical size:' | grep -oE '[0-9]+x[0-9]+')
  [[ -z "$size" ]] && return 1
  w=${size%x*}; h=${size#*x}
  [[ "$w" =~ ^[0-9]+$ && "$h" =~ ^[0-9]+$ ]] || return 1
  echo "$(( w / 2 )) $(( h / 2 ))"
}

# _median INT...
# Echoes the integer median of the args.
# Odd-length: middle value. Even-length: integer mean of the two middle values.
_median() {
  (( $# > 0 )) || return 1
  local sorted n
  sorted=$(printf '%s\n' "$@" | sort -n)
  n=$(printf '%s\n' "$sorted" | wc -l)
  if (( n % 2 == 1 )); then
    local mid=$(( (n + 1) / 2 ))
    printf '%s\n' "$sorted" | sed -n "${mid}p"
  else
    local lo hi
    lo=$(printf '%s\n' "$sorted" | sed -n "$((n / 2))p")
    hi=$(printf '%s\n' "$sorted" | sed -n "$((n / 2 + 1))p")
    echo $(( (lo + hi) / 2 ))
  fi
}
