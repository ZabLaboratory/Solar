import { expect, it } from "vitest";
import {
  NATIVE_COMPOSITION_AUTHORED_ROOT_ID,
  prepareNativeComposition,
  withNativeCompositionSource,
} from "../../src/scenes/native-composition";

const viewport = { width: 800, height: 600 };
const maxTextureSize = 4096;
const rootId = "prism.native-composition.root.v1";
const authoredRootId = NATIVE_COMPOSITION_AUTHORED_ROOT_ID;

function document(layout: Record<string, unknown>, defaults = {}) {
  return {
    scene_id: "native-composition-test",
    scene_version: "base",
    defaults,
    layout,
  };
}

function frame(
  id: string,
  size: { w: number; h: number } | { width: number; height: number },
  children: unknown[],
  properties: Record<string, unknown> = {},
) {
  return {
    kind: "frame",
    id,
    size: "w" in size ? size : { w: size.width, h: size.height },
    children,
    ...properties,
  };
}

it("keeps the authored root style on one child group while the synthetic root stays neutral", () => {
  const source = document(
    frame(
      "authored-layout",
      viewport,
      [
        { kind: "shape", id: "root-background" },
        { kind: "x-zab.capture", id: "camera", size: { w: 320, h: 180 } },
        { kind: "text", id: "root-label", value: "after capture" },
      ],
      {
        position: { x: 40, y: 20 },
        rotation: 15,
        opacity: 0.5,
        visible: true,
        clipsContent: true,
        cornerRadius: 24,
        fill: "#1b2c3d",
      },
    ),
  );

  const projection = prepareNativeComposition(source, viewport, maxTextureSize);
  const root = projection.groups.find((group) => group.id === rootId)!;
  const authoredRoot = projection.groups.find(
    (group) => group.id === authoredRootId,
  )!;
  expect(root).toMatchObject({
    parentId: null,
    order: 0,
    opacity: 1,
    visible: true,
    blendMode: "normal",
    affine: { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 },
    mask: null,
    children: [{ kind: "group", id: authoredRootId }],
  });
  expect(authoredRoot).toMatchObject({
    parentId: rootId,
    opacity: 0.5,
    visible: true,
    blendMode: "normal",
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    mask: { kind: "frame-clip", width: 800, height: 600, radius: 24 },
    children: [
      { kind: "solarBand", band: 0 },
      {
        kind: "capture",
        componentId: "camera",
        localSize: { width: 320, height: 180 },
        visible: true,
      },
      { kind: "solarBand", band: 1 },
    ],
  });
  expect(authoredRoot.affine.m00).toBeCloseTo(Math.cos(Math.PI / 12), 12);
  expect(authoredRoot.affine.m01).toBeCloseTo(-Math.sin(Math.PI / 12), 12);
  expect(authoredRoot.affine.m10).toBeCloseTo(Math.sin(Math.PI / 12), 12);
  expect(authoredRoot.affine.m11).toBeCloseTo(Math.cos(Math.PI / 12), 12);
  expect(authoredRoot.affine.tx).toBeCloseTo(
    40 + 400 - Math.cos(Math.PI / 12) * 400 + Math.sin(Math.PI / 12) * 300,
    12,
  );
  expect(authoredRoot.affine.ty).toBeCloseTo(
    20 + 300 - Math.sin(Math.PI / 12) * 400 - Math.cos(Math.PI / 12) * 300,
    12,
  );
  expect(projection.surfaces).toMatchObject([
    {
      band: 0,
      ownerId: authoredRootId,
      ownerPath: [rootId, authoredRootId],
      coordinateSpace: "group-local",
      rect: { x: 0, y: 0, width: 800, height: 600 },
    },
    {
      band: 1,
      ownerId: authoredRootId,
      ownerPath: [rootId, authoredRootId],
      coordinateSpace: "group-local",
      rect: { x: 0, y: 0, width: 800, height: 600 },
    },
  ]);

  const atlas = source.layout as {
    children: Array<{
      children: Array<Record<string, unknown>>;
    }>;
  };
  const firstRasterOwner = atlas.children[0]!.children[0]!;
  const nextRasterOwner = atlas.children[1]!.children[0]!;
  expect(firstRasterOwner).toMatchObject({
    position: { x: 0, y: 0 },
    rotation: 0,
    opacity: 1,
    visible: true,
    blendMode: "normal",
    fill: "#1b2c3d",
  });
  expect(firstRasterOwner).not.toHaveProperty("clipsContent");
  expect(firstRasterOwner).not.toHaveProperty("cornerRadius");
  expect(nextRasterOwner).not.toHaveProperty("fill");
  expect(nextRasterOwner).not.toHaveProperty("opacity", 0.5);
});

it("segments nested capture groups in DFS order and paints each owner background once", () => {
  const source = document(
    frame(
      "root-layout",
      { w: 800, h: 600 },
      [
        { kind: "shape", id: "root-before" },
        frame(
          "outer",
          { w: 300, h: 200 },
          [
            { kind: "shape", id: "outer-before" },
            frame(
              "inner",
              { w: 120, h: 80 },
              [
                { kind: "text", id: "inner-before", value: "before" },
                {
                  kind: "x-zab.capture",
                  id: "camera",
                  size: { w: 100, h: 56 },
                },
                { kind: "shape", id: "inner-after" },
              ],
              { position: { x: 22, y: 17 }, rotation: -13 },
            ),
            { kind: "shape", id: "outer-after" },
          ],
          { position: { x: 50, y: 30 }, rotation: 27, opacity: 0.5 },
        ),
        { kind: "shape", id: "root-after" },
      ],
      { fill: "#123456" },
    ),
  );

  const projection = prepareNativeComposition(source, viewport, maxTextureSize);
  const root = projection.groups.find((group) => group.id === rootId)!;
  const outer = projection.groups.find((group) => group.id === "outer")!;
  const inner = projection.groups.find((group) => group.id === "inner")!;

  expect(projection.groups.map((group) => group.id)).toEqual([
    rootId,
    authoredRootId,
    "outer",
    "inner",
  ]);
  expect(root).toMatchObject({
    parentId: null,
    opacity: 1,
    visible: true,
    blendMode: "normal",
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    children: [{ kind: "group", id: authoredRootId }],
  });
  const authoredRoot = projection.groups.find(
    (group) => group.id === authoredRootId,
  )!;
  expect(authoredRoot).toMatchObject({
    parentId: rootId,
    opacity: 1,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    children: [
      { kind: "solarBand", band: 0 },
      { kind: "group", id: "outer" },
      { kind: "solarBand", band: 5 },
    ],
  });
  expect(outer).toMatchObject({
    parentId: authoredRootId,
    opacity: 0.5,
    bounds: { x: 0, y: 0, width: 300, height: 200 },
    children: [
      { kind: "solarBand", band: 1 },
      { kind: "group", id: "inner" },
      { kind: "solarBand", band: 4 },
    ],
  });
  const outerAngle = (27 * Math.PI) / 180;
  expect(outer.affine.m00).toBeCloseTo(Math.cos(outerAngle), 12);
  expect(outer.affine.m01).toBeCloseTo(-Math.sin(outerAngle), 12);
  expect(outer.affine.tx).toBeCloseTo(
    50 + 150 - Math.cos(outerAngle) * 150 + Math.sin(outerAngle) * 100,
    12,
  );
  expect(inner).toMatchObject({
    parentId: "outer",
    bounds: { x: 0, y: 0, width: 120, height: 80 },
    children: [
      { kind: "solarBand", band: 2 },
      {
        kind: "capture",
        componentId: "camera",
        localSize: { width: 100, height: 56 },
        visible: true,
        localOpacity: 1,
      },
      { kind: "solarBand", band: 3 },
    ],
  });
  expect(
    projection.surfaces.map(
      ({ band, ownerId, coordinateSpace, ownerPath, atlasRect }) => ({
        band,
        ownerId,
        coordinateSpace,
        ownerPath,
        y: atlasRect.y,
      }),
    ),
  ).toEqual([
    {
      band: 0,
      ownerId: authoredRootId,
      coordinateSpace: "group-local",
      ownerPath: [rootId, authoredRootId],
      y: 0,
    },
    {
      band: 1,
      ownerId: "outer",
      coordinateSpace: "group-local",
      ownerPath: [rootId, authoredRootId, "outer"],
      y: 600,
    },
    {
      band: 2,
      ownerId: "inner",
      coordinateSpace: "group-local",
      ownerPath: [rootId, authoredRootId, "outer", "inner"],
      y: 800,
    },
    {
      band: 3,
      ownerId: "inner",
      coordinateSpace: "group-local",
      ownerPath: [rootId, authoredRootId, "outer", "inner"],
      y: 880,
    },
    {
      band: 4,
      ownerId: "outer",
      coordinateSpace: "group-local",
      ownerPath: [rootId, authoredRootId, "outer"],
      y: 960,
    },
    {
      band: 5,
      ownerId: authoredRootId,
      coordinateSpace: "group-local",
      ownerPath: [rootId, authoredRootId],
      y: 1160,
    },
  ]);

  const atlas = source.layout as {
    size: { w: number; h: number };
    children: Array<{
      position: { y: number };
      size: { w: number; h: number };
      children: Array<{ fill?: string; children: Array<{ id?: string }> }>;
    }>;
  };
  expect(atlas.size).toEqual({ w: 800, h: 1760 });
  expect(atlas.children[0]!.children[0]!.fill).toBe("#123456");
  expect(atlas.children[5]!.children[0]).not.toHaveProperty("fill");
  expect(
    atlas.children.map(({ position, size }) => ({ y: position.y, size })),
  ).toEqual([
    { y: 0, size: { w: 800, h: 600 } },
    { y: 600, size: { w: 300, h: 200 } },
    { y: 800, size: { w: 120, h: 80 } },
    { y: 880, size: { w: 120, h: 80 } },
    { y: 960, size: { w: 300, h: 200 } },
    { y: 1160, size: { w: 800, h: 600 } },
  ]);
});

it("carries mixed-blend contributions on an isolated canonical group", () => {
  const source = document(
    frame("root", viewport, [
      { kind: "shape", id: "below" },
      { kind: "x-zab.capture", id: "camera", size: { w: 320, h: 180 } },
      { kind: "text", id: "before" },
      {
        kind: "image",
        id: "image",
        blendMode: "difference",
        opacity: 0.7,
        rotation: 30,
      },
      { kind: "text", id: "after" },
    ]),
  );

  const projection = prepareNativeComposition(source, viewport, maxTextureSize);
  const root = projection.groups.find((group) => group.id === authoredRootId)!;
  const blend = projection.groups.find(
    (group) => group.blendMode === "difference",
  )!;
  expect(
    projection.groups.find((group) => group.id === rootId)!.children,
  ).toEqual([{ kind: "group", id: authoredRootId }]);
  expect(root.children).toEqual([
    { kind: "solarBand", band: 0 },
    {
      kind: "capture",
      componentId: "camera",
      localSize: { width: 320, height: 180 },
      affine: { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 },
      localOpacity: 1,
      visible: true,
      cropPercent: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    { kind: "solarBand", band: 1 },
    { kind: "group", id: blend.id },
    { kind: "solarBand", band: 3 },
  ]);
  expect(blend).toMatchObject({
    parentId: authoredRootId,
    opacity: 1,
    visible: true,
    blendMode: "difference",
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    children: [{ kind: "solarBand", band: 2 }],
  });
  expect(projection.surfaces[2]).toMatchObject({
    band: 2,
    ownerId: blend.id,
    ownerPath: [rootId, authoredRootId, blend.id],
    coordinateSpace: "group-local",
  });
  const atlas = source.layout as {
    children: Array<{
      children: Array<{ children: Array<Record<string, unknown>> }>;
    }>;
  };
  expect(atlas.children[2]!.children[0]!.children[0]).toMatchObject({
    id: "image",
    blendMode: "normal",
    opacity: 0.7,
    rotation: 30,
  });
});

it("propagates capture visibility through every native group and rejects unresolved bindings", () => {
  const source = document(
    frame("root", viewport, [
      frame(
        "hidden-frame",
        { w: 300, h: 200 },
        [
          {
            kind: "x-zab.capture",
            id: "hidden-camera",
            size: { w: 320, h: 180 },
            visible: true,
          },
        ],
        { visible: false },
      ),
      frame(
        "bound-frame",
        { w: 200, h: 120 },
        [
          {
            kind: "x-zab.capture",
            id: "bound-camera",
            size: { w: 160, h: 90 },
            bind: { visible: "capture-visible" },
          },
        ],
        { bind: { visible: "frame-visible" } },
      ),
    ]),
    { "frame-visible": true, "capture-visible": false },
  );

  const projection = prepareNativeComposition(source, viewport, maxTextureSize);
  expect(
    projection.groups.find((group) => group.id === "hidden-frame")!.visible,
  ).toBe(false);
  expect(
    projection.groups.find((group) => group.id === "bound-frame")!.visible,
  ).toBe(true);
  expect(
    projection.groups
      .flatMap((group) => group.children)
      .filter((child) => child.kind === "capture")
      .map((child) => child.visible),
  ).toEqual([false, false]);
  expect(projection.geometryBindings).toContain("frame-visible");
  expect(projection.geometryBindings).toContain("capture-visible");

  const invalid = document(
    frame("root", viewport, [
      {
        kind: "x-zab.capture",
        id: "camera",
        size: { w: 320, h: 180 },
        bind: { visible: "visible" },
      },
    ]),
    { visible: "false" },
  );
  expect(() =>
    prepareNativeComposition(invalid, viewport, maxTextureSize),
  ).toThrow("NATIVE_COMPOSITION_INVALID_BOOLEAN:camera.visible:visible");
});

it("rejects unresolved capture layouts, reserved IDs and texture over-budget atlases", () => {
  const repeated = document(
    frame("root", viewport, [
      {
        kind: "repeat",
        id: "dynamic-list",
        template: { kind: "x-zab.capture", id: "camera" },
      },
    ]),
  );
  expect(() =>
    prepareNativeComposition(repeated, viewport, maxTextureSize),
  ).toThrow("NATIVE_COMPOSITION_UNRESOLVED_LAYOUT:dynamic-list");

  const collision = document(
    frame(rootId, viewport, [
      { kind: "x-zab.capture", id: "camera", size: { w: 320, h: 180 } },
    ]),
  );
  expect(() =>
    prepareNativeComposition(collision, viewport, maxTextureSize),
  ).toThrow(`NATIVE_COMPOSITION_RESERVED_GROUP_ID:${rootId}`);

  const authoredRootCollision = document(
    frame("root", viewport, [
      frame(authoredRootId, { w: 300, h: 200 }, [
        { kind: "x-zab.capture", id: "camera", size: { w: 320, h: 180 } },
      ]),
    ]),
  );
  const unmodifiedLayout = structuredClone(authoredRootCollision.layout);
  expect(() =>
    prepareNativeComposition(authoredRootCollision, viewport, maxTextureSize),
  ).toThrow(`NATIVE_COMPOSITION_RESERVED_GROUP_ID:${authoredRootId}`);
  expect(authoredRootCollision.layout).toEqual(unmodifiedLayout);

  const overBudget = document(
    frame("root", viewport, [
      { kind: "shape", id: "before" },
      { kind: "x-zab.capture", id: "camera", size: { w: 320, h: 180 } },
      { kind: "text", id: "after" },
    ]),
  );
  expect(() => prepareNativeComposition(overBudget, viewport, 1000)).toThrow(
    "NATIVE_COMPOSITION_SURFACE_LIMIT:800x1200:1000",
  );
});

it("hashes active source and graph content while excluding the Main producer nonce", () => {
  const projection = prepareNativeComposition(
    document(
      frame("layout", viewport, [
        { kind: "x-zab.capture", id: "camera", size: { w: 320, h: 180 } },
      ]),
    ),
    viewport,
    maxTextureSize,
  );
  const source = {
    resource: "solar/lane-a",
    scene_id: "scene-a",
    scene_version: "sha256:revision-a",
    stateHash: "tree-sha256:state-a",
  };
  const first = withNativeCompositionSource(projection, "host-a-1", source);
  const otherOwner = withNativeCompositionSource(
    projection,
    "host-a-2",
    source,
  );
  const nextState = withNativeCompositionSource(projection, "host-a-1", {
    ...source,
    stateHash: "tree-sha256:state-b",
  });

  expect(first.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(otherOwner.planHash).toBe(first.planHash);
  expect(nextState.planHash).not.toBe(first.planHash);
  const global = withNativeCompositionSource(
    {
      ...projection,
      coordinateSpace: "global-scene-texels",
      atlasSize: { width: 802, height: 602 },
    },
    "host-a-1",
    source,
  );
  expect(global.coordinateSpace).toBe("global-scene-texels");
  expect(global.atlasSize).toEqual({ width: 802, height: 602 });
  expect(global.planHash).not.toBe(first.planHash);
  const changedExtent = withNativeCompositionSource(
    {
      ...projection,
      coordinateSpace: "global-scene-texels",
      atlasSize: { width: 803, height: 602 },
    },
    "host-a-1",
    source,
  );
  expect(changedExtent.planHash).not.toBe(global.planHash);
  expect(
    withNativeCompositionSource(
      {
        ...projection,
        coordinateSpace: "global-scene-texels",
        atlasSize: { width: 802, height: 602 },
      },
      "host-a-2",
      source,
    ).planHash,
  ).toBe(global.planHash);
});
