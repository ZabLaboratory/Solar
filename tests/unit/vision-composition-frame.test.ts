import { expect, it } from "vitest";
import {
  acceptVisionCompositionFrame,
  type VisionCompositionFrame,
} from "../../src/engine/vision-composition-frame";
import { compositionFrame } from "../helpers/vision-composition-frame";

const expected = {
  sceneId: "scene",
  sceneVersion: "v1",
  width: 1920,
  height: 1080,
};

it("accepts exact scene-grid transforms, authoring scale and gutter-preserving atlas dimensions", () => {
  const frame = compositionFrame();
  const accepted = acceptVisionCompositionFrame(frame, expected);
  expect(accepted).toBe(frame);
  expect(accepted.captures[0]!.localToWorld).toEqual([2, 0, 0, 2, 20, 40]);
  expect(accepted.canvasSize).toEqual([1922, 1082]);
  expect(accepted.captures[0]!.sourceCropPercent).toEqual({
    left: 0,
    top: 10,
    right: 0,
    bottom: 15,
  });
  expect(accepted.captures[0]!.contentBox).toEqual({
    x: 5,
    y: null,
    width: 300,
    height: null,
  });
  expect(accepted.captures[0]!.objectPosition).toEqual({ x: 0.25, y: null });
});

it("keeps absent framing explicit and accepts Rust f32 crop normalization without recomputing it", () => {
  const frame = compositionFrame();
  const capture = frame.captures[0]!;
  capture.fit = null;
  capture.contentBox = null;
  capture.objectPosition = null;
  capture.sourceZoom = null;
  capture.sourceCropPercent = {
    left: 49.500003814697266,
    right: 49.500003814697266,
    top: 0,
    bottom: 0,
  };
  expect(acceptVisionCompositionFrame(frame, expected).captures[0]).toBe(
    capture,
  );
  capture.sourceCropPercent = null;
  expect(
    acceptVisionCompositionFrame(frame, expected).captures[0]!
      .sourceCropPercent,
  ).toBeNull();
});

it("accepts the transparent 1px canvas of a capture-only frame without inventing a raster band", () => {
  const frame = compositionFrame();
  frame.atlasSize = [0, 0];
  frame.canvasSize = [1, 1];
  frame.surfaces = [];
  expect(acceptVisionCompositionFrame(frame, expected).captures).toHaveLength(
    1,
  );
});

it("refuses a regressing accepted pixel or layout revision, while allowing a context restoration of the same revision", () => {
  const previous = compositionFrame();
  expect(
    acceptVisionCompositionFrame(compositionFrame(), expected, previous)
      .pixelRevision,
  ).toBe("4");
  const pixels = compositionFrame();
  pixels.pixelRevision = "3";
  expect(() =>
    acceptVisionCompositionFrame(pixels, expected, previous),
  ).toThrow("VISION_NATIVE_COMPOSITION_FRAME_STALE");
  const layout = compositionFrame();
  layout.layoutProjectionRevision = "1";
  expect(() =>
    acceptVisionCompositionFrame(layout, expected, previous),
  ).toThrow("VISION_NATIVE_COMPOSITION_FRAME_STALE");
});

it.each<[string, (frame: VisionCompositionFrame) => void]>([
  [
    "invalid owner blend",
    (frame) => {
      frame.owners[0]!.blendMode = "";
    },
  ],
  [
    "missing clip fact",
    (frame) => {
      Reflect.deleteProperty(frame.captures[0]!, "clipPresent");
    },
  ],
  [
    "missing clip classification",
    (frame) => {
      Reflect.deleteProperty(frame.captures[0]!, "clipKind");
    },
  ],
  [
    "clip classification contradicts raw clip fact",
    (frame) => {
      frame.captures[0]!.clipPresent = true;
    },
  ],
  [
    "unknown clip classification",
    (frame) => {
      frame.captures[0]!.clipKind = "rectangle" as never;
    },
  ],
  [
    "infinite zoom",
    (frame) => {
      frame.captures[0]!.sourceZoom = Infinity;
    },
  ],
  [
    "crop over normalized limit",
    (frame) => {
      frame.captures[0]!.sourceCropPercent!.left = 99;
      frame.captures[0]!.sourceCropPercent!.right = 1;
    },
  ],
  [
    "negative crop",
    (frame) => {
      frame.captures[0]!.sourceCropPercent!.top = -1;
    },
  ],
  [
    "infinite content box",
    (frame) => {
      frame.captures[0]!.contentBox!.width = Infinity;
    },
  ],
  [
    "infinite source position",
    (frame) => {
      frame.captures[0]!.objectPosition!.x = Infinity;
    },
  ],
  [
    "missing framing field",
    (frame) => {
      Reflect.deleteProperty(frame.captures[0]!, "fit");
    },
  ],
  [
    "wrong scene",
    (frame) => {
      frame.sceneId = "other";
    },
  ],
  [
    "old variant",
    (frame) => {
      frame.sceneVersion = "old";
    },
  ],
  [
    "wrong scene grid",
    (frame) => {
      frame.sceneSize[0] = 960;
    },
  ],
  [
    "missing gutter",
    (frame) => {
      frame.canvasSize[0]--;
    },
  ],
  [
    "one empty atlas dimension",
    (frame) => {
      frame.atlasSize[0] = 0;
    },
  ],
  [
    "invalid pixel revision",
    (frame) => {
      frame.pixelRevision = "-1";
    },
  ],
  [
    "invalid projection revision",
    (frame) => {
      frame.layoutProjectionRevision = "1.5";
    },
  ],
  [
    "infinite scale",
    (frame) => {
      frame.sceneScale[0] = Infinity;
    },
  ],
  [
    "owner cycle",
    (frame) => {
      frame.owners[0]!.parentNodeId = 0;
    },
  ],
  [
    "missing owner",
    (frame) => {
      frame.captures[0]!.ownerNodeId = 999;
    },
  ],
  [
    "duplicate capture occurrence",
    (frame) => {
      frame.captures.push(frame.captures[0]!);
    },
  ],
  [
    "invalid capture source size",
    (frame) => {
      frame.captures[0]!.sourceSize = [0, 1];
    },
  ],
  [
    "missing capture source size",
    (frame) => {
      Reflect.deleteProperty(frame.captures[0]!, "sourceSize");
    },
  ],
  [
    "missing authored size",
    (frame) => {
      Reflect.deleteProperty(frame.captures[0]!, "authoredSize");
    },
  ],
  [
    "non-finite authored size",
    (frame) => {
      frame.captures[0]!.authoredSize[0] = Infinity;
    },
  ],
  [
    "float overflow transform",
    (frame) => {
      frame.captures[0]!.localToWorld[0] = 1e40;
    },
  ],
  [
    "invalid opacity",
    (frame) => {
      frame.captures[0]!.localOpacity = 2;
    },
  ],
  [
    "unknown paint boundary",
    (frame) => {
      frame.surfaces[0]!.beforeNodeId = 1234;
    },
  ],
  [
    "duplicate owner band",
    (frame) => {
      frame.surfaces.push(frame.surfaces[0]!);
    },
  ],
  [
    "fractional texel origin",
    (frame) => {
      frame.surfaces[0]!.atlasRect[0] = 1.5;
    },
  ],
  [
    "resampled band",
    (frame) => {
      frame.surfaces[0]!.atlasRect[2] = 960;
    },
  ],
  [
    "outside scene",
    (frame) => {
      frame.surfaces[0]!.sceneRect[0] = 2;
    },
  ],
  [
    "outside atlas",
    (frame) => {
      frame.surfaces[0]!.atlasRect[1] = 3;
    },
  ],
])("refuses %s before presentation", (_label, change) => {
  const frame = compositionFrame();
  change(frame);
  expect(() => acceptVisionCompositionFrame(frame, expected)).toThrow(
    "VISION_NATIVE_COMPOSITION_FRAME_INVALID",
  );
});
