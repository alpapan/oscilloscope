// now-playing.js - now-playing metadata helpers. No DOM, no Pixi, no Android.
// `dto` is either null (Kotlin emits null for blank metadata) or an object with
// string title/artist/album and an optional base64 `art`. isBlank accepts both
// null and an all-empty-string object so the renderer never has to care which
// shape arrived (the plugin emits empty-string objects when clearing on stop).
function isBlank(dto) {
  return !dto || (!dto.title && !dto.artist && !dto.album);
}
function isNewTrack(prev, next) {
  if (isBlank(next)) return false;
  if (isBlank(prev)) return true;
  return prev.title !== next.title || prev.artist !== next.artist || prev.album !== next.album;
}
function formatTrackText(dto) {
  if (isBlank(dto)) return { title: "", lines: [] };
  const lines = [];
  if (dto.artist) lines.push(String(dto.artist).trim());
  if (dto.album) lines.push(String(dto.album).trim());
  return { title: String(dto.title || "").trim(), lines };
}
function truncate(s, max) {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

const api = { isBlank, isNewTrack, formatTrackText, truncate };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof globalThis !== "undefined") globalThis.NowPlaying = api;
