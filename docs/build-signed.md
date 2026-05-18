# Signed Windows installer

Long-form notes for code-signing Scope's Electron installer. The short version
lives in `README.md`; this file covers rotation, expiry, fallback paths, and
the Windows-side behaviour the short version glosses over.

## Why self-signed

Buying a CA-issued code-signing cert costs $200-$600/year and requires
identity verification. For a personal sideload of Scope onto a small number
of trusted machines, that overhead is not worth it. A self-signed cert:

- Carries a real, verifiable signature with publisher CN.
- Is trusted automatically by the machines that have the public cert
  imported into `TrustedPublisher` — UAC shows the publisher name, no
  warnings.
- Still produces a SmartScreen warning on machines that have *not* imported
  the cert. SmartScreen reputation is built from CA-issued certs and
  download volume; a self-signed cert can never accumulate that reputation.

So: self-signed is fine for your own laptop + a friend's. Not for public
distribution; for that, buy a cert.

## One-time setup

```sh
sudo apt-get install -y wine64 wine-binfmt mono-devel openssl osslsigncode
./scripts/generate-signing-cert.sh
# Prompts for a password. Keep this password somewhere safe.
```

The script writes `~/.scope-signing/scope-signing.pfx` (private key + cert)
and `~/.scope-signing/scope-signing.crt` (public cert only).

## Each build

```sh
export CSC_LINK="file://$HOME/.scope-signing/scope-signing.pfx"
export CSC_KEY_PASSWORD='your-password-here'
npm run dist:win
npm run verify:win
```

`dist:win` produces:

- `dist/Scope Setup 0.3.0.exe` — NSIS installer (signed)
- `dist/win-unpacked/Scope.exe` — bundled Electron binary (signed)

`verify:win` runs `osslsigncode verify -CAfile ~/.scope-signing/scope-signing.crt`
against the installer; you should see "Signature verification: ok".

## Install on Windows

Before running the installer on a Windows machine, import the public cert so
Windows trusts the publisher:

```powershell
# PowerShell, run once per user, no admin needed
Import-Certificate -FilePath scope-signing.crt -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
```

`scope-signing.crt` is the public cert, safe to email / copy on a USB stick.
Do NOT distribute `scope-signing.pfx` — that file contains the private key.

After import, SmartScreen and UAC show "Alexie Papanicolaou" as the publisher
on every install of Scope. Without the import, SmartScreen warns once on
install ("Windows protected your PC — Don't run"); user clicks "More info →
Run anyway".

## Rotation

If the password is lost, the cert is unrecoverable. The remedy:

```sh
rm ~/.scope-signing/scope-signing.pfx ~/.scope-signing/scope-signing.key
./scripts/generate-signing-cert.sh
```

This generates a fresh cert. Existing installers signed with the old cert
are now "signed by an unknown publisher" on machines that imported the old
cert; users must re-import the new `scope-signing.crt` to get publisher
attribution back.

Cert expiry (10 years) follows the same path: regenerate, redistribute
`scope-signing.crt`, ship a fresh installer.

## Timestamp server

`package.json` pins the timestamp server to `http://timestamp.digicert.com`
under `build.win.signtoolOptions`. If that URL is unreachable at build time
electron-builder's signing step may fail or produce an unstamped signature.

Untimestamped signatures remain valid for verify-time chain checking only
until the signing cert expires. Once the cert expires, untimestamped
binaries become "unsigned" from Windows' perspective; timestamped binaries
remain trusted forever because the timestamp proves the signature was made
before the cert expired.

For Scope this matters mostly if you have ten-year-old installers floating
around. If a timestamp is unavailable on a specific build, you can override
in `package.json` by editing `signtoolOptions.timestamp` to another TSA
(e.g. `http://timestamp.sectigo.com`, `http://timestamp.globalsign.com`).

## Fallback: osslsigncode directly

If `npm run dist:win` fails inside electron-builder's wine-bridged
`signtool.exe` invocation, you can sign the binaries afterwards from Linux:

```sh
cd dist
osslsigncode sign \
  -pkcs12 ~/.scope-signing/scope-signing.pfx -pass "$CSC_KEY_PASSWORD" \
  -t http://timestamp.digicert.com \
  -in win-unpacked/Scope.exe \
  -out win-unpacked/Scope.exe.signed
mv win-unpacked/Scope.exe.signed win-unpacked/Scope.exe
# repeat for 'Scope Setup 0.3.0.exe' if NSIS step succeeded but signing
# inside it did not.
```

`osslsigncode` is a pure-Linux signtool replacement; no wine required. Useful
when electron-builder's signing path is broken on a specific wine/mono
version.

## Testing

Manual verification on Windows is the gate:

1. Copy `dist/Scope Setup 0.3.0.exe` to a Windows 11 22H2+ machine (Windows
   10 also works but SmartScreen behaviour differs — 22H2 is the documented
   baseline).
2. Run the installer.
3. Check the UAC prompt's "Publisher" line — should read "Alexie
   Papanicolaou" (or whatever CN you set), not "Unknown".
4. If SmartScreen warns ("Windows protected your PC"), confirm it's the
   "unknown publisher" reputation warning, not a "signature invalid"
   warning. Click "More info → Run anyway" once; subsequent runs are
   silent.
5. After install, import `scope-signing.crt` into `TrustedPublisher` (see
   above) and re-run the installer; SmartScreen should now be silent.
