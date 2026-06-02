const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.resolve(__dirname, '..');
const MANIFEST = path.join(REPO, 'android/app/src/main/AndroidManifest.xml');

test('allowBackup is disabled', () => {
  assert.match(fs.readFileSync(MANIFEST, 'utf8'), /android:allowBackup="false"/);
});
test('no backup-rules resources referenced', () => {
  const m = fs.readFileSync(MANIFEST, 'utf8');
  assert.doesNotMatch(m, /dataExtractionRules/);
  assert.doesNotMatch(m, /fullBackupContent/);
});
test('no FileProvider declared (unused, over-broad paths removed)', () => {
  const m = fs.readFileSync(MANIFEST, 'utf8');
  assert.doesNotMatch(m, /androidx\.core\.content\.FileProvider/);
  assert.ok(!fs.existsSync(path.join(REPO, 'android/app/src/main/res/xml/file_paths.xml')));
});
