const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pairOverlayLines } = require("../main.js");

test("pair code with ip renders code line plus address line", () => {
  assert.deepEqual(
    pairOverlayLines({ text: "123456", ip: "192.168.0.6", port: 8765 }),
    { main: "Pair code: 123456", sub: "192.168.0.6:8765" }
  );
});

test("non-code message keeps the address line visible", () => {
  assert.deepEqual(
    pairOverlayLines({ text: "Waiting for phone...", ip: "192.168.0.6", port: 8765 }),
    { main: "Waiting for phone...", sub: "192.168.0.6:8765" }
  );
});

test("missing ip yields empty address line", () => {
  assert.deepEqual(
    pairOverlayLines({ text: "123456", ip: null, port: 8765 }),
    { main: "Pair code: 123456", sub: "" }
  );
});
