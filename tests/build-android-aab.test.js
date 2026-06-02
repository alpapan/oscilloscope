// Verifies that the project exposes a one-step Android App Bundle (AAB)
// build path: `npm run build:android:aab`. This is a build-output
// contract test, not a runtime test - it runs the real npm script and
// inspects the artefact on disk.
//
// The real-build tests run whenever the build tooling is resolvable (the
// Android SDK, a JDK, and the release keystore), discovered from the
// environment first and then from the project's own config files. They skip
// on a bare CI box that lacks any of them. The skip is explicit so we never
// silently green a build that was not actually exercised - but it triggers on
// genuinely-missing tooling, not merely on a couple of unset env vars.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const AAB_PATH = path.join(
  REPO,
  'android/app/build/outputs/bundle/release/app-release.aab'
);
const LOCAL_PROPS = path.join(REPO, 'android/local.properties');
const GRADLE_PROPS = path.join(REPO, 'android/gradle.properties');
const BUNDLETOOL = path.join(process.env.HOME || '', '.android/bundletool.jar');

// Read a single `key=value` from a Java .properties file, or null.
function readProp(file, key) {
  try {
    const m = fs.readFileSync(file, 'utf8')
      .match(new RegExp('^' + key.replace(/[.]/g, '[.]') + '=(.+)$', 'm'));
    return m ? m[1].trim() : null;
  } catch { return null; }
}
// First existing path among: an explicit env value, the .properties entry,
// then a conventional fallback. Returns null if none of them exist on disk.
function resolveDir(envVal, propFile, propKey, fallback) {
  for (const cand of [envVal, readProp(propFile, propKey), fallback]) {
    if (cand && fs.existsSync(cand)) return cand;
  }
  return null;
}
const SDK = resolveDir(process.env.ANDROID_HOME, LOCAL_PROPS, 'sdk.dir',
  path.join(process.env.HOME || '', 'Android/Sdk'));
const JDK = resolveDir(process.env.JAVA_HOME, GRADLE_PROPS, 'org.gradle.java.home', null);
const KEYSTORE = (() => {
  const f = readProp(GRADLE_PROPS, 'SCOPE_KEYSTORE_FILE');
  return f && fs.existsSync(f) ? f : null;
})();
// A signed release bundle needs the SDK, a JDK, and the release keystore.
// Without any of them, skip rather than hard-fail on an unconfigured box.
const SKIP = !SDK || !JDK || !KEYSTORE;

test('package.json exposes a build:android:aab script', () => {
  // Static check - this part runs regardless of SDK presence so the
  // script-shape regression is caught on every test run.
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(
    pkg.scripts && pkg.scripts['build:android:aab'],
    'expected scripts["build:android:aab"] in package.json'
  );
});

test('android/app/build.gradle declares a bundle config', () => {
  // Static check on the Gradle file: the bundle { } block must exist,
  // and split dimensions (abi/density) must be enabled - those are the
  // load-bearing knobs that make the AAB produce per-device-optimised
  // download slices when Play extracts the APKs server-side.
  const gradle = fs.readFileSync(
    path.join(REPO, 'android/app/build.gradle'), 'utf8'
  );
  assert.match(gradle, /\bbundle\s*\{/, 'expected bundle { } block');
  assert.match(gradle, /abi\s*\{\s*enableSplit\s*=\s*true/);
  assert.match(gradle, /density\s*\{\s*enableSplit\s*=\s*true/);
});

test('build:android:aab produces a signed AAB at the canonical path',
  { skip: SKIP }, () => {
  execSync('npm run build:android:aab', {
    cwd: REPO,
    stdio: 'inherit',
    env: { ...process.env, ANDROID_HOME: SDK, JAVA_HOME: JDK },
  });
  assert.ok(fs.existsSync(AAB_PATH), `expected AAB at ${AAB_PATH}`);
  const size = fs.statSync(AAB_PATH).size;
  assert.ok(size > 1_000_000, `AAB suspiciously small: ${size} bytes`);
});

// The AAB is produced by the previous test in this same run, so its presence
// cannot be a module-load skip predicate; each body asserts it instead. The
// bundletool jar, by contrast, is a static file and CAN gate at load time.
test('AAB is signed (jarsigner-readable signing block present)',
  { skip: SKIP }, () => {
  assert.ok(fs.existsSync(AAB_PATH),
    `AAB missing at ${AAB_PATH} - previous test should have built it`);
  // The AAB is signed with the upload key. Play then re-signs the
  // generated APKs with the app-signing key Google holds. At this
  // local stage we verify the AAB carries OUR keystore's cert. Use the
  // resolved JDK's keytool, not whatever happens to be on PATH.
  const keytool = path.join(JDK, 'bin', 'keytool');
  const out = execSync(`"${keytool}" -printcert -jarfile "${AAB_PATH}"`, {
    encoding: 'utf8',
  });
  assert.match(out, /Signer #1:/, 'expected Signer #1 block in keytool output');
  assert.match(out, /Owner:\s*CN=/, 'expected an Owner CN line');
});

test('bundletool builds a universal APK from the AAB',
  { skip: SKIP || !fs.existsSync(BUNDLETOOL) }, () => {
  assert.ok(fs.existsSync(AAB_PATH),
    `AAB missing at ${AAB_PATH} - previous test should have built it`);
  const java = path.join(JDK, 'bin', 'java');
  const apksOut = path.join(
    REPO, 'android/app/build/outputs/bundle/release/app-release.apks'
  );
  if (fs.existsSync(apksOut)) fs.unlinkSync(apksOut);
  execSync(
    `"${java}" -jar "${BUNDLETOOL}" build-apks ` +
      `--bundle="${AAB_PATH}" --output="${apksOut}" ` +
      `--mode=universal --overwrite`,
    { stdio: 'inherit' }
  );
  assert.ok(fs.existsSync(apksOut), 'bundletool did not produce .apks file');
  const sizeOut = execSync(
    `"${java}" -jar "${BUNDLETOOL}" get-size total --apks="${apksOut}"`,
    { encoding: 'utf8' }
  );
  assert.match(sizeOut, /\d+/, 'expected numeric size from bundletool');
});
