// Verifies that the project exposes a one-step Android App Bundle (AAB)
// build path: `npm run build:android:aab`. This is a build-output
// contract test, not a runtime test — it runs the real npm script and
// inspects the artefact on disk.
//
// Skipped if ANDROID_HOME is not set or JAVA_HOME is unset (e.g. CI
// without an Android SDK). The skip is explicit so we never silently
// green a build that wasn't actually exercised.

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
const SDK = process.env.ANDROID_HOME;
const JDK = process.env.JAVA_HOME;
const SKIP = !SDK || !JDK;

test('package.json exposes a build:android:aab script', () => {
  // Static check — this part runs regardless of SDK presence so the
  // script-shape regression is caught on every test run.
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(
    pkg.scripts && pkg.scripts['build:android:aab'],
    'expected scripts["build:android:aab"] in package.json'
  );
});

test('android/app/build.gradle declares a bundle config', () => {
  // Static check on the Gradle file: the bundle { } block must exist,
  // and split dimensions (abi/density) must be enabled — those are the
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
    env: { ...process.env },
  });
  assert.ok(fs.existsSync(AAB_PATH), `expected AAB at ${AAB_PATH}`);
  const size = fs.statSync(AAB_PATH).size;
  assert.ok(size > 1_000_000, `AAB suspiciously small: ${size} bytes`);
});

const BUNDLETOOL = path.join(process.env.HOME || '', '.android/bundletool.jar');

// Skip predicates are evaluated at module-load time, so we cannot gate
// these on AAB / bundletool presence there — the AAB is produced by the
// previous test in this same run. Each test body short-circuits with a
// clear assertion message if the prerequisite is missing.
test('AAB is signed (jarsigner-readable signing block present)',
  { skip: SKIP }, () => {
  assert.ok(fs.existsSync(AAB_PATH),
    `AAB missing at ${AAB_PATH} — previous test should have built it`);
  // The AAB is signed with the upload key. Play then re-signs the
  // generated APKs with the app-signing key Google holds. At this
  // local stage we verify the AAB carries OUR keystore's cert.
  const out = execSync(`keytool -printcert -jarfile "${AAB_PATH}"`, {
    encoding: 'utf8',
  });
  assert.match(out, /Signer #1:/, 'expected Signer #1 block in keytool output');
  assert.match(out, /Owner:\s*CN=/, 'expected an Owner CN line');
});

test('bundletool builds a universal APK from the AAB',
  { skip: SKIP }, () => {
  assert.ok(fs.existsSync(AAB_PATH),
    `AAB missing at ${AAB_PATH} — previous test should have built it`);
  assert.ok(fs.existsSync(BUNDLETOOL),
    `bundletool missing at ${BUNDLETOOL} — run scripts/install-bundletool.sh first`);
  const apksOut = path.join(
    REPO, 'android/app/build/outputs/bundle/release/app-release.apks'
  );
  if (fs.existsSync(apksOut)) fs.unlinkSync(apksOut);
  execSync(
    `java -jar "${BUNDLETOOL}" build-apks ` +
      `--bundle="${AAB_PATH}" --output="${apksOut}" ` +
      `--mode=universal --overwrite`,
    { stdio: 'inherit' }
  );
  assert.ok(fs.existsSync(apksOut), 'bundletool did not produce .apks file');
  const sizeOut = execSync(
    `java -jar "${BUNDLETOOL}" get-size total --apks="${apksOut}"`,
    { encoding: 'utf8' }
  );
  assert.match(sizeOut, /\d+/, 'expected numeric size from bundletool');
});
