// Public surface of @zablab/solar.

export { mount } from "./mount";
export type {
  MountOptions,
  SolarHandle,
  SolarMode,
  SolarStatus,
  SolarToken,
  SolarTokenProvider,
  SolarError,
  SolarErrorCode,
  SolarSceneRosterEntry,
} from "./types";

// Authored "wipe-cover" overlay element (M10 — Pulsar ADR 003 §A4.2). A
// leaf-driven, in-DOM opaque overlay animation rendered by our engine, NOT
// an OBS-native transition nor the runtime `<Crossfade>`. Canvas/Orion and
// the M10 probe compose a scene with `buildWipeCoverNode(...)`.
export { buildWipeCoverNode, parseWipeCoverOverlay } from "./overlay/wipe-cover";
export type {
  WipeCoverOverlay,
  BuildWipeCoverNodeOptions,
} from "./overlay/wipe-cover";

// Animation Asset overlay element (ADR 011 §3.3 — `core.animation.play@1`
// reconciliation). The Solar oracle twin of Orion's `lower_animation.go`
// `buildAnimationNode`: it frames an authored keyframe block into the
// keyframed `frame` RenderNode keyed on the scalar generation leaf
// `__anim.<overlay_id>`. No new runtime primitive — a bundle-fragment
// builder, like `buildWipeCoverNode`, of which it is the generalisation.
export { buildAnimationNode } from "./overlay/animation";
export type {
  AnimationStep,
  AnimationKeyframes,
  BuildAnimationNodeOptions,
} from "./overlay/animation";

// Atlas render mode (ADR 013 Prism §3.1, issue #38). The `?atlas=` URL param
// parser + the pure band-split transform that wraps a composed scene `root`
// into N stacked, transparent z-bands (1920×1080 each) in a 1920×(1080·N)
// frame — the texture-atlas broadcast layout. A composition of the existing
// `frame` primitive, consumed by the render-bundle serving path; the default
// (atlas-less) render path is untouched.
export { parseAtlasParam } from "./atlas/atlas-param";
export type { AtlasSpec } from "./atlas/atlas-param";
export {
  buildAtlasRoot,
  ATLAS_BAND_HEIGHT,
  ATLAS_STAGE_WIDTH,
} from "./atlas/atlas-node";
export type { BuildAtlasRootOptions } from "./atlas/atlas-node";
