import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalize } from "@lumencast/canonical";
import { bench, describe } from "vitest";
import {
  acceptVisionCompositionFrame,
  type VisionCompositionFrame,
} from "../../src/engine/vision-composition-frame";
import { projectNativeCompositionFrame } from "../../src/scenes/native-composition";
import { withNativeCompositionSource } from "../../src/scenes/native-composition-plan";

interface Fixture {
  frame: VisionCompositionFrame;
  expected: {
    sceneId: string;
    sceneVersion: string;
    width: number;
    height: number;
    maxTextureSize: number;
  };
}

const sceneId = "native-capture-translation-benchmark";
const sceneVersion = `sha256:${"1".repeat(64)}`;
const benchOptions = { time: 250, warmupTime: 100, iterations: 30 };

function makeFixture(captureCount: number): Fixture {
  const columns = 32;
  const rows = Math.ceil(captureCount / columns);
  const width = columns * 128;
  const height = rows * 64;
  const captures: VisionCompositionFrame["captures"] = [];
  const surfaces: VisionCompositionFrame["surfaces"] = [];
  for (let index = 0; index < captureCount; index++) {
    const nodeId = index + 2;
    const x = (index % columns) * 128;
    const y = Math.floor(index / columns) * 64;
    captures.push({
      nodeId,
      ownerNodeId: 0,
      paintOrder: index * 2 + 2,
      localSize: [128, 64],
      localToOwner: [1, 0, 0, 1, x, y],
      localToWorld: [1, 0, 0, 1, x, y],
      localOpacity: 1,
      visible: true,
      effectiveComponentId: "camera.main",
      liveMediaPath: null,
      authoredSize: [128, 64],
      sourceSize: [128, 64],
      blendMode: "normal",
      maskPresent: false,
      clipPresent: false,
      clipKind: "none",
      fit: "cover",
      sourceCropPercent: null,
      contentBox: null,
      sourceZoom: null,
      objectPosition: null,
    });
    surfaces.push({
      ownerNodeId: 0,
      bandIndex: index,
      paintOrder: index * 2 + 1,
      beforeNodeId: nodeId,
      afterNodeId: null,
      coordinateSpace: "global-scene-texels",
      sceneRect: [x, y, 128, 64],
      atlasRect: [x + 1, y + 1, 128, 64],
    });
  }

  return {
    frame: {
      schema: "vision.native-composition-frame/1",
      coordinateSpace: "global-scene-texels",
      sceneId,
      sceneVersion,
      pixelRevision: "4",
      layoutProjectionRevision: "2",
      sceneSize: [width, height],
      sceneScale: [1, 1],
      atlasSize: [width + 2, height + 2],
      canvasSize: [width + 2, height + 2],
      gpuSubmission: "present-queued",
      physicalPresentation: "not-measured",
      owners: [
        {
          nodeId: 0,
          parentNodeId: null,
          paintOrder: 0,
          localSize: [width, height],
          localToWorld: [1, 0, 0, 1, 0, 0],
          opacity: 1,
          visible: true,
          blendMode: "normal",
          maskPresent: false,
          clipPresent: false,
          clipKind: "none",
        },
      ],
      captures,
      surfaces,
    },
    expected: {
      sceneId,
      sceneVersion,
      width,
      height,
      maxTextureSize: 8192,
    },
  };
}

function mutateCaptureTranslation(
  frame: VisionCompositionFrame,
  sequence: number,
): void {
  const capture = frame.captures[0]!;
  const x = 20 + (sequence % 1000);
  const y = 30 + (sequence % 700);
  capture.localToOwner[4] = x;
  capture.localToOwner[5] = y;
  capture.localToWorld[4] = x;
  capture.localToWorld[5] = y;
  frame.pixelRevision = String(sequence + 5);
  frame.layoutProjectionRevision = String(sequence + 3);
}

function revisionOnly(frame: VisionCompositionFrame): VisionCompositionFrame {
  return {
    ...frame,
    pixelRevision: frame.pixelRevision,
    layoutProjectionRevision: frame.layoutProjectionRevision,
  };
}

function stateHash(sequence: number): string {
  return `sha256:${sequence.toString(16).padStart(64, "0")}`;
}

function planContent(
  projection: ReturnType<typeof projectNativeCompositionFrame>,
  source: {
    resource: string;
    scene_id: string;
    scene_version: string;
    stateHash: string;
  },
) {
  return {
    schema: "solar.native-composition.plan/1" as const,
    coordinateSpace: projection.coordinateSpace,
    atlasSize: structuredClone(projection.atlasSize),
    source: structuredClone(source),
    viewport: structuredClone(projection.viewport),
    groups: structuredClone(projection.groups),
    surfaces: structuredClone(projection.surfaces),
  };
}

for (const captureCount of [1, 64, 1024]) {
  describe(`${captureCount}-capture receipt, one x/y scalar mutation`, () => {
    const full = makeFixture(captureCount);
    let fullPrevious = revisionOnly(full.frame);
    let fullSequence = 0;
    bench(
      "presenter accept + strict projector accept + projection + plan hash",
      () => {
        fullSequence++;
        mutateCaptureTranslation(full.frame, fullSequence);
        const accepted = acceptVisionCompositionFrame(
          full.frame,
          full.expected,
          fullPrevious,
        );
        const projection = projectNativeCompositionFrame(
          accepted,
          full.expected,
        );
        const plan = withNativeCompositionSource(
          projection,
          "solar-host-a-benchmark",
          {
            resource: "solar/lane-a",
            scene_id: sceneId,
            scene_version: sceneVersion,
            stateHash: stateHash(fullSequence),
          },
        );
        const capture = plan.groups[0]?.children.find(
          (child) => child.kind === "capture",
        );
        if (
          capture?.kind !== "capture" ||
          capture.affine.tx !== 20 + (fullSequence % 1000)
        )
          throw new Error("Capture translation was not projected.");
        fullPrevious = revisionOnly(accepted);
      },
      benchOptions,
    );

    const receipt = makeFixture(captureCount);
    let receiptPrevious = revisionOnly(receipt.frame);
    let receiptSequence = 0;
    bench(
      "presenter receipt validation only",
      () => {
        receiptSequence++;
        mutateCaptureTranslation(receipt.frame, receiptSequence);
        const accepted = acceptVisionCompositionFrame(
          receipt.frame,
          receipt.expected,
          receiptPrevious,
        );
        receiptPrevious = revisionOnly(accepted);
      },
      benchOptions,
    );

    const strict = makeFixture(captureCount);
    let strictSequence = 0;
    bench(
      "strict projector validation plus complete projection",
      () => {
        strictSequence++;
        mutateCaptureTranslation(strict.frame, strictSequence);
        const projection = projectNativeCompositionFrame(
          strict.frame,
          strict.expected,
        );
        if (projection.surfaces.length !== captureCount)
          throw new Error("Composition projection was incomplete.");
      },
      benchOptions,
    );

    const hashFixture = makeFixture(captureCount);
    const hashProjection = projectNativeCompositionFrame(
      hashFixture.frame,
      hashFixture.expected,
    );
    const hashCapture = hashProjection.groups[0]?.children.find(
      (child) => child.kind === "capture",
    );
    if (hashCapture?.kind !== "capture")
      throw new Error("Composition hash fixture has no capture.");
    let hashSequence = 0;
    bench(
      "complete plan clone plus canonical SHA-256",
      () => {
        hashSequence++;
        hashCapture.affine.tx = 20 + (hashSequence % 1000);
        hashCapture.affine.ty = 30 + (hashSequence % 700);
        const plan = withNativeCompositionSource(
          hashProjection,
          "solar-host-a-benchmark",
          {
            resource: "solar/lane-a",
            scene_id: sceneId,
            scene_version: sceneVersion,
            stateHash: stateHash(hashSequence),
          },
        );
        if (plan.surfaces.length !== captureCount)
          throw new Error("Composition plan was incomplete.");
      },
      benchOptions,
    );

    const cloneProjection = projectNativeCompositionFrame(
      makeFixture(captureCount).frame,
      makeFixture(captureCount).expected,
    );
    const cloneCapture = cloneProjection.groups[0]?.children.find(
      (child) => child.kind === "capture",
    );
    if (cloneCapture?.kind !== "capture")
      throw new Error("Composition clone fixture has no capture.");
    let cloneSequence = 0;
    bench(
      "plan content clone only",
      () => {
        cloneSequence++;
        cloneCapture.affine.tx = 20 + (cloneSequence % 1000);
        const content = planContent(cloneProjection, {
          resource: "solar/lane-a",
          scene_id: sceneId,
          scene_version: sceneVersion,
          stateHash: stateHash(cloneSequence),
        });
        if (content.surfaces.length !== captureCount)
          throw new Error("Cloned composition plan was incomplete.");
      },
      benchOptions,
    );

    const canonicalProjection = projectNativeCompositionFrame(
      makeFixture(captureCount).frame,
      makeFixture(captureCount).expected,
    );
    const canonicalCapture = canonicalProjection.groups[0]?.children.find(
      (child) => child.kind === "capture",
    );
    if (canonicalCapture?.kind !== "capture")
      throw new Error("Composition canonicalization fixture has no capture.");
    const canonicalContent = planContent(canonicalProjection, {
      resource: "solar/lane-a",
      scene_id: sceneId,
      scene_version: sceneVersion,
      stateHash: stateHash(0),
    });
    let canonicalSequence = 0;
    bench(
      "canonicalize complete plan only",
      () => {
        canonicalSequence++;
        canonicalCapture.affine.tx = 20 + (canonicalSequence % 1000);
        canonicalContent.groups[0]!.children.find(
          (child) => child.kind === "capture",
        )!.affine.tx = canonicalCapture.affine.tx;
        canonicalContent.source.stateHash = stateHash(canonicalSequence);
        const json = canonicalize(canonicalContent);
        if (json.length === 0) throw new Error("Canonical plan was empty.");
      },
      benchOptions,
    );

    const shaProjection = projectNativeCompositionFrame(
      makeFixture(captureCount).frame,
      makeFixture(captureCount).expected,
    );
    const hashProjectionCapture = shaProjection.groups[0]?.children.find(
      (child) => child.kind === "capture",
    );
    if (hashProjectionCapture?.kind !== "capture")
      throw new Error("Composition SHA fixture has no capture.");
    hashProjectionCapture.affine.tx = 20;
    const hashBytes = new TextEncoder().encode(
      canonicalize(
        planContent(shaProjection, {
          resource: "solar/lane-a",
          scene_id: sceneId,
          scene_version: sceneVersion,
          stateHash: stateHash(1),
        }),
      ),
    );
    bench(
      "SHA-256 canonical plan bytes only",
      () => {
        if (bytesToHex(sha256(hashBytes)).length !== 64)
          throw new Error("Composition SHA-256 was malformed.");
      },
      benchOptions,
    );
  });
}
