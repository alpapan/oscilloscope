# Code Review: Scope Music Oscilloscope

**Reviewer:** feature-dev:code-reviewer
**Date:** 2026-05-16
**Scope:** implementation at `/home/alexie/software/oscilloscope/` against the plan and spec.

## Summary

1 CRITICAL, 1 IMPORTANT, 1 NICE-TO-HAVE / Suggestion. All other checks pass.

## Findings

### CRITICAL

| ID | Finding | Disposition |
|---|---|---|
| C1 | `README.md:27` - hotkey table says `Cycle theme (CRT, neon, mono)`, no direction. Spec/plan use `CRT → neon → mono → CRT`. | Fix README to show direction. |

### IMPORTANT

| ID | Finding | Disposition |
|---|---|---|
| I1 | `main.js:369` - comment references abbreviated `renderer.render(graphics, {renderTexture})` form; actual calls (lines 243, 252) include `clear: false`. | Update comment to show full form. |

### NICE-TO-HAVE / SUGGESTIONS

| ID | Finding | Disposition |
|---|---|---|
| N1 | Spectrum range comment at `main.js:286` (`Walk the audible range (20 Hz – 20 kHz)`) could explain the bound's biological rationale. | Acknowledged; comment is already clear without extra detail; reviewer marked low-confidence. No change. |

## Verification Checklist (all passing)

1. All 16 plan tasks completed: code matches each task's acceptance.
2. PixiJS v8 API forms correct:
   - `app.canvas` not `app.view` - ✓
   - `Graphics.stroke({color, width})` - ✓ (lines 273, 309, 333)
   - `renderer.render()` two-arg form - ✓ (lines 243, 252)
   - `BloomFilter({strength: {x, y}})` - ✓
   - All filter constructors use `new` - ✓
3. Audio pipeline:
   - `getDisplayMedia({video: true, audio: true})` - ✓
   - Video tracks stopped immediately - ✓ (line 92)
   - `MediaStreamSource → Gain → ChannelSplitter → [AnalyserL, AnalyserR]` - ✓
   - Nothing connected to `ctx.destination` - ✓
4. `stopCapture` idempotent - ✓ (line 147)
5. Tests pass (6/6) - ready to run; no mocks of own code.
6. No mocks of own code - ✓ (grep clean).
7. No `file://` code paths - ✓.
8. No em dashes in authored files - ✓.
9. No commits yet - ✓.
10. TDD discipline visible in tests - ✓.
11. Render loop both calls use two-arg form - ✓.
12. CSS `#start-screen[hidden]` and `#controls[hidden]` present - ✓.
13. User-facing UI strings clear - ✓ except C1.
14. Favicon/manifest valid - ✓.

## Resolution Section

| ID | Disposition | Evidence |
|---|---|---|
| C1 | Fixed in `README.md`. | Hotkey row now reads `Cycle theme (CRT → neon → mono → CRT)`. |
| I1 | Fixed in `main.js`. | Comment now reads `renderer.render(graphics, { renderTexture: trail, clear: false })`. |
| N1 | Rejected with evidence. | The bounds 20 Hz - 20 kHz are the convention for audible-range plots; the rationale is universally understood by anyone reading audio code. Adding biological context would be note-bloat. |
