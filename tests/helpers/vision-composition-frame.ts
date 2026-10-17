import type { VisionCompositionFrame } from "../../src/engine/vision-composition-frame";

/** GPU receipt fixture only: no layout or raster implementation. */
export function compositionFrame(): VisionCompositionFrame {
  return {
    schema: "vision.native-composition-frame/1",
    coordinateSpace: "global-scene-texels",
    sceneId: "scene",
    sceneVersion: "v1",
    pixelRevision: "4",
    layoutProjectionRevision: "2",
    sceneSize: [1920, 1080],
    sceneScale: [2, 2],
    atlasSize: [1922, 1082],
    canvasSize: [1922, 1082],
    gpuSubmission: "present-queued",
    physicalPresentation: "not-measured",
    owners: [
      {
        nodeId: 0,
        parentNodeId: null,
        paintOrder: 0,
        localSize: [960, 540],
        localToWorld: [2, 0, 0, 2, 0, 0],
        opacity: 1,
        visible: true,
        blendMode: "normal",
        maskPresent: false,
        clipPresent: false,
      },
    ],
    captures: [
      {
        nodeId: 2,
        ownerNodeId: 0,
        paintOrder: 2,
        localSize: [320, 180],
        localToOwner: [1, 0, 0, 1, 10, 20],
        localToWorld: [2, 0, 0, 2, 20, 40],
        localOpacity: 0.75,
        visible: true,
        effectiveComponentId: "camera",
        liveMediaPath: "live/camera",
        sourceSize: [320, 180],
        blendMode: "normal",
        maskPresent: false,
        clipPresent: false,
        fit: "cover",
        sourceCropPercent: { left: 0, top: 10, right: 0, bottom: 15 },
        contentBox: { x: 5, y: null, width: 300, height: null },
        sourceZoom: 1.5,
        objectPosition: { x: 0.25, y: null },
      },
    ],
    surfaces: [
      {
        ownerNodeId: 0,
        bandIndex: 0,
        paintOrder: 1,
        beforeNodeId: 2,
        afterNodeId: null,
        coordinateSpace: "global-scene-texels",
        sceneRect: [0, 0, 1920, 1080],
        atlasRect: [1, 1, 1920, 1080],
      },
    ],
  };
}
