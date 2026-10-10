# Reference motion correction checkpoint

Owner Eleven, direct continuation. Thread 01a124c8-8595-7f01-92fd-bf0d24ba8bd1.
Solar worktree: D:\Documents\Zab\Solar\.worktrees\eleven-local-20261010-sponsor-motion; branch eleven/local-20261010-sponsor-motion.
Base b75bd2fe4b45dc07ff0f157db8b03403b9ebae7a. Vision remains locally signed
14658e3738399fd95b1498569de369a190988b17; no Vision changes at this increment.

The first interpretation was explicitly rejected by the user for missing bounces
and incorrect logo motion. Its visual acceptance is withdrawn, including the
old export manifest. Native runtime diagnostics remain historical diagnostics.

## Current reconstruction candidate

Source recording SHA256 ab5a1d0e0dceb84ccaff1c7ba8e33373db256993ca57c528f787bbea8ff8d0cb.
232 measured 30Hz vector poses, 7733.333ms, 1280x720, 48 contour
tracks and 3956278 path characters. No source raster, video,
fonts or alternate renderer in the LSMLZ; only scene.lsml. Cursor/video controls
are removed/excluded explicitly. Stable contours interpolate, while topology
birth/merge windows (frames90..112,134..177) retain dense held 30Hz poses.
This is vector rotoscoping of one reference, not procedural semantic rig recovery.

An actual live capture exposed a filled-blob artefact between correctly matched
endpoints. Held topology windows replace that invalid inferred interpolation.
Final actual Vision captures cover all232 source timestamps and14 half-frame
positions in those windows. [] reader errors. No spatial/time
warping. Binary silhouette means ~0.972..0.975; minimum half-frame IoU
0.956100. These are diagnostic metrics,
not pixel-exactness or human acceptance. Small polygon/antialiasing and cursor
occlusion differences remain; inpainted pixels are excluded from fidelity claims.

Final comparison: 20261010T114000Z-reference-comparison.json/png/mp4.
The comparison video encodes actual seeked native pixels at source30Hz. It is
an offline timeline comparison, NOT a real-time capture or scanout proof.
Actual real-time capture: 20261010T114140Z-capture.json; 20261010T114140Z-openai-reference.webm.
Raw encoded capture cadence: 52.904/s; maximum interval
1063.700ms, including an initial command/recording gap.
Independent playback cadence: 20261010T114212Z-reference-cadence.json, 60.034/s,
p95 21.000ms, maximum 26.600ms. Not physical scanout.
Controls: 20261010T114203Z-controls.json; all7 actual pixel controls pass, one scene load.
Final encoded capture also keeps one load, no runtime/console errors, source
restoration and replay evidence. Earlier developmental captures are retained.

## Runtime fixes and validation

Catalogue bound grows from2MiB to4MiB for the observed reference, retaining
per-key geometry/command/keyframe limits. Normalized seek hold boundaries tolerate
floating-point roundoff. One exact-content accepted compilation is reused across
cloned native snapshots; changed definitions invalidate it, no scene/playhead cache.
Proof controls/seek wait for matching solar:lsdp-applied presentation receipts.
Acquisition first cancels retained demo commands. An intermediate partial build
removed old host/server paths and caused404/timeouts; the full final build and
fresh assigned native server supersede those failed captures, without touching
unrelated sessions or worktrees.

260 unit tests /35 files, 5 architecture-tool tests, lint, typecheck,
source/discovery/docs/file-size gates, complete library/host/server build,
host/bundle layout and four Vision artifact pins pass. git diff --check passed.
Final source, owner READMEs, fixture retention note and derived map stay aligned.

## Handoff

User export: D:\Documents\Zab\Artifacts\2026-10-10\openai-reference-motion
Live assigned reader: http://127.0.0.1:4590/
Acceptance remains pending; no claim of exact reproduction or a complete semantic
After Effects-style engine. No push, merge, CI/deployment or Blue Program proof.
Owned continuation worktrees remain active. Prior unrelated sessions preserved.
