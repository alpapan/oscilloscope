#!/usr/bin/env bats
#
# Unit tests for bin/emulator-setup.sh. The script is source-guarded, so these
# tests source it and exercise individual functions against CLI fakes
# (sdkmanager / avdmanager / emulator / adb / curl) that mirror the real tools'
# observable behaviour. No real SDK, network, or emulator is touched.

load helpers/setup

setup() {
  audit_setup

  export ANDROID_HOME="${BATS_TEST_TMPDIR}/sdk"
  export AVD_HOME="${BATS_TEST_TMPDIR}/avd"
  mkdir -p "${ANDROID_HOME}" "${AVD_HOME}"

  # State files the fakes read/write.
  export SDKM_CALLS="${BATS_TEST_TMPDIR}/sdkmanager.calls"
  export EMU_CALLS="${BATS_TEST_TMPDIR}/emulator.calls"
  export AVD_STORE="${BATS_TEST_TMPDIR}/avd-store"
  export BOOT_RESULT_FILE="${BATS_TEST_TMPDIR}/boot-result"   # holds "1" (booted) or "" (never)
  : > "${SDKM_CALLS}"; : > "${EMU_CALLS}"; : > "${AVD_STORE}"; : > "${BOOT_RESULT_FILE}"

  # --- fake sdkmanager -----------------------------------------------------
  # Records its args. On install of "system-images;..." creates the extracted
  # image dir. On --uninstall removes it. On install it also marks the image
  # bootable (boot-result="1") UNLESS $ANDROID_HOME/.sdkmanager-wont-fix exists
  # (the "repull cannot save a fundamentally broken image" case).
  cat > "${BATS_TEST_TMPDIR}/sdkmanager" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "${SDKM_CALLS}"
pkg=""; uninstall=0
for a in "$@"; do
  case "$a" in
    --uninstall) uninstall=1 ;;
    system-images*) pkg="$a" ;;
  esac
done
[ -n "$pkg" ] || exit 0
dir="${ANDROID_HOME}/$(printf '%s' "$pkg" | tr ';' '/')"
if [ "$uninstall" = 1 ]; then
  rm -rf "$dir"
else
  mkdir -p "$dir"; printf 'fake-system-image\n' > "$dir/system.img"
  [ -e "${ANDROID_HOME}/.sdkmanager-wont-fix" ] || printf '1' > "${BOOT_RESULT_FILE}"
fi
EOF
  chmod +x "${BATS_TEST_TMPDIR}/sdkmanager"
  export SDKMANAGER="${BATS_TEST_TMPDIR}/sdkmanager"

  # --- fake avdmanager -----------------------------------------------------
  # Consumes the piped prompt answer, records the AVD, and writes a config.ini
  # exactly as the real tool does: gpu disabled, RAM with an "M" suffix. The
  # script under test must PATCH these (gpu host, bare-int RAM).
  cat > "${BATS_TEST_TMPDIR}/avdmanager" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
[ "$1 $2" = "create avd" ] || exit 0
shift 2
name=""
while [ $# -gt 0 ]; do
  case "$1" in --name) name="$2"; shift 2 ;; *) shift ;; esac
done
if grep -Fxq "$name" "${AVD_STORE}" 2>/dev/null; then
  echo "Error: AVD ${name} already exists." >&2; exit 1
fi
d="${AVD_HOME}/${name}.avd"; mkdir -p "$d"
cat > "$d/config.ini" <<CFG
hw.gpu.enabled = no
hw.gpu.mode = auto
hw.ramSize = 1536M
CFG
echo "$name" >> "${AVD_STORE}"
EOF
  chmod +x "${BATS_TEST_TMPDIR}/avdmanager"
  export AVDMANAGER="${BATS_TEST_TMPDIR}/avdmanager"

  # --- fake emulator -------------------------------------------------------
  # `-list-avds` prints the AVD store; a boot invocation is recorded then
  # returns (the script backgrounds it and polls adb for boot state).
  cat > "${BATS_TEST_TMPDIR}/emulator" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "-list-avds" ]; then cat "${AVD_STORE}" 2>/dev/null; exit 0; fi
echo "$*" >> "${EMU_CALLS}"
exit 0
EOF
  chmod +x "${BATS_TEST_TMPDIR}/emulator"
  export EMULATOR="${BATS_TEST_TMPDIR}/emulator"

  # --- fake adb ------------------------------------------------------------
  cat > "${BATS_TEST_TMPDIR}/adb" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"getprop sys.boot_completed"*) cat "${BOOT_RESULT_FILE}" 2>/dev/null ;;
  *"emu kill"*) echo "OK: killing emulator, bye bye" ;;
  *"get-state"*) echo "device" ;;
esac
exit 0
EOF
  chmod +x "${BATS_TEST_TMPDIR}/adb"
  export ADB="${BATS_TEST_TMPDIR}/adb"

  # --- fake curl (manifest) ------------------------------------------------
  # Emits a minimal sys-img manifest carrying one <complete> block per API with
  # size/checksum/url in the real order (checksum precedes url).
  cat > "${BATS_TEST_TMPDIR}/manifest.xml" <<'EOF'
<sys-img>
 <remotePackage path="system-images;android-34;google_apis;x86_64">
  <archive><complete><size>1</size><checksum>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0034</checksum><url>x86_64-34_r14.zip</url></complete></archive>
 </remotePackage>
 <remotePackage path="system-images;android-35;google_apis;x86_64">
  <archive><complete><size>2</size><checksum>bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0035</checksum><url>x86_64-35_r09.zip</url></complete></archive>
 </remotePackage>
 <remotePackage path="system-images;android-36;google_apis;x86_64">
  <archive><complete><size>3</size><checksum>cccccccccccccccccccccccccccccccccccc0036</checksum><url>x86_64-36_r07.zip</url></complete></archive>
 </remotePackage>
</sys-img>
EOF
  cat > "${BATS_TEST_TMPDIR}/curl" <<'EOF'
#!/usr/bin/env bash
cat "${BATS_TEST_TMPDIR}/manifest.xml"
EOF
  chmod +x "${BATS_TEST_TMPDIR}/curl"
  export CURL="${BATS_TEST_TMPDIR}/curl"

  # Fast, hermetic defaults.
  export SKIP_XORG=1
  export BOOT_TIMEOUT=2
  export POLL_INTERVAL=1
  export RAM_MB=3072
  export TAG=google_apis
  export ABI=x86_64

  SCRIPT="${REPO_ROOT}/bin/emulator-setup.sh"
}

image_dir() { printf '%s/system-images/android-%s/%s/%s' "${ANDROID_HOME}" "$1" "${TAG}" "${ABI}"; }

@test "bin/emulator-setup.sh exists and is executable" {
  [ -x "${SCRIPT}" ]
}

@test "script is source-safe: sourcing does not run the setup" {
  source "${SCRIPT}"
  [ -z "$(cat "${EMU_CALLS}")" ]
  [ -z "$(cat "${SDKM_CALLS}")" ]
}

@test "checksum_for returns the manifest SHA1 for an API" {
  source "${SCRIPT}"
  run checksum_for 35
  [ "$status" -eq 0 ]
  [ "$output" = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0035" ]
}

@test "checksum_for fails when the API has no published archive" {
  source "${SCRIPT}"
  run checksum_for 99
  [ "$status" -ne 0 ]
}

@test "ensure_image installs via sdkmanager when the image is absent" {
  source "${SCRIPT}"
  run ensure_image 35
  [ "$status" -eq 0 ]
  grep -q "system-images;android-35;google_apis;x86_64" "${SDKM_CALLS}"
  [ -f "$(image_dir 35)/system.img" ]
}

@test "ensure_image is a no-op when the image already exists" {
  mkdir -p "$(image_dir 35)"; : > "$(image_dir 35)/system.img"
  source "${SCRIPT}"
  run ensure_image 35
  [ "$status" -eq 0 ]
  [ ! -s "${SDKM_CALLS}" ]
}

@test "ensure_avd creates the AVD and patches config to host GPU + bare-int RAM" {
  source "${SCRIPT}"
  run ensure_avd 35
  [ "$status" -eq 0 ]
  grep -Fxq "scope-api35" "${AVD_STORE}"
  cfg="${AVD_HOME}/scope-api35.avd/config.ini"
  grep -Eq "^hw\.gpu\.enabled[[:space:]]*=[[:space:]]*yes$" "$cfg"
  grep -Eq "^hw\.gpu\.mode[[:space:]]*=[[:space:]]*host$" "$cfg"
  grep -Eq "^hw\.ramSize[[:space:]]*=[[:space:]]*3072$" "$cfg"
  ! grep -q "3072M" "$cfg"
}

@test "ensure_avd is a no-op when the AVD already exists" {
  echo "scope-api35" > "${AVD_STORE}"
  source "${SCRIPT}"
  run ensure_avd 35
  [ "$status" -eq 0 ]
  [ "$(grep -c . "${AVD_STORE}")" -eq 1 ]
}

@test "smoke_boot succeeds when boot_completed reports 1" {
  printf '1' > "${BOOT_RESULT_FILE}"
  source "${SCRIPT}"
  run smoke_boot 35 5554
  [ "$status" -eq 0 ]
  grep -q "@scope-api35" "${EMU_CALLS}"
  grep -q -- "-memory 3072" "${EMU_CALLS}"
  grep -q -- "-gpu host" "${EMU_CALLS}"
}

@test "smoke_boot fails (within timeout) when boot never completes" {
  : > "${BOOT_RESULT_FILE}"
  source "${SCRIPT}"
  run smoke_boot 35 5554
  [ "$status" -ne 0 ]
}

@test "repull_image uninstalls then reinstalls the image" {
  source "${SCRIPT}"
  run repull_image 35
  [ "$status" -eq 0 ]
  grep -q -- "--uninstall system-images;android-35;google_apis;x86_64" "${SDKM_CALLS}"
  grep -Eq "^system-images;android-35;google_apis;x86_64$" "${SDKM_CALLS}"
}

@test "run_all: all images present and bootable exits 0 and boots every API" {
  export APIS="34 35 36"
  printf '1' > "${BOOT_RESULT_FILE}"
  source "${SCRIPT}"
  run run_all
  [ "$status" -eq 0 ]
  grep -q "@scope-api34" "${EMU_CALLS}"
  grep -q "@scope-api35" "${EMU_CALLS}"
  grep -q "@scope-api36" "${EMU_CALLS}"
}

@test "run_all: a bad-but-repullable image triggers a repull and then passes" {
  export APIS="35"
  mkdir -p "$(image_dir 35)"; : > "$(image_dir 35)/system.img"   # present but bad
  : > "${BOOT_RESULT_FILE}"                                       # first boot fails
  source "${SCRIPT}"
  run run_all
  [ "$status" -eq 0 ]                                            # repull (sets boot=1) then passes
  grep -q -- "--uninstall system-images;android-35;google_apis;x86_64" "${SDKM_CALLS}"
}

@test "run_all: an image that never boots even after repull fails hard" {
  export APIS="35"
  mkdir -p "$(image_dir 35)"; : > "$(image_dir 35)/system.img"
  : > "${BOOT_RESULT_FILE}"
  : > "${ANDROID_HOME}/.sdkmanager-wont-fix"                      # repull cannot fix it
  source "${SCRIPT}"
  run run_all
  [ "$status" -ne 0 ]
}
