# Two-arrow vector Z stream bug

Owner: Solar demonstration authoring. The confirmed landing Z is a single red
silhouette with two arrow-shaped black voids. A hard split through its red area
damages those arrows; no partitioned path or pixel-cut asset is used here.

`extract.py <source-z.png> <artifact-dir>/assets` traces the two real void
contours and creates a closed mitered red ribbon around each one. Those are two
complete independently transformable SVG arrows. It also traces the full source
silhouette as `z-assembled.svg`. The arrow extraction uses OpenCV, Pillow,
NumPy and Shapely at authoring time; playback uses only vector `pathData`.

The source fuses both arrows in its central red region, so two disjoint pieces
cannot reproduce every source pixel without an artificial seam. The LSML
motion therefore keeps the complete arrows separate through their approach,
collapses them into the source-derived complete mark at impact, then bounces
that mark. The final source contour is never constructed from an image node or
an in-motion raster swap. The three Solar/Vision nodes are all vector paths.

`generate.mjs <artifact-dir>` authors `z-bug.lsml`/`z-bug.lsmlz` plus the
generic `sponsor-motion.lsmlz` expected by the native reader. It positions a
180×189 mark at (112,839) in a transparent 1920×1080 stream scene. Motion
lasts about 1.9 seconds with the full mark held through 3.6 seconds.

Build Solar, set `SPONSOR_MOTION_PORT` and `SPONSOR_LSDP_BIN` to an available
local port and verified native binary, then run
`node scripts/sponsor-motion/serve.mjs <artifact-dir>`. Set
`SPONSOR_PLAYWRIGHT_ROOT` to a package with Playwright and run
`node scripts/z-bug/render.mjs <artifact-dir>` to sample the actual Vision
canvas at 60 Hz. Temporary frames stay in `.cache/z-bug/frames` in this
worktree. Encode them with VP9 `yuva420p` and `-auto-alt-ref 0` for transparent
WebM; the MP4 preview places them over black. This proof does not establish
behavior in Prism Program or OBS.
