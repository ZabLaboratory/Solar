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

Translation uses retained Vision position bindings. Scale retains the existing
document-variant fallback. The visual proof captures the real Solar canvas and
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
