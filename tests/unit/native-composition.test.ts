import { expect, it } from "vitest";
import {
  projectNativeCompositionFrame,
  withNativeCompositionSource,
} from "../../src/scenes/native-composition";
import { compositionFrame } from "../helpers/vision-composition-frame";
import type { VisionCompositionFrame } from "../../src/engine/vision-composition-frame";

const expected = {
  sceneId: "scene",
  sceneVersion: "v1",
  width: 1920,
  height: 1080,
  maxTextureSize: 4096,
};

function project(frame: VisionCompositionFrame) {
  return projectNativeCompositionFrame(frame, expected);
}

it("projects nested owners and interleaved global bands without applying owner affine twice", () => {
  const frame = compositionFrame();
  frame.owners.push({
    nodeId: 1,
    parentNodeId: 0,
    paintOrder: 4,
    localSize: [480, 270],
    localToWorld: [1.5, 0.2, -0.4, 1.25, 150, 90],
    opacity: 0.4,
    visible: true,
    blendMode: "normal",
    maskPresent: false,
    clipPresent: false,
    clipKind: "none",
  });
  frame.captures[0]!.ownerNodeId = 1;
  frame.captures[0]!.paintOrder = 7;
  frame.captures[0]!.localToWorld = [0.5, 1.25, -0.75, 0.5, 123.5, -45.25];
  frame.surfaces[0]!.ownerNodeId = 1;
  frame.surfaces[0]!.paintOrder = 5;
  frame.surfaces[0]!.beforeNodeId = 2;
  frame.surfaces[0]!.afterNodeId = null;
  frame.surfaces[0]!.atlasRect = [403, 1, 1920, 1080];
  frame.surfaces.push({
    ownerNodeId: 0,
    bandIndex: 1,
    paintOrder: 1,
    beforeNodeId: 1,
    afterNodeId: null,
    coordinateSpace: "global-scene-texels",
    sceneRect: [12, 8, 400, 300],
    atlasRect: [1, 1, 400, 300],
  });
  frame.atlasSize = [2323, 1082];
  frame.canvasSize = [2323, 1082];

  const result = project(frame);
  const root = result.groups[0]!;
  const owner = result.groups.find(
    (group) => group.id === "prism.native-composition.root.v1",
  )!;
  const nested = result.groups.find((group) => group.id === "vision.owner.1")!;

  expect(result).toMatchObject({
    coordinateSpace: "global-scene-texels",
    atlasSize: { width: 2323, height: 1082 },
    width: 2323,
    height: 1082,
    viewport: { width: 1920, height: 1080 },
  });
  expect(root).toMatchObject({
    id: "prism.native-composition.root.v1",
    parentId: null,
    opacity: 1,
    children: [
      { kind: "solarBand", band: 0 },
      { kind: "group", id: "vision.owner.1" },
    ],
  });
  expect(owner.children).toEqual([
    { kind: "solarBand", band: 0 },
    { kind: "group", id: "vision.owner.1" },
  ]);
  expect(nested).toMatchObject({
    parentId: "prism.native-composition.root.v1",
    opacity: 0.4,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    affine: { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 },
    children: [
      { kind: "solarBand", band: 1 },
      { kind: "capture", componentId: "vision.capture.2" },
    ],
  });
  const capture = nested.children[1]!;
  expect(capture).toMatchObject({
    kind: "capture",
    sourceComponentId: "camera",
    localSize: { width: 320, height: 180 },
    affine: {
      m00: 0.5,
      m01: -0.75,
      tx: 123.5,
      m10: 1.25,
      m11: 0.5,
      ty: -45.25,
    },
    localOpacity: 0.75,
    visible: true,
    cropPercent: { left: 0, top: 10, right: 0, bottom: 15 },
    sourceFraming: {
      fit: "cover",
      contentBox: { x: 5, y: null, width: 300, height: null },
      sourceZoom: 1.5,
      objectPosition: { x: 0.25, y: null },
      authoredSize: [320, 180],
      sourceSize: [320, 180],
    },
  });
  expect(result.surfaces).toEqual([
    expect.objectContaining({
      band: 0,
      ownerId: "prism.native-composition.root.v1",
      ownerPath: ["prism.native-composition.root.v1"],
      coordinateSpace: "global-scene-texels",
      rect: { x: 12, y: 8, width: 400, height: 300 },
      atlasRect: { x: 1, y: 1, width: 400, height: 300 },
      affine: { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 },
    }),
    expect.objectContaining({
      band: 1,
      ownerId: "vision.owner.1",
      ownerPath: ["prism.native-composition.root.v1", "vision.owner.1"],
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      atlasRect: { x: 403, y: 1, width: 1920, height: 1080 },
    }),
  ]);
});

it("preserves independent nested owner opacity and capture own opacity", () => {
  const frame = compositionFrame();
  frame.owners[0]!.opacity = 0.5;
  frame.owners.push({
    nodeId: 1,
    parentNodeId: 0,
    paintOrder: 3,
    localSize: [500, 250],
    localToWorld: [1, 0, 0, 1, 10, 20],
    opacity: 0.4,
    visible: true,
    blendMode: "normal",
    maskPresent: false,
    clipPresent: false,
    clipKind: "none",
  });
  frame.captures[0]!.ownerNodeId = 1;
  const result = project(frame);

  expect(
    result.groups.find(
      (group) => group.id === "prism.native-composition.root.v1",
    )?.opacity,
  ).toBe(0.5);
  expect(
    result.groups.find((group) => group.id === "vision.owner.1")?.opacity,
  ).toBe(0.4);
  expect(result.groups[1]!.children[0]).toMatchObject({
    kind: "capture",
    localOpacity: 0.75,
  });
});

it("uses a unique child id per capture occurrence and requires its base author id", () => {
  const frame = compositionFrame();
  frame.captures.push({
    ...structuredClone(frame.captures[0]!),
    nodeId: 8,
    paintOrder: 3,
    effectiveComponentId: "camera",
    localToWorld: [1, 0, 0, 1, 50, 60],
  });
  frame.captures[0]!.paintOrder = 4;
  const result = project(frame);
  const owner = result.groups[0]!;
  expect(owner.children).toMatchObject([
    { kind: "solarBand", band: 0 },
    {
      kind: "capture",
      componentId: "vision.capture.8",
      sourceComponentId: "camera",
    },
    {
      kind: "capture",
      componentId: "vision.capture.2",
      sourceComponentId: "camera",
    },
  ]);

  frame.captures[0]!.effectiveComponentId = null;
  expect(() => project(frame)).toThrow(
    "NATIVE_COMPOSITION_CAPTURE_SOURCE_COMPONENT_ID_MISSING:2",
  );
});

it("uses the required native root id for the receipt root occurrence", () => {
  const frame = compositionFrame();
  frame.owners[0]!.nodeId = 47;
  frame.captures[0]!.ownerNodeId = 47;
  frame.surfaces[0]!.ownerNodeId = 47;
  const result = project(frame);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0]).toMatchObject({
    id: "prism.native-composition.root.v1",
    parentId: null,
    opacity: 1,
    children: [
      { kind: "solarBand", band: 0 },
      { kind: "capture", componentId: "vision.capture.2" },
    ],
  });
  expect(result.surfaces[0]?.ownerPath).toEqual([
    "prism.native-composition.root.v1",
  ]);

  frame.owners = [];
  frame.captures = [];
  frame.surfaces = [];
  frame.atlasSize = [0, 0];
  frame.canvasSize = [1, 1];
  expect(() => project(frame)).toThrow(
    "VISION_NATIVE_COMPOSITION_ROOT_OWNER_REQUIRED",
  );
});

it("preserves authored framing units separately from the bounded upload texture", () => {
  const frame = compositionFrame();
  frame.captures[0]!.authoredSize = [640, 360];
  frame.captures[0]!.sourceSize = [320, 180];
  const capture = project(frame).groups[0]!.children[1]!;
  expect(capture).toMatchObject({
    kind: "capture",
    localSize: { width: 320, height: 180 },
    sourceFraming: {
      contentBox: { x: 5, y: null, width: 300, height: null },
      authoredSize: [640, 360],
      sourceSize: [320, 180],
    },
  });
});

it("supports capture-only and paint-only receipts, including the transparent one-pixel canvas", () => {
  const captureOnly = compositionFrame();
  captureOnly.atlasSize = [0, 0];
  captureOnly.canvasSize = [1, 1];
  captureOnly.surfaces = [];
  const captureProjection = project(captureOnly);
  expect(captureProjection).toMatchObject({
    width: 1,
    height: 1,
    atlasSize: { width: 1, height: 1 },
    surfaces: [],
  });
  expect(captureProjection.groups[0]!.children).toMatchObject([
    { kind: "capture", componentId: "vision.capture.2" },
  ]);

  const paintOnly = compositionFrame();
  paintOnly.captures = [];
  paintOnly.surfaces[0]!.beforeNodeId = null;
  const paintProjection = project(paintOnly);
  expect(paintProjection.groups[0]!.children).toEqual([
    { kind: "solarBand", band: 0 },
  ]);
  expect(paintProjection.surfaces[0]!.atlasRect).toEqual({
    x: 1,
    y: 1,
    width: 1920,
    height: 1080,
  });
});

it("keeps exact viewport scaling and maps full rotation/shear into native matrix order", () => {
  const frame = compositionFrame();
  frame.sceneSize = [960, 540];
  frame.sceneScale = [2, 2];
  frame.atlasSize = [962, 542];
  frame.canvasSize = [962, 542];
  frame.owners[0]!.localSize = [480, 270];
  frame.owners[0]!.localToWorld = [2, 0, 0, 2, 0, 0];
  frame.captures[0]!.localToWorld = [0, -1, 1, 0, 200, 120];
  frame.surfaces[0]!.sceneRect = [15, 20, 400, 220];
  frame.surfaces[0]!.atlasRect = [1, 1, 400, 220];
  const projection = projectNativeCompositionFrame(frame, {
    ...expected,
    width: 960,
    height: 540,
  });
  expect(projection.viewport).toEqual({ width: 960, height: 540 });
  expect(projection.groups[0]!.bounds).toEqual({
    x: 0,
    y: 0,
    width: 960,
    height: 540,
  });
  expect(projection.groups[0]!.affine).toEqual({
    m00: 1,
    m01: 0,
    tx: 0,
    m10: 0,
    m11: 1,
    ty: 0,
  });
  expect(projection.groups[0]!.children[1]).toMatchObject({
    affine: { m00: 0, m01: 1, tx: 200, m10: -1, m11: 0, ty: 120 },
  });
});

it("accepts only producer-classified exact viewport and image-bound clips", () => {
  const frame = compositionFrame();
  frame.owners[0]!.clipPresent = true;
  frame.owners[0]!.clipKind = "viewport-bounds";
  frame.captures[0]!.clipPresent = true;
  frame.captures[0]!.clipKind = "image-bounds";
  expect(() => project(frame)).not.toThrow();

  const authoredOwnerClip = compositionFrame();
  authoredOwnerClip.owners[0]!.clipPresent = true;
  authoredOwnerClip.owners[0]!.clipKind = "authored";
  expect(() => project(authoredOwnerClip)).toThrow(
    "NATIVE_COMPOSITION_UNSUPPORTED_CLIP:owner:0:authored",
  );

  const nestedViewportClip = compositionFrame();
  nestedViewportClip.owners.push({
    nodeId: 1,
    parentNodeId: 0,
    paintOrder: 3,
    localSize: [20, 20],
    localToWorld: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    visible: true,
    blendMode: "normal",
    maskPresent: false,
    clipPresent: true,
    clipKind: "viewport-bounds",
  });
  expect(() => project(nestedViewportClip)).toThrow(
    "NATIVE_COMPOSITION_UNSUPPORTED_CLIP:owner:1:viewport-bounds",
  );

  const authoredCaptureClip = compositionFrame();
  authoredCaptureClip.captures[0]!.clipPresent = true;
  authoredCaptureClip.captures[0]!.clipKind = "authored";
  expect(() => project(authoredCaptureClip)).toThrow(
    "NATIVE_COMPOSITION_UNSUPPORTED_CLIP:capture:2:authored",
  );
});

it("refuses masks and unsupported blend modes without dropping their facts", () => {
  const masked = compositionFrame();
  masked.owners[0]!.maskPresent = true;
  expect(() => project(masked)).toThrow(
    "NATIVE_COMPOSITION_UNSUPPORTED_MASK:owner:0",
  );

  const blend = compositionFrame();
  blend.captures[0]!.blendMode = "difference";
  expect(() => project(blend)).toThrow(
    "NATIVE_COMPOSITION_UNSUPPORTED_BLEND:capture:2:difference",
  );
});

it("refuses canvas-limit, stale-identity and invalid-clip receipts", () => {
  expect(() =>
    projectNativeCompositionFrame(compositionFrame(), {
      ...expected,
      maxTextureSize: 1000,
    }),
  ).toThrow("NATIVE_COMPOSITION_SURFACE_LIMIT:1922x1082:1000");
  expect(() =>
    projectNativeCompositionFrame(
      { ...compositionFrame(), sceneVersion: "retired" },
      expected,
    ),
  ).toThrow("VISION_NATIVE_COMPOSITION_FRAME_INVALID");
  const inconsistent = compositionFrame();
  inconsistent.captures[0]!.clipPresent = true;
  inconsistent.captures[0]!.clipKind = "none";
  expect(() => project(inconsistent)).toThrow(
    "VISION_NATIVE_COMPOSITION_FRAME_INVALID",
  );
});

it("binds the published projection to the exact LSDP hash and receipt geometry", () => {
  const base = compositionFrame();
  const source = {
    resource: "solar/lane-a",
    scene_id: "scene",
    scene_version: "v1",
    stateHash: "sha256:state-7",
  };
  const first = withNativeCompositionSource(project(base), "solar-a", source);
  const mutated = structuredClone(base);
  mutated.captures[0]!.localToWorld = [0.5, 0, 0, 0.5, 55, 70];
  mutated.captures[0]!.sourceCropPercent = {
    left: 0,
    top: 20,
    right: 0,
    bottom: 0,
  };
  mutated.layoutProjectionRevision = "3";
  const second = withNativeCompositionSource(project(mutated), "solar-a", {
    ...source,
    stateHash: "sha256:state-8",
  });

  expect(first.source.stateHash).toBe("sha256:state-7");
  expect(first.planHash).not.toBe(second.planHash);
  expect(first.groups[0]!.children[1]).toMatchObject({
    affine: { m00: 2, m01: 0, tx: 20, m10: 0, m11: 2, ty: 40 },
    cropPercent: { left: 0, top: 10, right: 0, bottom: 15 },
  });
});
