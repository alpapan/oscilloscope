// Verifies that the Android manifest declares backup-policy resources
// for both modern (Android 12+) and legacy (pre-12) paths, and that
// those resource files exist and are syntactically valid empty
// declarations. The app stores no sensitive data — settings live in
// WebView localStorage — so the rules files intentionally contain no
// exclude paths, just envelope elements signalling "developer reviewed
// backup behaviour; defaults apply".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const MANIFEST = path.join(REPO, 'android/app/src/main/AndroidManifest.xml');
const RULES_NEW = path.join(
  REPO, 'android/app/src/main/res/xml/data_extraction_rules.xml'
);
const RULES_OLD = path.join(
  REPO, 'android/app/src/main/res/xml/backup_rules.xml'
);

test('manifest declares dataExtractionRules (Android 12+)', () => {
  const m = fs.readFileSync(MANIFEST, 'utf8');
  assert.match(m, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
});

test('manifest declares fullBackupContent (pre-12 fallback)', () => {
  const m = fs.readFileSync(MANIFEST, 'utf8');
  assert.match(m, /android:fullBackupContent="@xml\/backup_rules"/);
});

test('data_extraction_rules.xml exists with the expected envelope', () => {
  assert.ok(fs.existsSync(RULES_NEW), `expected ${RULES_NEW}`);
  const c = fs.readFileSync(RULES_NEW, 'utf8');
  assert.match(c, /<data-extraction-rules\b/);
  assert.match(c, /<cloud-backup\s*\/?>/);
  assert.match(c, /<device-transfer\s*\/?>/);
});

test('backup_rules.xml exists with the expected envelope', () => {
  assert.ok(fs.existsSync(RULES_OLD), `expected ${RULES_OLD}`);
  const c = fs.readFileSync(RULES_OLD, 'utf8');
  assert.match(c, /<full-backup-content\s*\/?>/);
});

test('rules files do not enumerate fake exclude paths', () => {
  // The earlier draft of the plan listed device-id.xml, auth.xml, auth.db
  // as excluded paths — files that do not exist in this codebase. The
  // reviewer flagged this as misleading config. These checks ensure no
  // future regression re-adds those fake paths.
  for (const p of [RULES_NEW, RULES_OLD]) {
    if (!fs.existsSync(p)) continue;
    const c = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(c, /device-id\.xml/);
    assert.doesNotMatch(c, /auth\.xml/);
    assert.doesNotMatch(c, /auth\.db/);
  }
});
