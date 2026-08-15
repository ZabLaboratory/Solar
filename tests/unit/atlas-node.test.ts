import { describe, expect, it } from "vitest";
import type { RenderNode } from "@lumencast/runtime";
import {
  ATLAS_BAND_HEIGHT,
  ATLAS_STAGE_WIDTH,
  buildAtlasRoot,
} from "../../src/atlas/atlas-node";
import { parseAtlasParam } from "../../src/atlas/atlas-param";

// Structural proof of the ADR 013 atlas band-split transform (issue #38).
// buildAtlasRoot is a pure RenderNode → RenderNode transform (Solar's builder
// doctrine, like buildWipeCoverNode); these tests pin the emitted band tree
// exactly, including the per-band z-threshold membership, the N×1080 stage
// dimensions, and the transparency (no `background` anywhere).

// Distinct scenic components + a native-capture separator. DOM order is
// z-order: `below-*` sit under the capture, `above-*` on top.
const belowText: RenderNode = { kind: "text", id: "below-title", props: { text: "BELOW" } };
const belowShape: RenderNode = { kind: "shape", id: "below-bar" };
const capture: RenderNode = { kind: "x-zab.capture", id: "cam", props: { width: 1920, height: 1080 } };
const aboveText: RenderNode = { kind: "text", id: "above-scoreboard", props: { text: "ABOVE" } };

const twoBandRoot: RenderNode = {
  kind: "stack",
  children: [belowText, belowShape, capture, aboveText],
};

/** Every `background` value found on this node and its descendants. */
function collectBackgrounds(node: RenderNode): unknown[] {
  const here = node.props?.background;
  const child = (node.children ?? []).flatMap(collectBackgrounds);
  return here === undefined ? child : [here, ...child];
}

describe("buildAtlasRoot()", () => {
  it("stacks two z-bands split at the native-capture seuil", () => {
    const spec = parseAtlasParam("below,above");
    if (spec === null) throw new Error("fixture: spec must parse");

    const atlas = buildAtlasRoot(twoBandRoot, spec);

    expect(atlas).toEqual({
      kind: "frame",
      id: "atlas-root",
      props: {
        x: 0,
        y: 0,
        width: ATLAS_STAGE_WIDTH,
        height: ATLAS_BAND_HEIGHT * 2,
        clipsContent: false,
      },
      children: [
        {
          kind: "frame",
          id: "atlas-band-below",
          props: {
            x: 0,
            y: 0,
            width: ATLAS_STAGE_WIDTH,
            height: ATLAS_BAND_HEIGHT,
            clipsContent: true,
          },
          // Only the components UNDER the capture, capture itself dropped.
          children: [belowText, belowShape],
        },
        {
          kind: "frame",
          id: "atlas-band-above",
          props: {
            x: 0,
            y: ATLAS_BAND_HEIGHT,
            width: ATLAS_STAGE_WIDTH,
            height: ATLAS_BAND_HEIGHT,
            clipsContent: true,
          },
          // Only the components OVER the capture.
          children: [aboveText],
        },
      ],
    });
  });

  it("gives the stage the full N×1080 height and each band its own slice", () => {
    const spec = parseAtlasParam("below,mid,above");
    if (spec === null) throw new Error("fixture: spec must parse");

    const root: RenderNode = {
      kind: "stack",
      children: [
        belowText,
        { ...capture, id: "cam-a" },
        aboveText,
        { ...capture, id: "cam-b" },
        { kind: "text", id: "top", props: { text: "TOP" } },
      ],
    };

    const atlas = buildAtlasRoot(root, spec);

    expect(atlas.props?.height).toBe(ATLAS_BAND_HEIGHT * 3);
    const bands = atlas.children ?? [];
    expect(bands.map((b) => b.props?.y)).toEqual([
      0,
      ATLAS_BAND_HEIGHT,
      ATLAS_BAND_HEIGHT * 2,
    ]);
    // Band membership around the two capture separators.
    expect(bands[0]?.children).toEqual([belowText]);
    expect(bands[1]?.children).toEqual([aboveText]);
    expect(bands[2]?.children?.map((c) => c.id)).toEqual(["top"]);
  });

  it("yields an empty band when a capture leads its slice (cam-only band)", () => {
    const spec = parseAtlasParam("below,above");
    if (spec === null) throw new Error("fixture: spec must parse");

    // Capture first → the 'below' band has no scenic component (the native
    // source alone fills that slice).
    const root: RenderNode = {
      kind: "stack",
      children: [capture, aboveText],
    };

    const atlas = buildAtlasRoot(root, spec);
    const bands = atlas.children ?? [];
    expect(bands[0]?.children).toEqual([]);
    expect(bands[1]?.children).toEqual([aboveText]);
  });

  it("keeps every band and the stage transparent (no background)", () => {
    const spec = parseAtlasParam("below,above");
    if (spec === null) throw new Error("fixture: spec must parse");

    const atlas = buildAtlasRoot(twoBandRoot, spec);
    // The only backgrounds present come from authored scenic children, never
    // from the atlas frames the transform introduces.
    expect(collectBackgrounds(atlas)).toEqual([]);
  });

  it("honours a non-default band height / width", () => {
    const spec = parseAtlasParam("below,above");
    if (spec === null) throw new Error("fixture: spec must parse");

    const atlas = buildAtlasRoot(twoBandRoot, spec, {
      bandHeight: 720,
      width: 1280,
    });
    expect(atlas.props).toMatchObject({ width: 1280, height: 1440 });
    expect(atlas.children?.[1]?.props).toMatchObject({ y: 720, height: 720 });
  });

  it("throws when the scene's capture count disagrees with ?atlas=", () => {
    const spec = parseAtlasParam("below,mid,above"); // 3 bands
    if (spec === null) throw new Error("fixture: spec must parse");

    // twoBandRoot has ONE capture → 2 bands, not 3.
    expect(() => buildAtlasRoot(twoBandRoot, spec)).toThrow(/atlas/i);
  });

  it("builds a single transparent band when the root has no children", () => {
    const spec = parseAtlasParam("only");
    if (spec === null) throw new Error("fixture: spec must parse");

    const atlas = buildAtlasRoot({ kind: "stack" }, spec);
    expect(atlas.children).toHaveLength(1);
    expect(atlas.children?.[0]?.children).toEqual([]);
  });
});
