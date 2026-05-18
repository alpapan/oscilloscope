#!/bin/sh
# Generate a self-signed code-signing cert for Scope's Windows installer.
# RSA-3072, 10-year validity, codeSigning EKU, packaged as PKCS#12.
#
# Output lives in $SCOPE_CERT_DIR (default ~/.scope-signing/) - outside the
# repo so a stray git add never sweeps the private key in.
#
# Idempotent: refuses to overwrite an existing .pfx. Delete the file
# manually to regenerate (and be sure no signed artefacts in the wild still
# trust it).
set -eu

# Prerequisite check.
for tool in openssl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FATAL: $tool not found in PATH. Install it and retry." >&2; exit 1; }
done

CERT_DIR="${SCOPE_CERT_DIR:-$HOME/.scope-signing}"
mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"
cd "$CERT_DIR"

if [ -f scope-signing.pfx ]; then
  echo "scope-signing.pfx already exists at $CERT_DIR." >&2
  echo "Remove it first if you really want to regenerate (signed binaries already in the wild will be orphaned)." >&2
  exit 0
fi

CN="${SCOPE_CERT_CN:-Alexie Papanicolaou}"

# RSA-3072 + self-signed X.509 with codeSigning EKU. 10-year validity is
# long enough that we will not rotate within Scope's expected lifetime;
# the upside is the user only types a password once.
openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
  -keyout scope-signing.key \
  -out scope-signing.crt \
  -subj "/CN=${CN}" \
  -addext "extendedKeyUsage=codeSigning"

# Prompt for password without echoing. If stty -echo fails (e.g. no TTY,
# running under CI / non-interactive shell), refuse to proceed rather than
# silently echo the password to the terminal/log.
if ! stty -echo 2>/dev/null; then
  echo "FATAL: cannot disable terminal echo (no controlling TTY?). Refusing to prompt for a password that would be visible." >&2
  echo "       Run this script from an interactive terminal." >&2
  exit 1
fi
trap 'stty echo 2>/dev/null' EXIT INT TERM
printf "Set a password for the new signing cert (you will need it on each build): "
read -r PFX_PASS
stty echo 2>/dev/null
echo

# Use -legacy mode for compatibility with older Windows signtool variants
# that do not understand PBES2-encrypted PKCS#12. Modern Windows 11
# signtool would accept either; we pick the wider-compatible path.
openssl pkcs12 -export -legacy \
  -in scope-signing.crt \
  -inkey scope-signing.key \
  -out scope-signing.pfx \
  -passout "pass:${PFX_PASS}" \
  -name "Scope code signing"

chmod 600 scope-signing.pfx scope-signing.key

cat <<EOF

Generated: $CERT_DIR/scope-signing.pfx (PKCS#12, private key + cert)
Generated: $CERT_DIR/scope-signing.crt (public cert only - safe to distribute)

To use for the next build:
  export CSC_LINK="file://$CERT_DIR/scope-signing.pfx"
  export CSC_KEY_PASSWORD='<the password you just set>'
  npm run dist:win

WARNING
=======
$CERT_DIR contains the PRIVATE KEY for code-signing.
DO NOT sync this directory to Dropbox / iCloud / OneDrive / etc.
DO NOT commit it to git (an entry is already in .gitignore but be careful with cp).
A leaked private key lets anyone sign installers as you.
EOF
