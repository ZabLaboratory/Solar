# Video-derived vector motion checkpoint

Owner: Eleven, direct continuation requested by the user.
Thread: 01a124c8-8595-7f01-92fd-bf0d24ba8bd1.
Worktree: D:/Documents/Zab/Solar/.worktrees/eleven-local-20261010-sponsor-motion
Branch: eleven/local-20261010-sponsor-motion
Base at this increment: 4db02dcb5158075234264ce2a567a7528166814c
Vision source: 14658e3738399fd95b1498569de369a190988b17, locally signed candidate.

## Delivered

A 7000ms 1280x720 LSML vector reconstruction: square/chat rows, six line-to-arc
and brin morph tracks, arc-length stroke reveal, silhouette handoff, shrinking/
rotating emblem, fragmented vector glyph bands and the final wordmark pose.
SVGs rebuilt from ffmpeg-extracted source contours; no supplied logo/font asset.
The LSMLZ contains only scene.lsml. No raster image, video frames or JS renderer.
37 animated targets (including a final-pose vector); Vision remains the renderer.

Reusable motion channels: matching absolute M/L/C/Q/Z pathData keys, 4096
coordinates / 1024 commands / 32768 chars per key, 2MiB path-key catalogue budget;
trimStart/End in 0..1; exact retained binding and authored baseline restoration.
Unsupported path syntax, topology mismatch and wrong target geometry reject
admission. Source remains authoritative. Docs, owner README and derived index
updated together. Reader aspect now follows catalogue dimensions.

## Actual validation

Solar: lint, typecheck, 257 unit tests / 35 files, 5 architecture-tool tests,
source reachability 50/50, code-map check, docs, size guard, complete build,
host/runtime layout and four Vision artifact pins, git diff --check passed.
Vision: 97 selected native compatibility/rollback/pixel tests, fmt, clippy and
release WASM build passed. Native checkpoint is owned by Vision.

Final actual canvas capture: 20261010T105949Z-capture.json
- 400 submitted frames, 57.074/s during encoded recording;
- one scene load throughout playback/replay, no runtime/console errors;
- final replay pixels identical; comparison stored beside capture;
- approximately 0.925 binary final-silhouette IoU against the reference crop
  (0.903 emblem / 0.936 letters), an endpoint diagnostic, not temporal fidelity.

Playback-only measurement: 20261010T110018Z-vector-cadence.json
- 413 frames in 6984.9ms, 58.984/s;
- p95 interval 20.2ms, maximum 49.6ms, no runtime errors;
- no per-frame readback/encoder, Vision frame-submitted boundary, not scanout.

Controls: 20261010T110011Z-controls.json
- pause freezes actual pixels; seek updates pixels while paused; resume/speed;
- reverse; exact rewind; second alternate iteration; cancel restores source;
- full-pixel fingerprint and initial/restored PNG, one scene load.
Storyboard at 13 positions: 20261010T105333Z-storyboard.json; it predates the
final small-symbol contour refinement but documents the same timing/morph tracks.
Earlier captures are retained as development evidence, not substituted for final.

## Interpretation and retained scope

The first contour reader sought the source imprecisely; timestamped ffmpeg
extraction replaced it. Symmetry averaging distorted the symbol and was removed.
The mouse cursor's small islands/holes are excluded; contours are reconstructed,
not official vector master artwork. The first recording fingerprint loop/VP9
encoder reduced cadence; VP8 and 100ms fingerprint sampling separate proof of
changed pixels from the independent playback-only cadence measurement.

Timing, correspondence and intermediate poses are manually authored from the
reference. Two brief silhouette handoffs preserve the observed final poses;
this is not automatic arbitrary video inference or topology correspondence.
The demo runs native LSDP locally; no Blue program, Pulsar Program, CI, deployment
or merge is claimed. Changes are local signed continuation commits; both owned
worktrees and live reader remain active. Other worktrees/sessions are preserved.

User export: D:/Documents/Zab/Artifacts/2026-10-10/openai-motion/
Reader: http://127.0.0.1:4580/
