#!/usr/bin/env bash
# Audit harness bootstrap. Install Google's `android` CLI (Linux x86_64) if
# absent, then install the three system images we need for the audit AVD
# matrix. Idempotent: re-running with the CLI already on PATH skips the
# network call entirely.
set -euo pipefail

if ! command -v android >/dev/null 2>&1; then
  curl -fsSL https://dl.google.com/android/cli/latest/linux_x86_64/install.sh | bash
fi

android --version

android sdk install \
  emulator \
  platform-tools \
  "system-images/android-34/google_apis/x86_64" \
  "system-images/android-35/google_apis/x86_64" \
  "system-images/android-36/google_apis/x86_64"

android sdk list
