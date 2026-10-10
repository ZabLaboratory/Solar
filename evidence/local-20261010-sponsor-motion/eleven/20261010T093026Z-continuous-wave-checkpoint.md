# Continuous wave — correction after visual rejection

Mandate: fix the pixelated/staircase contours and poor fluidity of the prior wave.
Worktree: D:/Documents/Zab/Solar/.worktrees/eleven-local-20261010-sponsor-motion.
Branch: eleven/local-20261010-sponsor-motion. Continuation base:
ae098daef390e5c75179fb907ce437ed3777f5b4. Original base: 421495ae759e7f69728507d557030eef640b66a3.
Owner: Solar. Vision extension is owned in its separate continuous-motion worktree.

## Result

Replaced 48 cropped rows/98 tracks with two whole images and two tracks. The
experimental waveAmplitude/Phase/Wavelength/Harmonic animation channels project
private retained x-vision.wave* scalar bindings. Vision builds a continuous
textured triangle mesh, reusing the original image texture and standard shader.
The wave/second harmonic and sponsor slide take 4200ms; zero amplitude preserves
original-image endpoints without opacity bookends or crop rounding.
One native command transaction uses one start timestamp across all targets.
Source image bytes, published-source authority and ordinary bindings stay intact.

Pinned engine source commit: 5fea52150dfd65da0d3f4c2e994296219670a87f in
D:/Documents/Lumencast/lumencast-vision/.worktrees/eleven-local-20261010-continuous-motion.
Its checkpoint: evidence/local-20261010-continuous-motion/eleven/20261010T093026Z-checkpoint.md.
Namespaced wave is a local whole-image GPU capability, not a standardized LSML
deformation, arbitrary shader API or universal animation engine. No real Blue
execution or Prism/Pulsar Program output was qualified here.

## Actual capture and cadence

Final prefix: 20261010T092923Z. Real Solar front canvas 720x720. One init/preload/load,
253 patches, 376 sampled canvas frames and 254 distinct coarse signatures.
253 frame-submitted timestamps cover 4193.6ms: 60.09 frames/s, median interval
16.6ms, p95 18.6ms, maximum 29.3ms. Load/idle margins are excluded. This is local
Vision submission and actual canvas evidence, not physical scanout or guaranteed
cadence in all hosts/scenes. The final fixture gate requires >=50 submissions/s.
Zero page/console errors; replay adds no load. Endpoint comparison: max 1/255 RGB
channel difference to the original images, with identical replay endpoint.
Earlier continuous capture 20261010T092238Z corroborates the same result; the prior
48-row capture produced only 62 patches and visibly stepped contours.

Video/GIF are encoded from this actual capture with no generated/interpolated
motion frames. MP4 verified 720x720, duration 4.973s; static margins and MediaRecorder
encoding cadence are separate from the measured renderer cadence. GIF is 480x480
at nominal 30fps. Artifacts/2026-10-10/sponsor-wave holds files named
sponsor-wave-continuous.{mp4,gif,lsml,lsmlz}; earlier exports remain historical.

## Validation and handoff

Full Solar suite: 234 tests passed across 33 files. Typecheck, host/server builds,
Vision asset pins, derived code map, architecture/source usage/docs/file-size
checks, script syntax and git diff --check passed.
Vision: 72 selected tests passed across adapter/retained graph/scene binding,
diagnostic CPU rejection and actual GPU pixels; clippy/fmt/WASM build passed.
Reader http://127.0.0.1:4560/?v=continuous remains active for review with its owned
4561 native host. Original 4550 reader and other worktrees/processes were preserved.
Code remains local: no push, PR, merge, shared-dev integration or deployment.
Both assigned worktrees remain unintegrated and retained for review/continuation.
