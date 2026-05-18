# Plan: Signed Windows installer for Scope

**Date:** 2026-05-18
**Branch:** `feat/android-pip`
**Tail commit at planning time:** `8f053ce`
**Build host:** Ubuntu (Linux x86_64); wine64 + mono-devel already installed by the user; no Windows machine in the loop.

## Goal

Produce a code-signed Windows installer (`Scope Setup 0.3.0.exe`) and a signed bundled `Scope.exe` for the Electron wrapper, built from the Linux host. The installer should:

- Pass Windows SmartScreen's "unknown publisher" check at least for the local user (the cert is in the user's TrustedPublisher store) without requiring CA-issued certs.
- Show the publisher name on the UAC prompt instead of "Unknown publisher".
- Carry the correct file-version metadata + icon (which already happens via rcedit once wine works).
- Be reproducible from a fresh checkout given the user's existing cert.

We are not pursuing a CA-issued (DigiCert, Sectigo, etc.) cert in this plan — those cost money and add procurement steps. A self-signed cert is sufficient for the user's personal sideload use case and matches what they did for the Android keystore.

## Non-goals

- Cross-signing for Microsoft kernel-mode driver loading (irrelevant for an Electron app).
- Time-stamped signatures via a public timestamp server (we will include this, but if the timestamp server is unreachable the build should still succeed without TSA — documented as `--timestamp=""` fallback).
- Distribution via Microsoft Store (separate flow, separate cert type).

## What "signed" means here

Two artefacts get signed by electron-builder during `dist:win`:

1. `dist/win-unpacked/Scope.exe` — the Electron-bundled app binary
2. `dist/Scope Setup 0.3.0.exe` — the NSIS installer wrapper

Both are signed via `signtool.exe` under wine, using the same `.pfx` certificate file electron-builder is pointed at. The cert is a PKCS#12 bundle containing:

- An RSA-2048 (or 3072) private key
- A self-signed X.509 certificate with `codeSigning` EKU (1.3.6.1.5.5.7.3.3)
- Subject CN = "Alexie Papanicolaou" (or whatever the user chooses)

## Approach

### Step 1: Cert generation script

Create `scripts/generate-signing-cert.sh`:

```sh
#!/bin/sh
set -eu
CERT_DIR="${SCOPE_CERT_DIR:-$HOME/.scope-signing}"
mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

# Skip if cert already exists.
if [ -f scope-signing.pfx ]; then
  echo "scope-signing.pfx already exists at $CERT_DIR; remove it first to regenerate." >&2
  exit 0
fi

# Generate RSA-3072 key + self-signed cert with codeSigning EKU, 10-year validity.
openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
  -keyout scope-signing.key \
  -out scope-signing.crt \
  -subj "/CN=${SCOPE_CERT_CN:-Alexie Papanicolaou}" \
  -addext "extendedKeyUsage=codeSigning"

# Bundle into PKCS#12 .pfx with a password the user will type once.
# Use legacy mode because Windows signtool prior to recent updates does not
# accept the new PKCS#12 PBES2 encryption.
read -r -s -p "Set a password for the new signing cert: " PFX_PASS
echo
openssl pkcs12 -export -legacy \
  -in scope-signing.crt \
  -inkey scope-signing.key \
  -out scope-signing.pfx \
  -passout "pass:${PFX_PASS}" \
  -name "Scope code signing"

echo "Generated $CERT_DIR/scope-signing.pfx"
echo "Set env CSC_LINK=\"file://$CERT_DIR/scope-signing.pfx\" and CSC_KEY_PASSWORD=\$PFX_PASS for electron-builder."
```

The cert location defaults to `~/.scope-signing/` so the .pfx never lives in the repo. The script is idempotent (it refuses to overwrite an existing .pfx).

### Step 2: electron-builder config

electron-builder accepts the cert via env vars (`CSC_LINK` + `CSC_KEY_PASSWORD`) without modifying `package.json`. Optionally we can hard-wire it in package.json under `build.win` with `certificateFile` / `certificatePassword` but env vars keep secrets out of the repo. Plan: env-vars-only, document in README.

Timestamp server: electron-builder defaults to DigiCert's TSA at `http://timestamp.digicert.com`. We allow override via `WIN_CSC_TIMESTAMP_URL` env var (electron-builder's documented `signtoolOptions.timestamp` setting) for environments where that URL is blocked.

If the timestamp call fails the build will continue with an unsigned timestamp (signature valid until cert expiry, no anchor at install time). We accept that degradation.

### Step 3: README + docs/build-signed.md update

Document the flow:

```sh
# One-time: install cert toolchain (already done by user)
sudo apt-get install -y wine64 wine-binfmt mono-devel openssl

# One-time: generate a self-signed code-signing cert
./scripts/generate-signing-cert.sh
# enter a password when prompted; remember it

# Each build:
export CSC_LINK="file://$HOME/.scope-signing/scope-signing.pfx"
export CSC_KEY_PASSWORD='your password here'
npm run dist:win
```

Output lands in `dist/Scope Setup 0.3.0.exe`. The installer is signed; the inner `Scope.exe` is signed; both pass `signtool verify /pa` on Windows.

To install the publisher cert into the user's Trusted Publishers store so SmartScreen / UAC shows the publisher name (rather than "Unknown publisher"):

```powershell
# On the target Windows machine, once per user
Import-Certificate -FilePath scope-signing.crt -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
```

We ship `scope-signing.crt` (PUBLIC cert, no key) alongside the installer in `dist/`. It does NOT contain the private key — safe to distribute.

### Step 4: gitignore additions

Add to `.gitignore`:

```
# Code signing artefacts - never commit private keys or pfx bundles
*.pfx
*.key
scope-signing.crt
```

Even though the user's cert lives in `~/.scope-signing/` outside the repo, an in-repo accident is one `cp` away. Block at the gitignore level.

### Step 5: Build verification step

Add a verification target to package.json scripts:

```
"verify:win": "osslsigncode verify -in 'dist/Scope Setup 0.3.0.exe'"
```

`osslsigncode` is the Linux counterpart of Windows `signtool verify`. Install via `sudo apt-get install -y osslsigncode`. It confirms the installer is signed and the signature chains to our self-signed cert.

## Files

| File | Change | Why |
|---|---|---|
| `scripts/generate-signing-cert.sh` | new | One-shot cert generation |
| `.gitignore` | append `*.pfx`, `*.key`, `scope-signing.crt` | Guard against accidental commit |
| `package.json` | add `verify:win` script | Post-build signature check |
| `README.md` | add "Signed Windows build" subsection | User-facing instructions |
| `docs/build-signed.md` | new | Long-form notes: cert rotation, SmartScreen behaviour, fallback when TSA is down |

No changes to `electron/main.js` or any renderer code. The signing is purely a build-pipeline change.

## Risks and mitigations

- **TSA unreachable** → signature still applied but without timestamp; signature becomes "valid for verify-only, not for installer-trust-after-expiry" semantics. Acceptable; documented.
- **wine/mono incompatibility with the signtool variant electron-builder bundles** → fallback: invoke `osslsigncode sign` ourselves via a custom `signtoolOptions.sign` hook in the build config that shells out instead of using wine. Implementation deferred until step-3 build empirically fails.
- **Self-signed cert SmartScreen warning** → unavoidable for non-CA certs. SmartScreen will warn unless the cert is in `TrustedPublisher` on the target machine. README points users at the `Import-Certificate` PowerShell command. For wider distribution the user would need an EV cert from a CA.
- **Cert in user's `~/.scope-signing/` getting backed up to a cloud sync** → the user is on their own machine; we add a comment in the cert script reminding them to keep that dir out of any sync targets.

## Build sequence

1. Add `scripts/generate-signing-cert.sh` with executable bit.
2. Add `.gitignore` entries.
3. Add `verify:win` to `package.json`.
4. Run `./scripts/generate-signing-cert.sh` to generate the cert (user prompted for password).
5. `export CSC_LINK=...; export CSC_KEY_PASSWORD=...`.
6. `npm run dist:win`.
7. `npm run verify:win` to confirm signature.
8. Write README section.
9. Write `docs/build-signed.md`.
10. Commit (after code-review).

## Test plan

- Run `./scripts/generate-signing-cert.sh` from a clean state; verify `~/.scope-signing/scope-signing.pfx` exists with mode 600.
- Run `./scripts/generate-signing-cert.sh` again; verify it refuses to overwrite.
- Run `npm run dist:win`; verify `dist/Scope Setup 0.3.0.exe` and `dist/win-unpacked/Scope.exe` both exist and are larger than the unsigned versions (signature adds ~6 KB).
- Run `npm run verify:win`; verify output contains "Signature verified successfully" or similar from osslsigncode.
- On a Windows test box (or VM), run the installer; confirm publisher name appears as "Alexie Papanicolaou" in UAC; confirm SmartScreen warning appears (expected for non-CA cert); accept; confirm install completes and Scope launches.
- Repeat after importing `scope-signing.crt` into the user's `TrustedPublisher` store; confirm SmartScreen warning is suppressed for that user.
