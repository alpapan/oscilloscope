# projectM-algorithms feature - TODO

Plan: `docs/plans/happy-snacking-cascade.md`
Plan review: `docs/plans/reviews/happy-snacking-cascade.md`

## Implementation

- [x] **audio-features.js + tests** (TDD red→green) - 13 new tests passing (31 total)
- [x] **palette-color.js + tests** (TDD red→green) - 3 new tests passing (34 total)
- [x] **mesh-warp.js + tests** (TDD red→green) - 4 new tests passing (38 total)
- [x] **Wire audio-features into main.js** - analyser setup, frame() update, auto-gain clamp
- [x] **Wire visual effects into draws** - palette table, THICK_OFFSETS, multi-offset stroke, PCM smoothing, dynamic color, mesh transform, BlurFilter
- [x] **Drawer toggles (HTML/JS web)** - both toggles in mobile drawer + desktop controls, handlers wired
- [x] **Android setKeepScreenOn plugin** - @PluginMethod + onDestroy guard + JS wrapper
- [ ] **Docs + build + review + commit**
  - [x] docs/HANDOVER.md known-issues
  - [x] docs/manual-qa.md projectM/screen-wake
  - [x] `npm test` - 38 pass / 0 fail
  - [x] `npm run sync && ./gradlew assembleRelease` - APK 7.3M at 17:13
  - [ ] Dispatch code-reviewer; address every finding
  - [ ] Single feature commit (main agent only)
