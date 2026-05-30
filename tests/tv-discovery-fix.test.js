const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const MANIFEST = "android/app/src/main/AndroidManifest.xml";
const DISCOVERY = "android/app/src/main/java/com/alpapan/scope/tv/TvDiscovery.kt";

test("manifest declares the multicast permission NSD needs to receive mDNS", () => {
  const m = read(MANIFEST);
  assert.match(m, /android\.permission\.CHANGE_WIFI_MULTICAST_STATE/);
});

test("discovery acquires and releases a multicast lock", () => {
  const k = read(DISCOVERY);
  assert.match(k, /createMulticastLock/);
  assert.match(k, /acquire\(\)/);
  assert.match(k, /release\(\)/);
});

test("every NSD failure callback logs instead of swallowing silently", () => {
  const k = read(DISCOVERY);
  // The whole point: a real failure must leave a trace in logcat.
  for (const cb of [
    "onStartDiscoveryFailed",
    "onStopDiscoveryFailed",
    "onResolveFailed",
    "onRegistrationFailed",
  ]) {
    const m = k.match(new RegExp(cb + "\\([^)]*\\)\\s*{([^}]*)}"));
    assert.ok(m, `${cb} not found`);
    assert.match(m[1], /Log\./, `${cb} body must log, not be empty`);
  }
});

test("onServiceFound logs that it fired (proves browse received the advert)", () => {
  const k = read(DISCOVERY);
  const m = k.match(/onServiceFound\([^)]*\)\s*{([\s\S]*?)nsd\.resolveService/);
  assert.ok(m, "onServiceFound not found");
  assert.match(m[1], /Log\./, "onServiceFound must log when a service is seen");
});
