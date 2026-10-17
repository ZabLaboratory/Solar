# AGENT_CHECKPOINT — Vision receipt projection

- Work unit: `local-20261017-vision-graph-projection`
- Role: `eleven`
- Repository: `D:\Documents\Zab\Solar`
- Worktree: `D:\Documents\Zab\Solar\.worktrees\eleven-local-20261017-vision-graph-projection`
- Branch: `eleven/local-20261017-vision-graph-projection`
- Base before commit: `47ed312a3c0883d0b9af90b94cb7267d53e9b4de`
- Scope: native Solar composition projection is produced only from the exact `VisionSceneHandle.compositionFrame` accepted for the current submitted frame. Canonical private LSML is no longer rewritten into atlas pages or used to reproject composition geometry.

## Changes

- `NativeSceneFrames.prepare` passes the original private package with a fixed viewport and native GPU mode, flushes the submitted scene, then projects its accepted receipt and actual canvas/atlas dimensions.
- Scalar patch submission publishes the same scene lifetime's latest accepted receipt and exact native LSDP state hash; geometry patches no longer force scene reconstruction or LSML-based projection.
- Projection retains full global capture affine, own opacity, effective visibility, exact global band/atlas rectangles, unique occurrence IDs, and the separate base `sourceComponentId`. Owner groups keep identity transforms and viewport bounds.
- Capture `sourceFraming` carries raw nullable values plus required positive upload `sourceSize` and nullable-axis `authoredSize`; Solar validates missing/invalid sizes instead of looking them up or fabricating fallback values.
- Root, descendant, and capture clip facts remain explicit. Only the classified root viewport clip and capture image-bounds clip are accepted; unsupported masks, authored clips, non-root clips and non-normal blends fail visibly.
- Removed the obsolete LSML geometry projection module and its rebuild-binding path. Updated ownership docs and generated code map.

## Validation

- `npm test`: 48 files, 443 tests passed.
- Focused composition/receipt/runtime/document tests: 6 files, 106 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run check:architecture`: passed; source usage 70/70, current code map, documentation checks 31 documents/195 local links, file-size guard.
- `npm run test:architecture`: 10/10 passed.
- `git diff --check`: passed.
- Prettier run on all changed TypeScript, tests and Markdown: passed/unchanged.

## Integration limits

- Tests use an explicit receipt fixture; the pinned real Vision/WASM producer was not re-pinned or exercised in this work unit. It must emit the newly required `clipKind`, `authoredSize`, and positive `sourceSize` facts before actual camera integration can publish a plan. Current camera/receipt/Main/Pulsar end-to-end pixels are not established here.
- Solar never reconstructs Repeat/Instance occurrences from LSML: only actual occurrence captures supplied by the submitted Vision receipt are projected. External Main must consume unique `componentId` and `sourceComponentId` with the agreed source-framing scaling.
- Pulsar's consumer behavior remains separately qualified. This projection does not clamp/resize receipt framing values.
- Unsupported masks, authored/non-root clips and non-normal blends remain open capability gaps and are rejected visibly; no flattening or effect stripping is performed.
- No build, push, merge, or real camera/CEF qualification was run.
