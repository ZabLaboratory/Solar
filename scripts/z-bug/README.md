# Two-arrow vector Z stream bug

Owner: Solar demonstration authoring. This standalone LSML motion uses the
confirmed landing Z, with two complete ribbons extracted from its arrow-shaped
negative spaces. Its consumer is the existing native LSDP/Solar/Vision harness.

## Authoring

`extract.py <source-z.png> <artifact-dir>/assets` traces the source voids and
creates the two independent SVG ribbons, their drawing centerlines and the full
source silhouette. It also authors docked contours that share the source's
central material. Each ribbon keeps one hole; matching path commands preserve
the corners of both endpoints. Source regions are assigned by distance to the
two voids. These docking regions are intermediate geometry, not standalone
replacement logos.

`generate.mjs <artifact-dir>` authors `z-bug.lsml`/`z-bug.lsmlz` and the generic
`sponsor-motion.lsmlz` expected by the harness. It reuses native stroke trim and
affine channels for the drawing: one slight scale overshoot follows each trace,
and both ribbons approach along their diagonal axis. Travel uses one continuous
quintic curve sampled at 120 Hz; it has no intermediate stops or scale collapse.

`contact.py` is called by the generator with explicit vector poses on stdin.
It unions their moving outer contours and subtracts both moving arrow voids.
This prevents one ribbon from painting across the other ribbon's opening during
contact. Small incidental seams are closed. The result is authored SVG path
data in LSML, with 120 Hz held keys during changing contour topology. Duplicate
vertices keep the command budget consistent without smoothing away corners.
No raster frame, runtime Python, mesh correspondence guess or alternate browser
renderer participates in playback. The source master fills the final tracing
tolerance only after the ribbons are aligned, at full size.

Authoring requires Python with OpenCV, NumPy, Pillow and Shapely. Playback uses
four vector shapes: two native trimmed strokes, their combined contact contour,
and the final source trace. The 180×189 mark is anchored at (112,839) in a
transparent 1920×1080 frame. Drawing completes by 335 ms, contact settles by
680 ms, and the source mark remains still until the 2-second sequence ends.

## Render and validation

Build Solar, set `SPONSOR_MOTION_PORT` and `SPONSOR_LSDP_BIN` to an available
local port and verified native binary, then run
`node scripts/sponsor-motion/serve.mjs <artifact-dir>`. Set
`SPONSOR_PLAYWRIGHT_ROOT` to a package with Playwright and run
`node scripts/z-bug/render.mjs <artifact-dir>` to sample the actual Vision
canvas at 60 Hz. Temporary frames stay in `.cache/z-bug/frames` in this worktree.
Encode with VP9 `yuva420p` and `-auto-alt-ref 0` for transparent WebM; the MP4
preview composites the same PNGs over black.

`storyboard.py <frames-dir> <output.png>` shows sixteen native frames, with their
actual sampled times and correct alpha compositing. `validate.py <source.png>
<frames-dir> <artifact-dir> <evidence.json>` checks vector assets, edge safety,
continuous visible area through contact, source-mask fidelity, alpha and video
metadata. `scripts/sponsor-motion/cadence.mjs <report.json>` measures real Vision
frame submissions without screenshot/encoding overhead. The exports and cadence
are separate evidence; neither establishes physical scanout or Prism Program/OBS.
