import { expect, it } from "vitest";
import {
  acceptVisionCompositionFrame,
  type VisionCompositionFrame,
} from "../../src/engine/vision-composition-frame";
import {
  projectNativeCompositionFrame,
  withNativeCompositionSource,
} from "../../src/scenes/native-composition";
import { compositionCoverageFrame } from "../helpers/vision-composition-coverage";
import { compositionFrame } from "../helpers/vision-composition-frame";

const modes = [
  "normal",
  "multiply",
  "screen",
  "hard-light",
  "soft-light",
  "overlay",
  "darken",
  "lighten",
  "difference",
  "exclusion",
  "color-dodge",
  "color-burn",
  "hue",
  "saturation",
  "color",
  "luminosity",
];

const expected = {
  sceneId: "scene",
  sceneVersion: "v1",
  width: 1920,
  height: 1080,
  maxTextureSize: 4096,
};
const source = {
  resource: "scene",
  scene_id: "scene",
  scene_version: "v1",
  stateHash: "sha256:" + "a".repeat(64),
};
const project = (frame: VisionCompositionFrame) =>
  projectNativeCompositionFrame(frame, expected);

it("keeps auxiliary coverage distinct from paint, source framing, order and scalar opacity", () => {
  const frame = compositionCoverageFrame();
  frame.owners[0]!.opacity = 0.5;
  frame.owners[0]!.blendMode = "multiply";
  frame.captures[0]!.blendMode = "screen";
  expect(acceptVisionCompositionFrame(frame, expected)).toBe(frame);
  const projection = project(frame);
  expect(projection.surfaces).toHaveLength(1);
  expect(projection.groups[0]).toMatchObject({
    opacity: 0.5,
    blendMode: "multiply",
    mask: { surface: 0 },
    children: [
      { kind: "solarBand", band: 0 },
      {
        kind: "capture",
        componentId: "vision.capture.2",
        blendMode: "screen",
        mask: { surface: 1 },
        localOpacity: 0.75,
      },
    ],
  });
  expect(projection.coverageSurfaces).toEqual([
    {
      targetId: "prism.native-composition.root.v1",
      coordinateSpace: "global-scene-texels",
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      atlasRect: { x: 1, y: 1083, width: 1920, height: 1080 },
    },
    {
      targetId: "vision.capture.2",
      coordinateSpace: "global-scene-texels",
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      atlasRect: { x: 1, y: 2165, width: 1920, height: 1080 },
    },
  ]);
  const plan = withNativeCompositionSource(projection, "producer", source);
  expect(plan.schema).toBe("solar.native-composition.plan/2");
  expect(plan.coverageSurfaces).toEqual(projection.coverageSurfaces);
});

it("accepts a coverage-only atlas without inventing a visible paint child", () => {
  const frame = compositionCoverageFrame();
  frame.surfaces = [];
  const result = project(frame);
  expect(result.surfaces).toEqual([]);
  expect(result.groups[0]!.children.map((child) => child.kind)).toEqual([
    "capture",
  ]);
});

it.each(modes)(
  "transmits owner and capture %s blending even without masks",
  (mode) => {
    const frame = compositionFrame();
    frame.schema = "vision.native-composition-frame/2";
    frame.coverageSurfaces = [];
    for (const item of [...frame.owners, ...frame.captures]) {
      item.maskSurfaceIndex = null;
      item.blendMode = mode;
    }
    const result = project(frame);
    expect(result.groups[0]!.blendMode).toBe(mode);
    expect(result.groups[0]!.children[1]).toMatchObject({
      blendMode: mode,
      mask: null,
    });
    expect(withNativeCompositionSource(result, "producer", source).schema).toBe(
      "solar.native-composition.plan/2",
    );
  },
);

it("preserves the nominal /1 wire and hashes every /2 coverage reference and geometry", () => {
  const nominal = project(compositionFrame());
  expect(nominal).not.toHaveProperty("coverageSurfaces");
  expect(nominal.groups[0]!.children[1]).not.toHaveProperty("blendMode");
  expect(withNativeCompositionSource(nominal, "producer", source).schema).toBe(
    "solar.native-composition.plan/1",
  );
  const projection = project(compositionCoverageFrame());
  const first = withNativeCompositionSource(projection, "producer-a", source);
  expect(
    withNativeCompositionSource(projection, "producer-b", source).planHash,
  ).toBe(first.planHash);
  projection.coverageSurfaces![0]!.rect.x = 1;
  expect(
    withNativeCompositionSource(projection, "producer-a", source).planHash,
  ).not.toBe(first.planHash);
  expect(first.coverageSurfaces![0]!.rect.x).toBe(0);
  projection.coverageSurfaces![0]!.rect.x = 0;
  projection.groups[0]!.mask = { surface: 1 };
  expect(
    withNativeCompositionSource(projection, "producer-a", source).planHash,
  ).not.toBe(first.planHash);
});

it.each<[string, (frame: VisionCompositionFrame) => void]>([
  [
    "missing coverage list",
    (f) => {
      delete f.coverageSurfaces;
    },
  ],
  [
    "missing index",
    (f) => {
      delete f.owners[0]!.maskSurfaceIndex;
    },
  ],
  [
    "nonintegral index",
    (f) => {
      f.owners[0]!.maskSurfaceIndex = 0.5;
    },
  ],
  [
    "out of range index",
    (f) => {
      f.owners[0]!.maskSurfaceIndex = 99;
    },
  ],
  [
    "mask fact contradicts reference",
    (f) => {
      f.owners[0]!.maskPresent = false;
    },
  ],
  [
    "wrong occurrence",
    (f) => {
      f.owners[0]!.maskSurfaceIndex = 1;
    },
  ],
  [
    "duplicate target",
    (f) => {
      f.coverageSurfaces![1]!.targetNodeId = 0;
    },
  ],
  [
    "unknown target",
    (f) => {
      f.coverageSurfaces![0]!.targetNodeId = 99;
    },
  ],
  [
    "orphan surface",
    (f) => {
      f.captures[0]!.maskPresent = false;
      f.captures[0]!.maskSurfaceIndex = null;
    },
  ],
  [
    "resampling",
    (f) => {
      f.coverageSurfaces![0]!.atlasRect[2]--;
    },
  ],
  [
    "missing gutter",
    (f) => {
      f.coverageSurfaces![0]!.atlasRect[0] = 0;
    },
  ],
  [
    "outside atlas",
    (f) => {
      f.coverageSurfaces![0]!.atlasRect[1] = 5000;
    },
  ],
  [
    "outside viewport",
    (f) => {
      f.coverageSurfaces![0]!.sceneRect[0] = 1;
    },
  ],
  [
    "unknown mode",
    (f) => {
      f.captures[0]!.blendMode = "plus-lighter";
    },
  ],
  [
    "extension under legacy schema",
    (f) => {
      f.schema = "vision.native-composition-frame/1";
    },
  ],
])("refuses %s before a frame can be accepted", (_, change) => {
  const frame = compositionCoverageFrame();
  change(frame);
  expect(() => acceptVisionCompositionFrame(frame, expected)).toThrow(
    "VISION_NATIVE_COMPOSITION_FRAME_INVALID",
  );
});

it("keeps same-frame identity and monotonic revisions mandatory with coverage", () => {
  const previous = compositionCoverageFrame();
  const stale = compositionCoverageFrame();
  stale.pixelRevision = "3";
  expect(() => acceptVisionCompositionFrame(stale, expected, previous)).toThrow(
    "VISION_NATIVE_COMPOSITION_FRAME_STALE",
  );
  const wrong = compositionCoverageFrame();
  wrong.sceneVersion = "other";
  expect(() => acceptVisionCompositionFrame(wrong, expected)).toThrow(
    "VISION_NATIVE_COMPOSITION_FRAME_INVALID",
  );
});
