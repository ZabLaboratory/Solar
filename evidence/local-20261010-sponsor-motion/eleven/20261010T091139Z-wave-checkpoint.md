# Traveling wave — local continuation

Mandate: try a more complex undulating sponsor transition with LSML and actual
Solar/Vision output; fixes are authorized. Owner: Solar; no external writes.
Worktree: D:/Documents/Zab/Solar/.worktrees/eleven-local-20261010-sponsor-motion.
Branch: eleven/local-20261010-sponsor-motion. Continuation base:
30c80ed2cac85c88406dc69a618bd6a6343c7e90. Original base: 421495ae759e7f69728507d557030eef640b66a3.
Other worktrees and native hosts were preserved.

## Behavior and reuse

No engine binary/runtime change. Reuses existing catalogue interpolation,
retained translation/opacity bindings and Vision image srcRect. The new fixture
uses 48 image rows (15px high), 96 displacement tracks and two opacity bookends.
65 sampled keys encode a traveling sine plus its harmonic over 4200ms, with a
staggered sponsor slide. Original PNGs remain unchanged and embedded in LSMLZ.
Whole-image bookends preserve exact endpoints despite integer crop rounding.
The same generator, native reader, controller and real-canvas capture are reused.
The reader now accepts a fixture directory and publishes its timing catalogue.

This is a piecewise wave approximation, not a continuous mesh deformation or
custom shader channel. Animation channels still exclude arbitrary deformations,
physics and path morphing. No Blue program or Prism/Pulsar Program output was run.
Solar JavaScript interpolates the timeline; Rust/WASM Vision renders its patches.

## Measured result

Final evidence prefix: 20261010T090951Z. Capture is the actual 720x720 Solar front
canvas, recorded to WebM. 199 sampled display frames, 62 coarse distinct image
signatures, 62 patch requests, one load/init/font preload. Replay added no load.
Zero page/console errors. Endpoint comparison: every RGB channel differs from
the resized original by at most 1/255; replay-after equals after byte-for-byte.
These counts are not a frame-rate guarantee; visible strip steps and limited
fluidity remain. The 90-row clipped prototype produced only 24 distinct samples;
90 srcRect rows produced 23. Both failed the >=40 diversity gate. Reducing to
48 rows/65 samples passed that same gate. Provisional media were removed after
this final capture; their aggregate failure evidence is retained here.

## Validation and delivery

9 animation unit tests passed; code:check (46 files), check:docs (zero failures),
file-size guard (200 files, 2 reviewed exceptions), script syntax and diff checks passed.
Host/server rebuilt successfully with all four Vision asset pins verified.
The existing 232-test baseline was not re-run for this fixture/tooling increment.
MP4 verified 720x720, duration 5.329s; GIF 480x480. Both derive from this actual
capture, without synthesized motion frames. Source/LSMLZ and media are delivered
under D:/Documents/Zab/Artifacts/2026-10-10/sponsor-wave.

Reader http://127.0.0.1:4560 remains active for user review (owned serve process;
its child host is 4561). Original 4550 reader remains active separately.
No push/merge/shared-dev integration. Worktree stays active for review/continuation.
Stop only the corresponding owned serve session with Ctrl+C to stop its child.
