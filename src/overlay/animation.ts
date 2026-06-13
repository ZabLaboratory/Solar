// Animation Asset overlay element — the Solar oracle twin of Orion's
// `lower_animation.go` `buildAnimationNode` (ADR 011 §3.3 / I2).
//
// `core.animation.play@1` is reconciled by lowering, at compile time, onto
// the proven Path-A KeyframePlayer mechanism (ADR 011 §3 / D1): an authored
// **Animation Asset** (`{target, keyframes{key?, duration_ms, easing,
// steps[]}}`) is resolved by the Orion compiler into a keyframe `RenderNode`
// keyed on the SCALAR generation leaf `__anim.<overlay_id>` (§3.2). Solar's
// `KeyframePlayer` remounts and replays the authored geometry on every delta
// of that leaf — the same M9 reactive path `wipe-cover` already proves. NO
// new Solar runtime primitive is added (ADR 011 §6 criterion #6 / D1): this
// is a *bundle-fragment builder*, exactly like `buildWipeCoverNode`.
//
// THE PARITY ORACLE (ADR 011 §3.3 / D6). This builder is the TS half of the
// Go↔TS parity twin; the Go half (`lower_animation.go` `buildAnimationNode`)
// must emit a byte-shape-identical node for the same inputs. The keyframe
// geometry therefore has ONE source of truth — Orion's lowering is pinned to
// this shape by the parity test (Orion `TestLowerWipeCover_ParityWith…`,
// extended for the general animation node). `wipe-cover` is the degenerate
// case: `buildWipeCoverNode` is the reveal/hold/retract specialisation of
// this general builder (§3.5 / I4).
//
// AUTHORING MODEL. Solar holds no render tree of its own; authored content
// is `RenderBundle` fragments. The `target` element id and the geometry are
// the asset's concern (resolved by the compiler, §3.4); the `key` (the
// replay-trigger leaf) is bound by the compiler to `__anim.<overlay_id>`
// (§3.2/§3.3). Only `opacity` / `transform` / `filter` animate — the Solar
// GPU-only-animation constraint (CLAUDE.md).

import type { RenderNode } from "@lumencast/runtime";

/** The asset geometry is exactly the block the KeyframePlayer consumes
 *  (`{key?, duration_ms, easing, steps[]}`, ADR 011 §3.1). The runtime's
 *  `Keyframes`/`KeyframeStep` types are not re-exported from the package
 *  root, so they are derived from `RenderNode.keyframes` (indexed access) —
 *  keeping the oracle type-faithful to what the runtime renders without a
 *  brittle deep import. `key` is OPTIONAL at authoring: the general
 *  `animation.play` asset leaves it for the compiler to bind to
 *  `__anim.<overlay_id>`; `wipe-cover` authors it inline (its `scene_control`
 *  leaf). */
export type AnimationKeyframes = NonNullable<RenderNode["keyframes"]>;
export type AnimationStep = AnimationKeyframes["steps"][number];

export interface BuildAnimationNodeOptions {
  /** The scalar generation leaf path whose value-change replays the
   *  animation — `__anim.<overlay_id>` (ADR 011 §3.2). This is the
   *  `keyframes.key` Orion's compiler binds. */
  leafPath: string;
  /** The authored keyframe geometry (the asset's `keyframes` block, with
   *  whatever `key` it carried — overridden here by `leafPath`). */
  keyframes: AnimationKeyframes;
  /** Stable node id for keyed reconciliation (the asset's resolved target,
   *  or the overlay id). Defaults to `"wipe-cover"` for byte-parity with the
   *  degenerate wipe-cover node. */
  id?: string;
  /** The wrapper frame's props. For the general `animation.play` path these
   *  are the TARGET overlay's geometry (`x`/`y`/`width`/`height`) so the
   *  animated box is dimensioned to the overlay, not the full screen (the
   *  I7 fix). Defaults to the full-screen self-painting cover props
   *  (`{width:"100%",height:"100%",background:DEFAULT_FILL}`) for the
   *  degenerate `wipe-cover` node. */
  props?: Record<string, unknown>;
  /** Child render nodes nested beneath the animation wrapper. For
   *  `animation.play` this is the resolved TARGET overlay node — nesting it
   *  under the keyframe wrapper makes it inherit the animated
   *  `transform`/`opacity` (the I7 fix). Omitted for the self-painting
   *  `wipe-cover` cover (it paints itself, no nested target). */
  children?: RenderNode[];
}

/** Default fill — the franc magenta the M9/M10 probe asserts at the opaque
 *  plateau (the same `DEFAULT_COVER_FILL` `wipe-cover` uses, kept in lock-step
 *  so the delegated wipe-cover node is byte-identical). */
const DEFAULT_ANIMATION_FILL = "#C81E5A";

/** The degenerate full-screen cover props — the default when no target
 *  geometry is supplied (`wipe-cover`'s self-painting opaque cover). */
const FULLSCREEN_COVER_PROPS: Record<string, unknown> = {
  width: "100%",
  height: "100%",
  background: DEFAULT_ANIMATION_FILL,
};

/**
 * Build the lowered Animation Asset `RenderNode` — a keyframed `frame`
 * carrying the authored keyframe block, keyed on the compile-bound scalar
 * leaf. The single source of truth for the node shape Orion's
 * `buildAnimationNode` (Go) must match byte-for-byte (ADR 011 §3.3 / D6).
 *
 * GEOMETRY (I7 live-bug fix). The general `animation.play` node is a
 * TRANSFORM WRAPPER dimensioned to the target overlay (`props` = the
 * target's `x`/`y`/`width`/`height`), with the target NESTED beneath
 * (`children`) so it inherits the animated `transform`/`opacity`. It is NOT
 * a full-screen aplat — translating/fading a 1920×1080 uniform fill is
 * invisible. `wipe-cover` is the degenerate case: no `props`/`children` are
 * supplied, so it defaults to the full-screen self-painting cover (the
 * byte-identical M10 node).
 *
 * The `key` is set to `leafPath` (the compiler-bound generation leaf),
 * overriding any `key` the asset authored — the general `animation.play`
 * trigger is a compiler concern (§3.3). Every other keyframe field
 * (`duration_ms`, `easing`, `steps`) rides through verbatim.
 *
 * NOTE (runtime dependency). The keyframe `transform`/`opacity` only becomes
 * VISIBLE if `@lumencast/runtime`'s KeyframePlayer applies the animated
 * channels to a real, compositing box (not a `display:contents` wrapper,
 * which generates no box and silently drops them). This builder fixes the
 * node STRUCTURE; the compositing fix is a runtime concern.
 */
export function buildAnimationNode(options: BuildAnimationNodeOptions): RenderNode {
  const {
    leafPath,
    keyframes,
    id = "wipe-cover",
    props = FULLSCREEN_COVER_PROPS,
    children,
  } = options;
  const node: RenderNode = {
    kind: "frame",
    id,
    props,
    keyframes: {
      ...keyframes,
      // THE reactive trigger: a value change at this leaf replays the
      // sequence (ADR 011 §3.2 — the scalar generation leaf).
      key: leafPath,
    },
  };
  if (children !== undefined) {
    node.children = children;
  }
  return node;
}
