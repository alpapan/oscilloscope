// Unit tests for the journey-driver step interpreter. The I/O layer (CDP +
// adb) is injected as `ctx`, so these tests exercise the orchestration logic
// with a fake ctx - no emulator, CDP, or adb involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStep, runJourney, JOURNEYS } from './driver.mjs';

function makeCtx(over = {}) {
  const calls = [];
  return {
    calls,
    evaluate: over.evaluate || (async (expr) => { calls.push(['evaluate', expr]); return true; }),
    tap: over.tap || (async (x, y) => { calls.push(['tap', x, y]); }),
    focus: over.focus || (async () => { calls.push(['focus']); return 'com.alpapan.scope/.MainActivity'; }),
    screencap: over.screencap || (async (n) => { calls.push(['screencap', n]); }),
    sleep: over.sleep || (async (ms) => { calls.push(['sleep', ms]); }),
    serviceForeground: over.serviceForeground || (async (n) => { calls.push(['serviceForeground', n]); return true; }),
    log: () => {},
  };
}

test('eval step calls evaluate and is ok', async () => {
  const ctx = makeCtx();
  const r = await runStep({ eval: 'document.foo()' }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(ctx.calls[0], ['evaluate', 'document.foo()']);
});

test('assert step ok when expression truthy', async () => {
  const ctx = makeCtx({ evaluate: async () => true });
  const r = await runStep({ assert: 'x' }, ctx);
  assert.equal(r.ok, true);
});

test('assert step fails when expression falsy', async () => {
  const ctx = makeCtx({ evaluate: async () => false });
  const r = await runStep({ assert: 'x', desc: 'must be true' }, ctx);
  assert.equal(r.ok, false);
  assert.match(r.detail, /false/);
});

test('assert step with equals compares strictly', async () => {
  const ctx = makeCtx({ evaluate: async () => 'mic' });
  assert.equal((await runStep({ assert: 'm', equals: 'mic' }, ctx)).ok, true);
  assert.equal((await runStep({ assert: 'm', equals: 'system' }, ctx)).ok, false);
});

test('screenshot step calls screencap', async () => {
  const ctx = makeCtx();
  const r = await runStep({ screenshot: 'shot-1' }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(ctx.calls.at(-1), ['screencap', 'shot-1']);
});

test('service step uses serviceForeground', async () => {
  const ok = makeCtx({ serviceForeground: async () => true });
  assert.equal((await runStep({ service: { name: '.AudioCaptureService', foreground: true } }, ok)).ok, true);
  const bad = makeCtx({ serviceForeground: async () => false });
  assert.equal((await runStep({ service: { name: '.AudioCaptureService', foreground: true } }, bad)).ok, false);
});

test('service step covers all four foreground-expectation quadrants', async () => {
  const fg = (v) => makeCtx({ serviceForeground: async () => v });
  assert.equal((await runStep({ service: { name: 'S', foreground: true } }, fg(true))).ok, true);   // want fg, is fg
  assert.equal((await runStep({ service: { name: 'S', foreground: true } }, fg(false))).ok, false);  // want fg, not fg
  assert.equal((await runStep({ service: { name: 'S', foreground: false } }, fg(false))).ok, true);   // want not-fg, not fg
  const r = await runStep({ service: { name: 'S', foreground: false } }, fg(true));                   // want not-fg, is fg
  assert.equal(r.ok, false);
  assert.match(r.detail, /unexpectedly foreground/);
});

test('nativeDialog taps when the expected focus appears, then waits for return', async () => {
  const focuses = ['com.android.systemui', 'com.alpapan.scope/.MainActivity'];
  let i = 0;
  const ctx = makeCtx({ focus: async () => focuses[Math.min(i++, focuses.length - 1)] });
  const r = await runStep({
    nativeDialog: { expectFocus: 'com.android.systemui', tap: [853, 1517], thenFocus: 'com.alpapan.scope' },
  }, ctx);
  assert.equal(r.ok, true);
  assert.ok(ctx.calls.some((c) => c[0] === 'tap' && c[1] === 853 && c[2] === 1517));
});

test('nativeDialog optional skips (ok) when dialog never appears', async () => {
  const ctx = makeCtx({ focus: async () => 'com.alpapan.scope/.MainActivity' });
  const r = await runStep({
    nativeDialog: { expectFocus: 'com.android.systemui', tap: [1, 1], thenFocus: 'com.alpapan.scope', optional: true, appearTimeout: 30 },
  }, ctx);
  assert.equal(r.ok, true);
  assert.ok(!ctx.calls.some((c) => c[0] === 'tap'));
});

test('nativeDialog required fails when dialog never appears', async () => {
  const ctx = makeCtx({ focus: async () => 'com.alpapan.scope/.MainActivity' });
  const r = await runStep({
    nativeDialog: { expectFocus: 'com.android.systemui', tap: [1, 1], thenFocus: 'com.alpapan.scope', appearTimeout: 30 },
  }, ctx);
  assert.equal(r.ok, false);
});

test('runJourney passes when every step is ok', async () => {
  const ctx = makeCtx({ evaluate: async () => true });
  const j = { id: 'j', steps: [{ eval: 'a()' }, { assert: 'b' }, { screenshot: 's' }] };
  const res = await runJourney(j, ctx);
  assert.equal(res.pass, true);
  assert.equal(res.results.length, 3);
});

test('runJourney stops and fails at the first failing step', async () => {
  const ctx = makeCtx({ evaluate: async () => false });
  const j = { id: 'j', steps: [{ assert: 'x' }, { screenshot: 'never' }] };
  const res = await runJourney(j, ctx);
  assert.equal(res.pass, false);
  assert.equal(res.results.length, 1);
  assert.equal(res.failedAt.assert, 'x');
});

test('JOURNEYS defines the three emulator journeys with non-empty steps', () => {
  const ids = JOURNEYS.map((j) => j.id);
  for (const id of ['drawer-capture-toggle', 'start-capture-mic', 'tv-pair-discovery']) {
    assert.ok(ids.includes(id), `missing journey ${id}`);
  }
  for (const j of JOURNEYS) {
    assert.ok(Array.isArray(j.steps) && j.steps.length > 0, `journey ${j.id} has no steps`);
  }
});
