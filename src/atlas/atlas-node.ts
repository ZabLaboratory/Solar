// Atlas band-split transform — the Solar render side of the ADR 013 Prism
// texture-atlas broadcast mode (§3.1, issue #38).
//
// AUTHORING MODEL. Since ADR 007 (Lumencast convergence) Solar holds no
// render tree of its own: it is a thin adapter over `@lumencast/runtime`, and
// authored content is expressed as `RenderBundle` fragments built by pure
// functions (`buildWipeCoverNode`, `buildAnimationNode`). `buildAtlasRoot` is
// the same shape — a pure `RenderNode → RenderNode` transform, added as a
// composition of the EXISTING `frame` primitive, introducing NO new runtime
// primitive (that would be an upstream-runtime change, out of scope). It is
// consumed by the render-bundle serving path (Orion / the scene-server) when
// it serves an `?atlas=`-scoped URL: the served bundle's `root` is wrapped by
// this transform so the runtime renders the stacked bands unchanged.
//
// WHAT IT DOES. Given the composed scene `root` and a parsed {@link AtlasSpec}
// of N band labels, it splits `root`'s direct children into N contiguous
// z-bands at the NATIVE CAPTURE separators (`x-zab.capture` nodes — the
// on-air PLACEHOLDER that marks where a native OBS source will be composited),
// then stacks each band in its own vertical slice of a 1920×(1080·N) frame:
//
//   band i  →  a transparent `frame` at y = i·1080, size 1920×1080,
//              painting ONLY the children on band i's side of the seuil(s).
//
// The z-order the author declared is DOM order among `root`'s children (the
// runtime paints siblings in order — later = on top; there is no numeric
// z-index in the model). Everything BELOW the first capture → band 0, between
// two captures → band 1, …, above the last capture → band N-1. The capture
// separators themselves are NOT painted by any band: the native source
// replaces them, so a Solar band paints only real scenic components (ADR 013
// §3.1 "tout ce qui est sous la première capture native → bande 0").
//
// TRANSPARENCY. No band nor the outer stage carries a `background`, so every
// slice is fully transparent (the frame primitive paints nothing without a
// declared fill) — the unchanged broadcast-overlay behaviour, and the ADR
// requirement (each band composites over the native sources beneath it).

import type { RenderNode } from "@lumencast/runtime";
import type { AtlasSpec } from "./atlas-param";

/** Logical height of one z-band slice, in CSS px (ADR 013 §3.1 — 1920×1080
 *  per band). */
export const ATLAS_BAND_HEIGHT = 1080;

/** Logical width of the atlas stage, in CSS px (ADR 013 §3.1). */
export const ATLAS_STAGE_WIDTH = 1920;

/** The native-capture primitive kind whose position in the scene tree marks
 *  a z-band boundary (the seuil K): the native OBS source is composited where
 *  this placeholder sits, between two DOM bands. */
const CAPTURE_KIND = "x-zab.capture";

export interface BuildAtlasRootOptions {
  /** Height of one band slice in CSS px. Defaults to {@link ATLAS_BAND_HEIGHT}
   *  (1080). Override for a non-1080 authoring resolution. */
  bandHeight?: number;
  /** Width of the atlas stage in CSS px. Defaults to
   *  {@link ATLAS_STAGE_WIDTH} (1920). */
  width?: number;
}

/**
 * Wrap a composed scene `root` into the ADR 013 atlas layout: N vertically
 * stacked, transparent z-bands in a 1920×(1080·N) frame, each band painting
 * only the children on its side of the native-capture seuil(s).
 *
 * The number of bands is derived from the scene AND cross-checked against the
 * requested spec: a scene with `c` `x-zab.capture` separators splits into
 * `c + 1` bands, which MUST equal `spec.bands.length`. A mismatch means the
 * `?atlas=` URL disagrees with the scene the server is about to serve — a
 * caller (scene-server) bug, surfaced as a thrown `Error` rather than a
 * silently miscut frame.
 *
 * @param root  the composed scene root (its direct children are the z-ordered
 *              scenic components; DOM order is z-order).
 * @param spec  the parsed `?atlas=` band labels (bottom → top), see
 *              {@link parseAtlasParam}.
 */
export function buildAtlasRoot(
  root: RenderNode,
  spec: AtlasSpec,
  options: BuildAtlasRootOptions = {},
): RenderNode {
  const bandHeight = options.bandHeight ?? ATLAS_BAND_HEIGHT;
  const width = options.width ?? ATLAS_STAGE_WIDTH;

  const children = root.children ?? [];

  // Seuils K: the indices of the native-capture separators among root's direct
  // children. `c` separators → `c + 1` z-bands.
  const separators: number[] = [];
  children.forEach((child, index) => {
    if (child.kind === CAPTURE_KIND) separators.push(index);
  });

  const expectedBands = separators.length + 1;
  if (expectedBands !== spec.bands.length) {
    throw new Error(
      `solar.atlas: scene has ${String(separators.length)} native capture ` +
        `separator(s) → ${String(expectedBands)} z-band(s), but ?atlas= ` +
        `declared ${String(spec.bands.length)} band(s)`,
    );
  }

  // Partition the children into contiguous groups AROUND the separators,
  // dropping the separator nodes themselves (the native source replaces them).
  const bandFrames: RenderNode[] = [];
  let cursor = 0;
  for (let i = 0; i < spec.bands.length; i++) {
    // `separators[i]` is the i-th seuil, or `undefined` past the last one →
    // the final band runs to the end. `?? ` is nullish (a seuil at index 0 is
    // kept), so an empty leading band is handled correctly.
    const end = separators[i] ?? children.length;
    const bandChildren = children.slice(cursor, end);
    // Advance past this band's children AND its trailing separator (if any).
    cursor = end + 1;

    bandFrames.push({
      kind: "frame",
      id: `atlas-band-${spec.bands[i]}`,
      props: {
        // `x`/`y` are applied by the frame primitive as a translate transform;
        // y offsets this band into its vertical slice. No `background` →
        // transparent. `clipsContent` (default true) keeps each band's paint
        // inside its own 1080 slice.
        x: 0,
        y: i * bandHeight,
        width,
        height: bandHeight,
        clipsContent: true,
      },
      children: bandChildren,
    });
  }

  return {
    kind: "frame",
    id: "atlas-root",
    props: {
      x: 0,
      y: 0,
      width,
      height: bandHeight * spec.bands.length,
      // The stage itself must not clip the bands to a single slice, and paints
      // nothing (transparent) — it is a pure container.
      clipsContent: false,
    },
    children: bandFrames,
  };
}
