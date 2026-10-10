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

The wave uses 48 horizontal image crops, 98 simultaneous tracks and 65 sampled
keyframes per displacement track over 4200ms. A traveling sine plus its harmonic
bends the logo while a staggered slide changes the sponsor. Whole-image opacity
bookends preserve exact endpoints despite source-crop integer rounding.
`srcRect` reuses Vision's existing image crop primitive and the unchanged PNGs;
there are no generated video frames, CSS motion or alternative renderer.

This is a piecewise approximation at 15px row spacing. It demonstrates coordinated
motion using supported channels, not a continuous mesh warp, procedural shader,
physics simulation, arbitrary path morph, live Blue execution or a frame-rate guarantee.
The initial 90-row prototype failed the rendered-frame diversity check and was
reduced after real Solar capture. Review this development fixture when native
deformation primitives or the shared animation catalogue become available.
