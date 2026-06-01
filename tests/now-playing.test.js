const { test } = require("node:test");
const assert = require("node:assert/strict");
const NP = require("../now-playing.js");

test("isBlank: null and all-empty are blank; any field makes it non-blank", () => {
  assert.equal(NP.isBlank(null), true);
  assert.equal(NP.isBlank({ title: "", artist: "", album: "" }), true);
  assert.equal(NP.isBlank({ title: "Song" }), false);
  assert.equal(NP.isBlank({ artist: "Band" }), false);
});

test("isNewTrack: blank next never fires; first non-blank fires; tuple change fires", () => {
  assert.equal(NP.isNewTrack(null, null), false);
  assert.equal(NP.isNewTrack(null, { title: "A", artist: "B", album: "C" }), true);
  const same = { title: "A", artist: "B", album: "C" };
  assert.equal(NP.isNewTrack(same, { title: "A", artist: "B", album: "C" }), false);
  assert.equal(NP.isNewTrack(same, { title: "A2", artist: "B", album: "C" }), true);
  // A bare blank (capture stopped) does not count as a new track.
  assert.equal(NP.isNewTrack(same, { title: "", artist: "", album: "" }), false);
});

test("formatTrackText: title plus non-empty artist/album lines, blanks skipped", () => {
  assert.deepEqual(
    NP.formatTrackText({ title: "Song", artist: "Band", album: "LP" }),
    { title: "Song", lines: ["Band", "LP"] }
  );
  assert.deepEqual(
    NP.formatTrackText({ title: "Song", artist: "", album: "LP" }),
    { title: "Song", lines: ["LP"] }
  );
  assert.deepEqual(NP.formatTrackText(null), { title: "", lines: [] });
});

test("truncate: long strings get an ellipsis, short strings untouched", () => {
  assert.equal(NP.truncate("abcdef", 4), "abc…");
  assert.equal(NP.truncate("abc", 4), "abc");
  assert.equal(NP.truncate(undefined, 4), "");
});
