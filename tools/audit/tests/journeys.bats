#!/usr/bin/env bats

load helpers/setup

setup() {
  audit_setup
  JOURNEYS_DIR="${REPO_ROOT}/docs/audits/2026-06-audit/journeys"
}

@test "manifest.yaml exists" {
  [ -f "${JOURNEYS_DIR}/manifest.yaml" ]
}

@test "every XML in journeys/ is well-formed" {
  shopt -s nullglob
  local fails=0
  for xml in "${JOURNEYS_DIR}"/*.xml; do
    xmllint --noout "$xml" || fails=$((fails+1))
  done
  [ "$fails" -eq 0 ]
}

@test "every XML contains at least one <action>" {
  shopt -s nullglob
  for xml in "${JOURNEYS_DIR}"/*.xml; do
    [ "$(xmllint --xpath 'count(//action)' "$xml" 2>/dev/null)" -ge 1 ]
  done
}

@test "manifest journey IDs match XML basenames exactly" {
  manifest_ids="$(awk '/^  - id:/ {print $3}' "${JOURNEYS_DIR}/manifest.yaml" | sort)"
  xml_basenames="$(cd "${JOURNEYS_DIR}" && for f in *.xml; do basename "$f" .xml; done | sort)"
  [ "$manifest_ids" = "$xml_basenames" ]
}

@test "at least one journey is marked emulator: false (proves the gate is real)" {
  grep -q "emulator: false" "${JOURNEYS_DIR}/manifest.yaml"
}

@test "exactly five journeys exist" {
  [ "$(find "${JOURNEYS_DIR}" -maxdepth 1 -name '*.xml' -type f | wc -l)" -eq 5 ]
}
