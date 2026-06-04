#!/usr/bin/env bash
# Owned-device baseline driver for Scope (audit Task 3).
# Re-runnable. For each owned device: resolve current adb serial, wake + unlock,
# launch Scope, screenshot (with an on-device-file+pull fallback for the flaky
# Pixel wireless transport), and verify the installed build by lastUpdateTime.
#
# Install success is judged by lastUpdateTime, NEVER by adb's exit code: the
# Android-16 Pixels print false install/screencap failures while the operation
# actually completes. See memory adb-wireless-link-fragile.
#
# No destructive ops: no uninstall, no kill-server, no git. Attaches an ABSENT
# device once at its CURRENT mdns-discovered port (never a stale port).
set -uo pipefail

ADB="${ADB:-$HOME/Android/Sdk/platform-tools/adb}"
PKG=com.alpapan.scope
OUT="${OUT:-docs/audits/2026-06-audit/owned-devices}"
MIN_OK_BYTES="${MIN_OK_BYTES:-20000}"   # a real rendered screen is >20KB; a black frame ~8-15KB

# name -> attach hint:
#   ip:<LAN-IP>     phones/tablet: discover current port from `adb mdns services`, attach once if absent
#   mdns:<serial>   use the _adb-tls-connect._tcp transport name as-is
declare -A ATTACH=(
  [frankel]="ip:192.168.0.132"
  [tangorpro]="ip:192.168.0.182"
  [sabrina]="mdns:adb-24051HFDD5SPZ5-nWzCND._adb-tls-connect._tcp"
  [lion]="mdns:adb-ZY22JTN6Z9-4W437s._adb-tls-connect._tcp"
  [nokia]="ip:192.168.0.101"
)
declare -A CAT=(
  [frankel]=android.intent.category.LAUNCHER
  [tangorpro]=android.intent.category.LAUNCHER
  [sabrina]=android.intent.category.LEANBACK_LAUNCHER
  [lion]=android.intent.category.LAUNCHER
  [nokia]=android.intent.category.LAUNCHER
)
ORDER=(frankel tangorpro sabrina lion nokia)

now() { date '+%Y-%m-%d %H:%M:%S'; }

resolve_serial() {
  # echo the adb serial to use; attach an absent ip-hinted device at its current port.
  local hint="$1" kind val
  kind="${hint%%:*}"; val="${hint#*:}"
  if [[ "$kind" == mdns ]]; then echo "$val"; return 0; fi
  local line port serial
  line=$("$ADB" mdns services 2>/dev/null | grep -F "$val:" | head -n1)
  port="${line##*:}"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then echo "$val:UNKNOWN"; return 0; fi
  serial="$val:$port"
  if ! "$ADB" devices | grep -q "^${serial}[[:space:]]"; then
    "$ADB" connect "$serial" >/dev/null 2>&1
  fi
  echo "$serial"
}

wake_unlock() {
  local s="$1"
  "$ADB" -s "$s" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  "$ADB" -s "$s" shell wm dismiss-keyguard >/dev/null 2>&1
  "$ADB" -s "$s" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
}

verify_installed() {
  "$ADB" -s "$1" shell "dumpsys package $PKG | grep -E 'versionName|lastUpdateTime'" 2>/dev/null | tr -d '\r' | tr '\n' ' '
}

launch() {
  "$ADB" -s "$1" shell monkey -p "$PKG" -c "$2" 1 >/dev/null 2>&1
}

shot_bytes() { [[ -s "$1" ]] && stat -c %s "$1" 2>/dev/null || echo 0; }

screenshot() {
  # try exec-out (-p = PNG), then on-device-file+pull; retry; succeed when rendered.
  local s="$1" dest="$2" i
  for ((i=1; i<=3; i++)); do
    "$ADB" -s "$s" exec-out screencap -p > "$dest" 2>/dev/null
    [[ "$(shot_bytes "$dest")" -gt "$MIN_OK_BYTES" ]] && return 0
    "$ADB" -s "$s" shell screencap -p /sdcard/scope-shot.png >/dev/null 2>&1
    "$ADB" -s "$s" pull /sdcard/scope-shot.png "$dest" >/dev/null 2>&1
    "$ADB" -s "$s" shell rm -f /sdcard/scope-shot.png >/dev/null 2>&1
    [[ "$(shot_bytes "$dest")" -gt "$MIN_OK_BYTES" ]] && return 0
    sleep 2
  done
  [[ -s "$dest" ]]   # keep whatever we got; report size at call site
}

echo "HOST: $(now)"
echo "ADB:  $("$ADB" version 2>/dev/null | head -n1)"
for name in "${ORDER[@]}"; do
  echo "==================== $name ===================="
  serial=$(resolve_serial "${ATTACH[$name]:-}")
  state=$("$ADB" -s "$serial" get-state 2>&1)
  if [[ "$state" != "device" && "$serial" =~ ^[0-9.]+:[0-9]+$ ]]; then
    sleep 1; "$ADB" connect "$serial" >/dev/null 2>&1; state=$("$ADB" -s "$serial" get-state 2>&1)
  fi
  echo "serial: $serial   state: $state"
  if [[ "$state" != "device" ]]; then
    echo "SKIP: not reachable (state=$state)"
    continue
  fi
  mkdir -p "$OUT/$name" || { echo "SKIP: mkdir failed for $OUT/$name"; continue; }
  wake_unlock "$serial"
  echo "installed: $(verify_installed "$serial")"
  launch "$serial" "${CAT[$name]:-android.intent.category.LAUNCHER}"
  sleep 4
  if screenshot "$serial" "$OUT/$name/01-launch.png"; then
    sz=$(stat -c %s "$OUT/$name/01-launch.png")
    if [[ "$sz" -gt "$MIN_OK_BYTES" ]]; then
      echo "shot: OK (${sz} bytes) -> $OUT/$name/01-launch.png"
    else
      echo "shot: SAVED but looks blank (${sz} bytes) - screen may be off/secure -> $OUT/$name/01-launch.png"
    fi
  else
    echo "shot: FAILED (no frame captured)"
  fi
done
echo "==================== DONE $(now) ===================="
