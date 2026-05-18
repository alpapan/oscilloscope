const { test } = require("node:test");
const assert = require("node:assert/strict");
const { nextCaptureModeBadgeProps } = require("../main.js");

test("badge hidden when state is missing", () => {
  assert.deepEqual(nextCaptureModeBadgeProps(undefined), { hidden: true, text: "", className: "" });
  assert.deepEqual(nextCaptureModeBadgeProps(null), { hidden: true, text: "", className: "" });
});

test("badge hidden when not running, regardless of micMode", () => {
  assert.equal(nextCaptureModeBadgeProps({ running: false, micMode: false }).hidden, true);
  assert.equal(nextCaptureModeBadgeProps({ running: false, micMode: true }).hidden, true);
});

test("badge shows SYSTEM (green) when running and micMode is false", () => {
  const props = nextCaptureModeBadgeProps({ running: true, micMode: false });
  assert.equal(props.hidden, false);
  assert.equal(props.text, "SYSTEM");
  assert.equal(props.className, "badge-system");
});

test("badge shows MIC (amber) when running and micMode is true", () => {
  const props = nextCaptureModeBadgeProps({ running: true, micMode: true });
  assert.equal(props.hidden, false);
  assert.equal(props.text, "MIC");
  assert.equal(props.className, "badge-mic");
});

test("badge text never carries leftover content when transitioning to hidden", () => {
  // Single state object reused across transitions, mimicking the live flow.
  const s = { running: true, micMode: true };
  let props = nextCaptureModeBadgeProps(s);
  assert.equal(props.text, "MIC");
  s.running = false;
  props = nextCaptureModeBadgeProps(s);
  assert.equal(props.hidden, true);
  assert.equal(props.text, "");
});

test("badge flip is purely a function of state.micMode (no DOM dependency)", () => {
  // A truly pure function with no side effects: same input gives same output.
  const inA = { running: true, micMode: false };
  const a1 = nextCaptureModeBadgeProps(inA);
  const a2 = nextCaptureModeBadgeProps(inA);
  assert.deepEqual(a1, a2);
});
