#!/usr/bin/env bash
# Create the audit AVD matrix. Three AVDs covering the API range Scope supports
# (minSdk 34, targetSdk 36). Named, API-specific AVDs are created with
# avdmanager because the android CLI's `emulator create` only accepts a device
# profile, not a name/API level. Idempotent: existing AVDs are skipped.
# Requires JAVA_HOME set for avdmanager (the android CLI itself is self-contained).
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
AVDMANAGER="${ANDROID_HOME}/cmdline-tools/latest/bin/avdmanager"
DEVICE=pixel_6

create_avd_if_missing() {
  local name="$1" api="$2"
  if android emulator list | grep -Fxq "$name"; then
    return 0
  fi
  echo "no" | "$AVDMANAGER" create avd \
    --name "$name" \
    --package "system-images;android-${api};google_apis;x86_64" \
    --device "$DEVICE"
}

create_avd_if_missing scope-api34 34
create_avd_if_missing scope-api35 35
create_avd_if_missing scope-api36 36

android emulator list
