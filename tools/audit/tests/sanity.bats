#!/usr/bin/env bats

# Bootstrap smoke test ONLY. Proves the bats binary, the npm test:audit
# wiring, and the tools/audit/tests/ directory are all set up correctly
# before any contract-asserting test runs. Kept intentionally trivial -
# do NOT add real assertions here; they belong in the per-script .bats
# files (setup-android-cli.bats, etc.).
@test "bats itself is alive" {
  result=$((2 + 2))
  [ "$result" -eq 4 ]
}
