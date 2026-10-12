# Vector Z stream bug

Owner: Solar demonstration authoring. This local proof animates the confirmed
red Z from the landing asset as two connected vector regions in a transparent
1920×1080 scene. It reuses the existing sponsor-motion native LSDP reader and
Solar/Vision motion tracks. It does not wire a real Prism scene or Program output.

`segment.py <source-z.png> <artifact-dir>/assets` partitions the original pixels
along one diagonal seam. Both parts are connected and their PNG union is pixel
identical to the supplied cutout. It also traces each binary contour to SVG and
emits scaled fill and arrow-gesture `pathData` in `vectors.json`. The gestures
follow the two opposed source arrowheads; each is drawn with native trim before
its corresponding filled region materializes. The transparent PNGs are comparison
references; the running scene uses no image nodes or raster assets.

`generate.mjs <artifact-dir>` reads those paths and authors a pure-vector
LSML/LSMLZ fixture. Four shape nodes form two independent arrow pairs (one
guide stroke and one source-derived fill each). The arrows arrive from opposed
directions, draw, fill, rebound, reunite by 2.1 seconds and hold through 4.2
seconds. The assembled
180×189 mark starts at (112,839), inside the lower-left stream-safe area.
The generic native reader expects `sponsor-motion.lsmlz` and `catalogue.json`;
`z-bug.lsmlz` is the same downloadable scene under a descriptive name.

Build Solar, set `SPONSOR_MOTION_PORT` and `SPONSOR_LSDP_BIN` to an available
local port and verified native binary, then run
`node scripts/sponsor-motion/serve.mjs <artifact-dir>`. The reader exposes native
play/pause/seek controls. Set `SPONSOR_PLAYWRIGHT_ROOT` to a package with
Playwright and run `render.mjs <artifact-dir>` to sample the actual Vision canvas
at 60 Hz. Its temporary PNG frames stay in this worktree's `.cache/z-bug/frames`;
the final alpha PNG and render report go to the artifact directory. Encode the
PNG sequence with VP9 `yuva420p` and `-auto-alt-ref 0` for a transparent WebM.

The settled native canvas is compared to the supplied crop at the delivered
size. Its binary silhouette IoU is 0.958; color is a single sampled brand pink
instead of the landing image's pixel-level variation. The original source is
preserved and the two SVG paths remain editable. Recheck the source crop and
seam if the brand master asset changes.
