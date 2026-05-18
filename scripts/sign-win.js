// Custom signer hooked into electron-builder via `build.win.signtoolOptions.sign`.
// Replaces electron-builder's bundled osslsigncode binary (linked against
// libcrypto.so.1.1, which Ubuntu 24.04 no longer ships) with the system
// `osslsigncode` package which links against libcrypto.so.3.
//
// Invoked once per artefact (the Electron app exe + the NSIS installer exe).

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

exports.default = async function sign(config) {
  const {
    path: target,
    hash,
    cscInfo,
    options,
  } = config;

  const file = cscInfo && cscInfo.file;
  const password = (cscInfo && cscInfo.password) || "";
  if (!file) {
    throw new Error("sign-win.js: cscInfo.file is empty - is CSC_LINK / certificateFile set?");
  }

  // electron-builder dual-signs (sha1 + sha256) by default for Windows 7
  // compatibility. We skip the sha1 leg: modern Windows (10+) accepts a
  // single sha256 signature, and emitting both via osslsigncode does not
  // produce a properly-chained dual signature. Trade-off: Windows 7 / Vista
  // would reject these binaries. Acceptable - Scope's targetSdk and runtime
  // assumptions exclude Win7.
  if (hash === "sha1") return;

  // Write the password to a temp file with mode 0600 instead of passing
  // it via -pass on the command line, so it never appears in `ps aux`.
  // osslsigncode supports -readpass for this.
  const passFile = path.join(os.tmpdir(), `.scope-sign-${process.pid}-${Date.now()}`);
  fs.writeFileSync(passFile, password, { mode: 0o600 });

  try {
    const args = [
      "sign",
      "-pkcs12", file,
      "-readpass", passFile,
      "-h", "sha256",
      "-n", (options && options.name) || "Scope",
      "-t", "http://timestamp.digicert.com",
      "-in", target,
      "-out", target + ".signed",
    ];
    execFileSync("osslsigncode", args, { stdio: "inherit" });
    fs.renameSync(target + ".signed", target);
  } finally {
    try { fs.unlinkSync(passFile); } catch (_e) { /* tolerate already-gone */ }
  }
};
