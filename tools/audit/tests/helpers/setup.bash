# Common bats setup. Sourced by every .bats file with `load helpers/setup`.
# Prepends the test's fake-bin/ to PATH so scripts under test see shimmed
# `android`, `adb`, `gradlew`, `npm`, `gcloud` commands instead of the real
# ones. Each test that needs a specific shim writes one to BATS_TEST_TMPDIR
# (which bats sets per test) and exports BATS_TEST_TMPDIR ahead of PATH.
audit_setup() {
  export FAKE_BIN="${BATS_TEST_DIRNAME}/helpers/fake-bin"
  export PATH="${BATS_TEST_TMPDIR}:${FAKE_BIN}:${PATH}"
  export REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../../.." && pwd)"
}
