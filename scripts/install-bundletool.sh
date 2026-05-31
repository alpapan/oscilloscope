#!/usr/bin/env bash
# Installs Google's bundletool to ~/.android/bundletool.jar if missing.
# Pinned version + sha256 (no upstream checksums.txt published).
set -euo pipefail
VERSION="1.17.2"
URL="https://github.com/google/bundletool/releases/download/${VERSION}/bundletool-all-${VERSION}.jar"
SHA="2d4ad908faea64047c1cc9cb747e6aa667c6ab192e09607bd16b67246a8cd6ae"
DEST="${HOME}/.android/bundletool.jar"

if [[ -f "${DEST}" ]] && sha256sum "${DEST}" | grep -q "^${SHA}  "; then
  echo "bundletool ${VERSION} already present at ${DEST}"
  exit 0
fi

mkdir -p "$(dirname "${DEST}")"
TMPFILE="${DEST}.download.$$"
trap 'rm -f "${TMPFILE}"' EXIT
curl -fSL "${URL}" -o "${TMPFILE}"
ACTUAL_SHA="$(sha256sum "${TMPFILE}" | awk '{print $1}')"
if [[ "${ACTUAL_SHA}" != "${SHA}" ]]; then
  echo "sha256 mismatch on bundletool download" >&2
  echo "  expected: ${SHA}" >&2
  echo "  actual:   ${ACTUAL_SHA}" >&2
  exit 1
fi
mv "${TMPFILE}" "${DEST}"
trap - EXIT
echo "Installed bundletool ${VERSION} to ${DEST}"
