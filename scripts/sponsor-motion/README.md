# Sponsor motion demonstration

Local LSML fixture using the two supplied sponsor images, 12 clipping slots and
35 concurrent animation tracks. `generate.mjs` writes explicit LSML/LSMLZ outputs;
the original PNGs remain unchanged in `fixtures/sponsor-motion`.

Run `node scripts/sponsor-motion/generate.mjs <output-directory>` then serve the
archive with `scripts/native-lsdp-local.mjs`. Commands are submitted as one native
LSDP transaction containing `/defaults/__animation.<id>` entries. Solar owns the
clock, interpolation and Vision rendering. No image positions are animated by CSS.
This local fixture does not execute a real Blue program or qualify Program output.

Build the host/server first (`npm run build:host`, `node scripts/build-host-html.mjs`,
`npm run build:server`). Set `SPONSOR_LSDP_BIN` to the verified native executable
if it is not packaged locally, then run `node scripts/sponsor-motion/serve.mjs`.
The reader stays on `http://127.0.0.1:4550`; `SPONSOR_MOTION_PORT` overrides it.
Capture requires Playwright/Chrome. `SPONSOR_PLAYWRIGHT_ROOT` selects the package
directory providing Playwright; run `node scripts/sponsor-motion/capture.mjs`.
`compare.py <capture-stamp> <explicit-output.json>` compares captured endpoints
to the supplied PNGs using Pillow/NumPy and verifies identical replay output.

Translation and scale use retained Vision bindings. The visual proof captures the real Solar canvas and
records load/patch counts, endpoints, replay, console errors and source hashes.

## Traveling wave

`node scripts/sponsor-motion/generate.mjs fixtures/sponsor-motion/wave wave`
creates the alternative scene using `wave.mjs`. Then set `SPONSOR_MOTION_PORT=4560`
and run `node scripts/sponsor-motion/serve.mjs fixtures/sponsor-motion/wave`.
The same capture script reads the duration/catalogue from this reader.

The current wave uses two whole images and two simultaneous tracks over 4200ms.
127 keys sample translation, amplitude and phase; Vision creates continuous
textured triangle meshes with shared vertices and UVs. A sine plus its second
harmonic bends the logos during the slide, settling to zero amplitude at rest.
Solar binds the experimental `wave*` animation channels to `x-vision.wave*`
properties supported by the pinned local Vision candidate. The original PNGs
remain unchanged, without row crops, generated video frames or CSS motion.

The previous 48-row approximation produced staircase contours and only 62
patches in its capture. It was replaced following visual rejection. The new
capture records `frame-submitted` timestamps and checks submitted cadence in
addition to canvas signatures, exact endpoints and retained-scene replay.
Recorded cadence qualifies this local browser run, not physical scanout or all
scenes. The extension is whole-image GPU deformation, not a standardized LSML
mesh/shader API, physics simulation, arbitrary path morph or live Blue execution.
Review it when a shared deformation/catalogue contract becomes available.

## Composed motion studio

`composed.mjs` authors a five-second sequence with three acts, nested parallel
tracks, cubic travel, spring settling, colors, strokes, shadow effects and continuous
whole-image deformation. `controls.mjs` checks real canvas pause, seek, resume,
speed, reverse, second alternate iteration, stop and cancel through native LSDP.
It asserts that controls never load another scene. The player controls edit command
leaves; they do not animate the iframe or draw a substitute canvas.

Generate with `node scripts/sponsor-motion/generate.mjs fixtures/sponsor-motion/composed composed`.
Set `SPONSOR_MOTION_PORT=4570` and serve with
`node scripts/sponsor-motion/serve.mjs fixtures/sponsor-motion/composed`.
Use `capture.mjs` for the recording and `controls.mjs` for interaction proof.
A native host retains command leaves between readers: a reader joining after a
play starts that command again. Use an initially clean native fixture for a
before/after recording; a current replay is not an untouched before image.
This demo does not supply cross-host playhead synchronization or execute Blue.

## Video-derived vector motion

`reconstruct.py <recording.mp4> <explicit-output-directory>` extracts timestamped
frames with ffmpeg and traces cubic SVG symbol/glyph contours with OpenCV/NumPy.
The supplied recording's cursor islands are excluded. These are reconstructed
contours, not official brand master assets or an automatic animation inference tool.
`openai.mjs` authors matching intermediate Bézier poses, arc-length reveals and
clipped glyph bands. `generate.mjs fixtures/sponsor-motion/openai openai` writes
a seven-second, 1280x720 pure-vector LSML/LSMLZ scene (no images/video/fonts).
The measured source frames and manual correspondence/timing are recorded in
`fixtures/sponsor-motion/openai/vectors.json`. Short silhouette handoffs connect
the animated strokes to the traced large emblem, then its final wordmark pose;
these are not arbitrary topology morphs.

Serve that fixture on `SPONSOR_MOTION_PORT=4580`. `storyboard.mjs <evidence-directory>`
seeks thirteen positions through native commands and captures actual Solar pixels.
`cadence.mjs <explicit-evidence.json>` measures frame-submitted timestamps without
per-frame pixel readback or a video encoder. `capture.mjs` records the real canvas
and checks retained replay, distinct pixels and errors. Its recording instrumentation
can reduce cadence; both boundaries are reported rather than treated as equivalent.
