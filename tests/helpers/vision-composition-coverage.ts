import type { VisionCompositionFrame } from "../../src/engine/vision-composition-frame";
import { compositionFrame } from "./vision-composition-frame";

/** Same-frame atlas fixture: one paint cell and two full-viewport coverage cells. */
export function compositionCoverageFrame(): VisionCompositionFrame {
  const frame = compositionFrame();
  frame.schema = "vision.native-composition-frame/2";
  frame.atlasSize = [1922, 3246];
  frame.canvasSize = [1922, 3246];
  frame.owners[0]!.maskPresent = true;
  frame.owners[0]!.maskSurfaceIndex = 0;
  frame.captures[0]!.maskPresent = true;
  frame.captures[0]!.maskSurfaceIndex = 1;
  frame.coverageSurfaces = [0, 2].map((targetNodeId, index) => ({
    targetNodeId,
    coordinateSpace: "global-scene-texels",
    sceneRect: [0, 0, 1920, 1080],
    atlasRect: [1, 1 + (index + 1) * 1082, 1920, 1080],
  }));
  return frame;
}
