# Plan review: signed Windows installer (reviewer copy)

Plan: `docs/plans/2026-05-18-signed-windows-installer.md`
Reviewer: plan-reviewer subagent
Reviewer verdict: **Yes, with fixes — needs revision before implementation**

## Findings

### CRITICAL
- **CRITICAL-1**: `WIN_CSC_TIMESTAMP_URL` env var does not exist in electron-builder v25. Timestamp override is via `build.win.signtoolOptions.timestamp` in `package.json`, not env var. Plan claims env-var override as fact at line 86 — incorrect.

### IMPORTANT
- **IMPORTANT-3**: No automated build/verify test — manual on Windows VM only. Suggest CI workflow or at least documented manual-test gate.
- **IMPORTANT-4**: `osslsigncode verify` is missing the `-signer scope-signing.crt` flag; current form may report false success on some versions.
- **IMPORTANT-5**: Private-key backup warning is mentioned in plan prose but NOT actually written into the script. Script must `echo` the warning on completion.

### NICE-TO-HAVE / SUGGESTIONS
- **SUGGESTION-6**: No cert rotation/expiry path documented; defer to `docs/build-signed.md`.
- **SUGGESTION-7**: Test plan doesn't specify Windows version. Suggest Windows 11 22H2+ as baseline.
- **SUGGESTION-8**: No prerequisite check in script for openssl / wine64 / mono-devel.

### UNVERIFIED CLAIMS
- electron-builder auto-detection of wine/mono on this specific Ubuntu version — not empirically verified.
- signtool.exe under wine accepting our PKCS#12 cert — plausible but not guaranteed.
- SmartScreen suppression after TrustedPublisher import — Windows-documented but cache-dependent.

### STRENGTHS
- Environment-variable-only secrets handling
- Idempotent cert generation script
- Self-signed-cert + TrustedPublisher install pattern is correct
- Cert location isolation (`~/.scope-signing/`) plus gitignore guard
- RSA-3072 + 10-year validity
- Comprehensive (if manual) test plan

## Disposition (author response)

Addressing all findings before implementation:

- **CRITICAL-1**: FIX — replace env-var-timestamp claim with `package.json` `build.win.signtoolOptions.timestamp` config in Step 2.
- **IMPORTANT-3**: ACCEPT documented-manual-test as the gate; CI workflow deferred to follow-up. Add explicit "manual verification on Windows 11 22H2" step to the test plan.
- **IMPORTANT-4**: FIX — add `-CAfile scope-signing.crt` (correct osslsigncode v2.x form, not `-signer`) to the verify command.
- **IMPORTANT-5**: FIX — add explicit `echo` warning at end of cert script.
- **SUGGESTION-6**: ADDRESS in `docs/build-signed.md` — document rotation, password loss, expiry.
- **SUGGESTION-7**: ADDRESS in test plan — Windows 11 22H2 baseline.
- **SUGGESTION-8**: FIX — script checks for openssl presence at start.
- **UNVERIFIED CLAIMS**: ACCEPT — flagged as "known risks requiring empirical validation" already in plan §Risks. Will validate at Step 6 (first build).
