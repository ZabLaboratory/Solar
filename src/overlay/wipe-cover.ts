// Authored "wipe-cover" overlay element — the Solar render side of the
// M10 Blue-driven OBS scene transition (Pulsar ADR 003, Amendment 4 §A4.2).
//
// THE PIVOT (A4.0 row 2 / §A4.2). The visible transition between OBS
// screen-1 and screen-2 is NOT an OBS-native transition and NOT the runtime
// `<Crossfade>` (which only flips on a `scene_changed` → new snapshot,
// `@lumencast/runtime` mount.js — never on a plain leaf delta). It is a
// full-screen *opaque* overlay rendered by OUR engine, layered above the
// `monitor_capture` content, whose opacity animates in-DOM:
//
//     reveal (0 → opaque)  →  hold (opaque plateau)  →  retract (opaque → 0)
//
// Under the opaque plateau the Prism consumer fires an invisible hard-cut of
// the OBS content (`cut_at_ms`), so 100 % of the visible animation is ours.
//
// REACTIVE PATH (M9, the one Quasar/Blue already drive). The element is a
// single authored `RenderNode` (a `frame` primitive) carrying a `keyframes`
// block whose `key` is the `scene_control` leaf path. The runtime's
// `KeyframePlayer` (`@lumencast/runtime` render/keyframe-player) remounts —
// and thus REPLAYS the reveal/hold/retract sequence — every time that leaf's
// value changes. A leaf delta lands via `applyDelta` → the path's signal
// flips → `KeyframePlayer` sees a new `key` value → the animation re-plays.
// No `scene_changed`, no snapshot swap, no runtime `<Crossfade>`. This is the
// in-DOM, leaf-driven repaint the M9 background-colour example proved, reused
// verbatim for an opacity/transform animation.
//
// AUTHORING MODEL. Solar holds no render tree of its own (it is a thin
// adapter over `@lumencast/runtime`); authored content is `RenderBundle`
// fragments. This element is therefore a *bundle-fragment builder*: it emits
// the canonical `wipe-cover` `RenderNode` from the leaf's `overlay` params,
// expressed entirely in the existing `frame` primitive + the `keyframes`
// mechanism (GPU-only `opacity` — the Solar animation constraint). It adds NO
// new runtime primitive (that would be an upstream-runtime change, out of
// scope) — it is a composition, exactly as Solar's doctrine prescribes for new
// widgets. Canvas/Orion (and the M10 probe) compose a scene's `root` with this
// node above the capture content; the same builder is the one proven by the
// unit test below to replay on a leaf delta.

import type { RenderNode } from "@lumencast/runtime";

/** The overlay sub-object carried by the `scene_control` leaf value
 *  (`__inputs.blue.<slug>.scene_control`), Pulsar ADR 003 §A4.2 / the
 *  `scene_control` contract fixtures. Only the `wipe-cover` kind exists for
 *  M10; the enum is left open-by-string so a future authored overlay kind is
 *  additive, not breaking. */
export interface WipeCoverOverlay {
  /** Authored overlay element key. M10 ships exactly `"wipe-cover"`. */
  kind: "wipe-cover";
  /** Milliseconds for the opaque-cover to rise 0 → fully opaque. */
  reveal_ms: number;
  /** Milliseconds the cover holds fully opaque — the window under which the
   *  OBS hard-cut happens invisibly. */
  hold_ms: number;
  /** Milliseconds for the cover to retract fully opaque → 0. */
  retract_ms: number;
}

/** Opaque colour of the cover. Black is the safe default for a broadcast
 *  wipe; authored scenes may override per-build, but the cover MUST be
 *  fully opaque at the plateau or the hidden hard-cut would be visible. */
const DEFAULT_COVER_FILL = "#000000";

/** Narrow an unknown leaf value to a `WipeCoverOverlay`. Used by callers
 *  reading the live `scene_control` leaf (the `overlay` sub-object) before
 *  handing it to the builder. Returns `undefined` for any non-conforming
 *  value — the caller then renders nothing (no overlay), never throws into
 *  the broadcast render path. */
export function parseWipeCoverOverlay(value: unknown): WipeCoverOverlay | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const o = value as Record<string, unknown>;
  if (o.kind !== "wipe-cover") return undefined;
  const reveal = o.reveal_ms;
  const hold = o.hold_ms;
  const retract = o.retract_ms;
  if (!isPositiveInt(reveal) || !isPositiveInt(hold) || !isPositiveInt(retract)) {
    return undefined;
  }
  return { kind: "wipe-cover", reveal_ms: reveal, hold_ms: hold, retract_ms: retract };
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v);
}

export interface BuildWipeCoverNodeOptions {
  /** The `scene_control` leaf path whose value-change replays the animation —
   *  e.g. `__inputs.blue.m10-scene-control.scene_control`. This is the
   *  `keyframes.key`: the M9 reactive trigger. */
  leafPath: string;
  /** The overlay timing read from that leaf's `overlay` sub-object. */
  overlay: WipeCoverOverlay;
  /** Stable node id for keyed reconciliation. Defaults to `"wipe-cover"`. */
  id?: string;
  /** Opaque cover fill. Defaults to black. */
  fill?: string;
}

/**
 * Build the authored `wipe-cover` overlay `RenderNode`.
 *
 * The node is a full-screen, absolute, opaque `frame` whose opacity is driven
 * by a single keyframe sequence:
 *
 *   at 0                         opacity 0     (transparent — content visible)
 *   at reveal/total              opacity 1     (fully opaque — cover up)
 *   at (reveal+hold)/total       opacity 1     (still opaque — the cut window)
 *   at 1                         opacity 0     (transparent — content visible)
 *
 * `duration_ms = reveal_ms + hold_ms + retract_ms`, so the three authored
 * phase durations map exactly onto the keyframe `times[]`. The whole sequence
 * is keyed off `leafPath`, so the runtime's `KeyframePlayer` replays it on
 * every `scene_control` leaf delta (the M9 path).
 *
 * Only `opacity` animates — the Solar GPU-only-animation constraint
 * (CLAUDE.md: `transform` / `opacity` / `filter` only). The cover never
 * touches layout (`width`/`height`/`top`/`left` are static).
 */
export function buildWipeCoverNode(options: BuildWipeCoverNodeOptions): RenderNode {
  const { leafPath, overlay, id = "wipe-cover", fill = DEFAULT_COVER_FILL } = options;
  const { reveal_ms, hold_ms, retract_ms } = overlay;
  const total = reveal_ms + hold_ms + retract_ms;

  // Phase boundaries normalised to the [0, 1] keyframe timeline. `total` is
  // > 0 because each phase is a positive int (enforced by the contract /
  // parseWipeCoverOverlay), so these divisions are always finite.
  const revealAt = reveal_ms / total;
  const holdEndAt = (reveal_ms + hold_ms) / total;

  return {
    kind: "frame",
    id,
    props: {
      // Full-screen opaque cover. Static size (never animated — off the
      // layout path). `background` paints the opaque fill; the frame's own
      // base opacity is overridden frame-by-frame by the keyframe sequence.
      width: "100%",
      height: "100%",
      background: fill,
    },
    keyframes: {
      // THE reactive trigger: a value change at this leaf path replays the
      // sequence. This is the `scene_control` leaf — the same leaf Blue
      // writes and Prism reads for the cut clock (one leaf, co-specified
      // timings; ADR 003 §A4.2 "the leaf itself is the synchronisation
      // contract").
      key: leafPath,
      duration_ms: total,
      easing: "ease-in-out",
      steps: [
        { at: 0, opacity: 0 },
        { at: revealAt, opacity: 1 },
        { at: holdEndAt, opacity: 1 },
        { at: 1, opacity: 0 },
      ],
    },
  };
}
