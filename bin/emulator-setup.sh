#!/usr/bin/env bash
#
# emulator-setup.sh - prepare and smoke-test the headless-NVIDIA Android
# emulator environment used by the device-compatibility audit.
#
# It is idempotent and self-healing:
#   * starts a headless NVIDIA Xorg on :0 so `-gpu host` can render on the card
#     (software GL stalls the cold boot of newer system images);
#   * downloads any missing system image via sdkmanager, which verifies the
#     archive SHA1 against the public SDK manifest and fails on mismatch;
#   * creates the AVDs and writes a working config (host GPU, bare-integer RAM -
#     the emulator silently caps an "M"-suffixed hw.ramSize to 2048MB);
#   * boots every API in parallel and waits for sys.boot_completed. The boot
#     test is the real integrity gate: a corrupt image passes sdkmanager's
#     checksum yet hangs in first-stage init. A failed boot triggers one
#     uninstall+reinstall (repull); if it still will not boot, the run fails.
#
# Run it where /dev/kvm is usable (e.g. `sg kvm -c 'bin/emulator-setup.sh'`)
# on a host with an NVIDIA GPU. Source it (BASH_SOURCE != $0) to unit-test the
# functions without launching anything.

# --- configuration (every external dependency is an overridable seam) --------
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
SDKMANAGER="${SDKMANAGER:-$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager}"
AVDMANAGER="${AVDMANAGER:-$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager}"
EMULATOR="${EMULATOR:-$ANDROID_HOME/emulator/emulator}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
CURL="${CURL:-curl}"
AVD_HOME="${AVD_HOME:-$HOME/.android/avd}"
MANIFEST_URL="${MANIFEST_URL:-https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-1.xml}"
RAM_MB="${RAM_MB:-3072}"
APIS="${APIS:-34 35 36}"
TAG="${TAG:-google_apis}"
ABI="${ABI:-x86_64}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-300}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
DISPLAY_NUM="${DISPLAY_NUM:-:0}"
XORG_CONF="${XORG_CONF:-$HOME/.config/scope/xorg-nvidia-headless.conf}"
XORG_LOG="${XORG_LOG:-$HOME/.config/scope/xorg-nvidia.log}"
SKIP_XORG="${SKIP_XORG:-0}"

log() { printf '[emulator-setup] %s\n' "$*" >&2; }

image_dir() { printf '%s/system-images/android-%s/%s/%s' "$ANDROID_HOME" "$1" "$TAG" "$ABI"; }
pkg_id()    { printf 'system-images;android-%s;%s;%s' "$1" "$TAG" "$ABI"; }
avd_name()  { printf 'scope-api%s' "$1"; }

# Print the published SHA1 for an API's system-image archive, or fail if the
# manifest carries no archive for it. The manifest lists size/checksum/url per
# archive (checksum at or before its url), so track the latest checksum and
# emit it when the matching x86_64-<api>_* url appears.
checksum_for() {
  local api="$1" cs
  cs="$("$CURL" -sL "$MANIFEST_URL" 2>/dev/null | awk -v api="$api" '
    /<checksum>/ { c = $0; sub(/.*<checksum>/, "", c); sub(/<\/checksum>.*/, "", c) }
    index($0, "x86_64-" api "_") { print c; found = 1; exit }
    END { if (!found) exit 1 }
  ')" || return 1
  [ -n "$cs" ] || return 1
  printf '%s\n' "$cs"
}

# Install the system image if its extracted tree is missing. sdkmanager
# verifies the archive against the manifest SHA1 and fails on mismatch.
ensure_image() {
  local api="$1" dir cs
  dir="$(image_dir "$api")"
  if [ -e "$dir/system.img" ]; then
    return 0
  fi
  if cs="$(checksum_for "$api")"; then
    log "api$api: published SHA1 $cs (sdkmanager verifies the download against it)"
  else
    log "api$api: WARNING - no public checksum in manifest; relying on boot test"
  fi
  log "api$api: installing $(pkg_id "$api")"
  "$SDKMANAGER" "$(pkg_id "$api")"
}

# Set key=value in an AVD config.ini: rewrite an existing line (any spacing) or
# append. Dots in the key are escaped for the line match.
set_kv() {
  local file="$1" key="$2" val="$3" kre tmp
  kre="${key//./\\.}"
  if grep -Eq "^${kre}[[:space:]]*=" "$file" 2>/dev/null; then
    tmp="$(mktemp)"
    awk -v kre="$kre" -v kout="$key" -v v="$val" '
      $0 ~ ("^" kre "[[:space:]]*=") { print kout " = " v; next }
      { print }
    ' "$file" > "$tmp" && mv "$tmp" "$file"
  else
    printf '%s = %s\n' "$key" "$val" >> "$file"
  fi
}

patch_config() {
  local cfg="$1"
  set_kv "$cfg" "hw.gpu.enabled" "yes"
  set_kv "$cfg" "hw.gpu.mode" "host"
  set_kv "$cfg" "hw.ramSize" "$RAM_MB"
}

# Create the AVD if absent, then force host GPU + bare-integer RAM into its
# config (avdmanager writes gpu off and an "M"-suffixed RAM the emulator caps).
ensure_avd() {
  local api="$1" name cfg
  name="$(avd_name "$api")"
  if "$EMULATOR" -list-avds 2>/dev/null | grep -Fxq "$name"; then
    return 0
  fi
  log "api$api: creating AVD $name"
  printf 'no\n' | "$AVDMANAGER" create avd --name "$name" \
    --package "$(pkg_id "$api")" --device pixel_6
  cfg="${AVD_HOME}/${name}.avd/config.ini"
  patch_config "$cfg"
}

# Boot one AVD headless on the NVIDIA GPU and wait for sys.boot_completed.
# Returns 0 on a completed boot, non-zero on timeout. Always tears the emulator
# down. Each call uses its own console port so APIs can boot concurrently.
smoke_boot() {
  local api="$1" port="$2" name serial waited bc epid
  name="$(avd_name "$api")"
  serial="emulator-${port}"
  "$EMULATOR" @"$name" -no-window -no-snapshot -wipe-data -no-audio -no-boot-anim \
    -gpu host -memory "$RAM_MB" -port "$port" >/dev/null 2>&1 &
  epid=$!
  waited=0
  while [ "$waited" -lt "$BOOT_TIMEOUT" ]; do
    bc="$("$ADB" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '[:space:]' || true)"
    if [ "$bc" = "1" ]; then
      "$ADB" -s "$serial" emu kill >/dev/null 2>&1 || true
      wait "$epid" 2>/dev/null || true
      return 0
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done
  "$ADB" -s "$serial" emu kill >/dev/null 2>&1 || true
  kill "$epid" 2>/dev/null || true
  wait "$epid" 2>/dev/null || true
  return 1
}

# Force a clean re-download of a system image (guards a corrupt extracted tree
# that passed the archive checksum).
repull_image() {
  local api="$1"
  log "api$api: repulling $(pkg_id "$api")"
  "$SDKMANAGER" --uninstall "$(pkg_id "$api")"
  "$SDKMANAGER" "$(pkg_id "$api")"
}

# Write a minimal NVIDIA Xorg config (BusID derived from lspci) if absent.
write_xorg_conf() {
  [ -f "$XORG_CONF" ] && return 0
  mkdir -p "$(dirname "$XORG_CONF")"
  local pci busid="PCI:1:0:0"
  pci="$(lspci 2>/dev/null | grep -iE 'vga|3d' | grep -i nvidia | grep -oE '^[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-9]' || true)"
  pci="${pci%%$'\n'*}"
  if [ -n "$pci" ]; then
    busid="PCI:$((16#${pci%%:*})):$((16#$(printf '%s' "$pci" | cut -d: -f2 | cut -d. -f1))):$(printf '%s' "$pci" | cut -d. -f2)"
  fi
  cat > "$XORG_CONF" <<CONF
Section "Device"
    Identifier "Device0"
    Driver "nvidia"
    BusID "$busid"
EndSection
Section "Screen"
    Identifier "Screen0"
    Device "Device0"
    DefaultDepth 24
    Option "AllowEmptyInitialConfiguration" "true"
    SubSection "Display"
        Depth 24
        Virtual 1920 1080
    EndSubSection
EndSection
CONF
}

# Ensure a headless NVIDIA X server is up on $DISPLAY_NUM and export DISPLAY.
ensure_xorg() {
  [ "${SKIP_XORG:-0}" = "1" ] && { export DISPLAY="${DISPLAY:-$DISPLAY_NUM}"; return 0; }
  export DISPLAY="$DISPLAY_NUM"
  local sock="/tmp/.X11-unix/X${DISPLAY_NUM#:}"
  [ -S "$sock" ] && { log "X server already up on $DISPLAY_NUM"; return 0; }
  log "starting headless NVIDIA Xorg on $DISPLAY_NUM"
  write_xorg_conf
  mkdir -p "$(dirname "$XORG_LOG")"
  local xout
  xout="$(mktemp)"
  sudo nohup setsid Xorg "$DISPLAY_NUM" -ac -config "$XORG_CONF" \
    -logfile "$XORG_LOG" -nolisten tcp >"$xout" 2>&1 < /dev/null &
  local waited=0
  while [ ! -S "$sock" ] && [ "$waited" -lt 20 ]; do sleep 1; waited=$((waited + 1)); done
  if [ ! -S "$sock" ]; then
    log "ERROR: Xorg did not come up on $DISPLAY_NUM (log: $XORG_LOG)"
    [ -s "$xout" ] && cat "$xout" >&2
    rm -f "$xout"
    return 1
  fi
  rm -f "$xout"
}

# Ensure images + AVDs, boot every API in parallel, repull+retry any failure,
# and fail hard on an image that will not boot even after a fresh download.
run_all() {
  local api
  for api in $APIS; do
    [[ "$api" =~ ^[0-9]+$ ]] || { log "ERROR: invalid API '$api' (expected digits, e.g. 35)"; return 1; }
  done

  ensure_xorg || return 1

  for api in $APIS; do
    ensure_image "$api"
    ensure_avd "$api"
  done

  declare -A pid_of port_of
  local port=5554
  for api in $APIS; do
    smoke_boot "$api" "$port" &
    pid_of["$api"]=$!
    port_of["$api"]="$port"
    port=$((port + 2))
  done

  local failed=()
  for api in $APIS; do
    if wait "${pid_of[$api]}"; then
      log "api$api: boot OK"
    else
      log "api$api: boot FAILED"
      failed+=("$api")
    fi
  done

  [ "${#failed[@]}" -eq 0 ] && { log "all APIs booted: $APIS"; return 0; }

  local hard=()
  for api in "${failed[@]}"; do
    repull_image "$api"
    if smoke_boot "$api" "${port_of[$api]}"; then
      log "api$api: boot OK after repull"
    else
      log "api$api: STILL failing after repull"
      hard+=("$api")
    fi
  done

  if [ "${#hard[@]}" -gt 0 ]; then
    log "FATAL: images unbootable after repull: ${hard[*]}"
    return 1
  fi
  return 0
}

usage() {
  cat >&2 <<USAGE
Usage: emulator-setup.sh [APIS...]
  Prepares + smoke-tests the headless-NVIDIA emulator env for APIs (default: $APIS).
  Run where /dev/kvm is usable, e.g.: sg kvm -c 'bin/emulator-setup.sh 34 35 36'
USAGE
}

main() {
  set -o pipefail
  case "${1:-}" in -h|--help) usage; return 0 ;; esac
  [ "$#" -gt 0 ] && APIS="$*"
  run_all
}

# Run only when executed, not when sourced (keeps functions unit-testable).
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
