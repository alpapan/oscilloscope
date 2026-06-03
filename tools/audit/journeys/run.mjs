#!/usr/bin/env node
// Journey-driver runner: wires the step interpreter (driver.mjs) to a real
// emulator via CDP (WebView) + adb (native dialogs / screenshots), runs the
// emulator-compatible journeys, and writes screenshots + a pass/fail summary.
//
//   node tools/audit/journeys/run.mjs --serial emulator-5554 --api 34 \
//        --apk android/app/build/outputs/apk/release/scope-0.6.apk
//
// Assumes the emulator is already booted (see bin/emulator-setup.sh) on a host
// where adb can reach it. Each journey resets the app (force-stop + relaunch),
// so the WebView pid - and thus the CDP socket - is re-resolved per journey.
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { JOURNEYS, runJourney } from './driver.mjs';

const exec = promisify(execFile);
const PKG = 'com.alpapan.scope';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SERIAL = arg('serial', 'emulator-5554');
const API = arg('api', 'unknown');
const APK = arg('apk', '');
const PORT = Number(arg('cdp-port', '9222'));
const ADB = process.env.ADB || `${process.env.HOME}/Android/Sdk/platform-tools/adb`;
const OUT = arg('out', `docs/audits/2026-06-audit/emulator-runs/scope-api${API}/journeys`);

const adb = (...a) => exec(ADB, ['-s', SERIAL, ...a], { maxBuffer: 64 * 1024 * 1024 });
const adbShell = (cmd) => adb('shell', cmd);

async function currentFocus() {
  const { stdout } = await adb('shell', 'dumpsys', 'window');
  const m = stdout.match(/mCurrentFocus=Window\{[^}]*\s+([^\s}]+)\}/);
  return m ? m[1] : '';
}

async function serviceForeground(name) {
  const { stdout } = await adb('shell', 'dumpsys', 'activity', 'services', PKG).catch(() => ({ stdout: '' }));
  const re = new RegExp(`${PKG}/${name.replace('.', '\\.')}[\\s\\S]*?isForeground=true`);
  return re.test(stdout);
}

async function resolveCdpPage() {
  const { stdout: pidOut } = await adbShell(`pidof ${PKG}`);
  const pid = pidOut.trim().split(/\s+/)[0];
  if (!pid) throw new Error('scope not running');
  await adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  for (let i = 0; i < 20; i++) {
    try {
      const pages = await (await fetch(`http://localhost:${PORT}/json`)).json();
      const page = pages.find((p) => p.title === 'Scope' && p.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('CDP Scope page did not appear');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); } }); }
  static connect(url) { return new Promise((res, rej) => { const ws = new WebSocket(url); ws.addEventListener('open', () => res(new Cdp(ws))); ws.addEventListener('error', () => rej(new Error('CDP ws error'))); }); }
  send(method, params, timeoutMs = 30000) { const id = ++this.id; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP ${method} timed out`)); }, timeoutMs); this.pending.set(id, (m) => { clearTimeout(t); res(m); }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expr) { const m = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw new Error('JS: ' + (m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text)); return m.result?.result?.value; }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function makeCtx(cdp, journeyId) {
  await mkdir(path.join(OUT, journeyId), { recursive: true });
  return {
    evaluate: (expr) => cdp.evaluate(expr),
    tap: (x, y) => adbShell(`input tap ${x} ${y}`).then(() => {}),
    focus: () => currentFocus(),
    screencap: async (name) => {
      // execFile defaults to utf8 which corrupts PNG bytes; read raw via encoding:'buffer'.
      const { stdout } = await exec(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }).catch(() => ({ stdout: Buffer.alloc(0) }));
      const fp = path.join(OUT, journeyId, `${name}.png`);
      if (stdout.length < 1024) { process.stderr.write(`  ! screencap ${name} tiny (${stdout.length}B), skipped\n`); return; }
      await writeFile(fp, stdout);
    },
    sleep,
    serviceForeground,
    log: (m) => process.stderr.write(`${m}\n`),
  };
}

async function resetApp() {
  await adbShell(`am force-stop ${PKG}`);
  await sleep(1500);
  await adbShell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`).catch(() => {});
  await sleep(5000);
}

async function main() {
  if (APK) { process.stderr.write(`installing ${APK}\n`); await adb('install', '-r', APK); }
  const journeys = JOURNEYS.filter((j) => j.emulator);
  const results = [];
  for (const journey of journeys) {
    process.stderr.write(`\n=== api${API} :: ${journey.id} ===\n`);
    await resetApp();
    let cdp;
    try {
      cdp = await Cdp.connect(await resolveCdpPage());
      const ctx = await makeCtx(cdp, journey.id);
      const res = await runJourney(journey, ctx);
      results.push(res);
      process.stderr.write(`  -> ${res.pass ? 'PASS' : 'FAIL: ' + res.failure}\n`);
    } catch (e) {
      results.push({ id: journey.id, pass: false, failure: e.message });
      process.stderr.write(`  -> ERROR: ${e.message}\n`);
    } finally { cdp?.close(); }
  }
  const passed = results.filter((r) => r.pass).length;
  process.stdout.write(`\napi${API}: ${passed}/${results.length} journeys passed\n`);
  for (const r of results) process.stdout.write(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id}${r.pass ? '' : '  (' + r.failure + ')'}\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { process.stderr.write(`fatal: ${e.stack || e.message}\n`); process.exit(2); });
