import {
  acceptVisionCompositionFrame,
  type VisionCompositionCapture,
  type VisionCompositionFrame,
  type VisionCompositionOwner,
} from "../engine/vision-composition-frame";
import {
  NATIVE_COMPOSITION_ROOT_ID,
  type NativeCompositionAffine,
  type NativeCompositionChild,
  type NativeCompositionGroup,
  type NativeCompositionProjection,
  type NativeCompositionRect,
  type NativeCompositionSurface as ProjectedSurface,
} from "./native-composition-contracts";

export { NATIVE_COMPOSITION_ROOT_ID } from "./native-composition-contracts";
export type {
  NativeCompositionAffine,
  NativeCompositionChild,
  NativeCompositionGroup,
  NativeCompositionPlan,
  NativeCompositionProjection,
  NativeCompositionRect,
  NativeCompositionSource,
  NativeCompositionSurface,
} from "./native-composition-contracts";
export { withNativeCompositionSource } from "./native-composition-plan";

const identityAffine = (): NativeCompositionAffine => ({
  m00: 1,
  m01: 0,
  tx: 0,
  m10: 0,
  m11: 1,
  ty: 0,
});

const nativeOwnerId = (nodeId: number, rootNodeId: number): string =>
  nodeId === rootNodeId ? NATIVE_COMPOSITION_ROOT_ID : `vision.owner.${nodeId}`;
const captureComponentId = (nodeId: number): string =>
  `vision.capture.${nodeId}`;

function rect(values: [number, number, number, number]): NativeCompositionRect {
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function affine(
  values: [number, number, number, number, number, number],
): NativeCompositionAffine {
  const [a, b, c, d, tx, ty] = values;
  return { m00: a, m01: c, tx, m10: b, m11: d, ty };
}

function assertSupportedAppearance(
  item: VisionCompositionOwner | VisionCompositionCapture,
  kind: "owner" | "capture",
  rootOwner = false,
): void {
  if (item.maskPresent)
    throw new Error(
      `NATIVE_COMPOSITION_UNSUPPORTED_MASK:${kind}:${item.nodeId}`,
    );
  const supportedClipKind =
    kind === "capture"
      ? item.clipKind === "image-bounds"
      : rootOwner && item.clipKind === "viewport-bounds";
  if (item.clipPresent && !supportedClipKind)
    throw new Error(
      `NATIVE_COMPOSITION_UNSUPPORTED_CLIP:${kind}:${item.nodeId}:${item.clipKind}`,
    );
  if (item.blendMode !== "normal")
    throw new Error(
      `NATIVE_COMPOSITION_UNSUPPORTED_BLEND:${kind}:${item.nodeId}:${item.blendMode}`,
    );
}

interface OrderedChild {
  paintOrder: number;
  sequence: number;
  nodeId: number | null;
  beforeNodeId?: number | null;
  afterNodeId?: number | null;
  child: NativeCompositionChild;
}

function insertChild(
  groups: Map<number | null, OrderedChild[]>,
  ownerNodeId: number | null,
  child: OrderedChild,
): void {
  const children = groups.get(ownerNodeId);
  if (!children) throw new Error("VISION_NATIVE_COMPOSITION_OWNER_MISSING");
  children.push(child);
}

function compareChildren(a: OrderedChild, b: OrderedChild): number {
  if (a.paintOrder !== b.paintOrder) return a.paintOrder - b.paintOrder;
  if (a.nodeId !== null && a.nodeId === b.beforeNodeId) return 1;
  if (b.nodeId !== null && b.nodeId === a.beforeNodeId) return -1;
  if (a.nodeId !== null && a.nodeId === b.afterNodeId) return -1;
  if (b.nodeId !== null && b.nodeId === a.afterNodeId) return 1;
  return a.sequence - b.sequence;
}

/**
 * Project only the exact GPU receipt accepted for the current Vision scene.
 * Raster bands already use global scene texels, so their owner groups stay at
 * identity and captures carry their complete local-to-world affine.
 */
export function projectNativeCompositionFrame(
  input: unknown,
  expected: {
    sceneId: string;
    sceneVersion: string;
    width: number;
    height: number;
    maxTextureSize: number;
  },
): NativeCompositionProjection {
  const frame: VisionCompositionFrame = acceptVisionCompositionFrame(input, {
    sceneId: expected.sceneId,
    sceneVersion: expected.sceneVersion,
    width: expected.width,
    height: expected.height,
  });
  if (
    !Number.isSafeInteger(expected.maxTextureSize) ||
    expected.maxTextureSize < 1 ||
    frame.canvasSize[0] > expected.maxTextureSize ||
    frame.canvasSize[1] > expected.maxTextureSize
  )
    throw new Error(
      `NATIVE_COMPOSITION_SURFACE_LIMIT:${frame.canvasSize[0]}x${frame.canvasSize[1]}:${expected.maxTextureSize}`,
    );

  const owners = new Map<number, VisionCompositionOwner>();
  const nativeIds = new Map<number, string>();
  const depth = new Map<number, number>();
  const rootOwners = frame.owners.filter(
    (owner) => owner.parentNodeId === null,
  );
  if (rootOwners.length !== 1)
    throw new Error("VISION_NATIVE_COMPOSITION_ROOT_OWNER_REQUIRED");
  const rootOwner = rootOwners[0]!;
  for (const owner of frame.owners) {
    assertSupportedAppearance(owner, "owner", owner.parentNodeId === null);
    owners.set(owner.nodeId, owner);
    nativeIds.set(owner.nodeId, nativeOwnerId(owner.nodeId, rootOwner.nodeId));
  }
  const ownerDepth = (nodeId: number, seen = new Set<number>()): number => {
    const cached = depth.get(nodeId);
    if (cached !== undefined) return cached;
    if (seen.has(nodeId))
      throw new Error("VISION_NATIVE_COMPOSITION_OWNER_CYCLE");
    seen.add(nodeId);
    const owner = owners.get(nodeId);
    if (!owner) throw new Error("VISION_NATIVE_COMPOSITION_OWNER_MISSING");
    const result =
      owner.parentNodeId === null
        ? 0
        : ownerDepth(owner.parentNodeId, seen) + 1;
    depth.set(nodeId, result);
    seen.delete(nodeId);
    return result;
  };
  for (const owner of frame.owners) ownerDepth(owner.nodeId);

  const viewport: NativeCompositionRect = {
    x: 0,
    y: 0,
    width: frame.sceneSize[0],
    height: frame.sceneSize[1],
  };
  const projectedOwners = new Map<number, NativeCompositionGroup>();
  const children = new Map<number, OrderedChild[]>();
  let sequence = 0;
  for (const owner of frame.owners) {
    const id = nativeIds.get(owner.nodeId)!;
    const parentId =
      owner.parentNodeId === null ? null : nativeIds.get(owner.parentNodeId)!;
    projectedOwners.set(owner.nodeId, {
      id,
      parentId,
      order: owner.paintOrder,
      opacity: owner.opacity,
      visible: owner.visible,
      blendMode: owner.blendMode,
      bounds: { ...viewport },
      affine: identityAffine(),
      children: [],
      mask: null,
    });
    children.set(owner.nodeId, []);
    if (owner.parentNodeId !== null)
      insertChild(children, owner.parentNodeId, {
        paintOrder: owner.paintOrder,
        sequence: sequence++,
        nodeId: owner.nodeId,
        child: { kind: "group", id },
      });
  }

  const projectedSurfaces: ProjectedSurface[] = [];
  const orderedSurfaces = [...frame.surfaces].sort(
    (a, b) => a.paintOrder - b.paintOrder || a.bandIndex - b.bandIndex,
  );
  for (const [band, surface] of orderedSurfaces.entries()) {
    const ownerId = nativeIds.get(surface.ownerNodeId);
    if (!ownerId) throw new Error("VISION_NATIVE_COMPOSITION_OWNER_MISSING");
    projectedSurfaces.push({
      band,
      ownerId,
      ownerPath: ownerPath(surface.ownerNodeId, owners, nativeIds),
      coordinateSpace: "global-scene-texels",
      rect: rect(surface.sceneRect),
      atlasRect: rect(surface.atlasRect),
      affine: identityAffine(),
    });
    insertChild(children, surface.ownerNodeId, {
      paintOrder: surface.paintOrder,
      sequence: sequence++,
      nodeId: null,
      beforeNodeId: surface.beforeNodeId,
      afterNodeId: surface.afterNodeId,
      child: { kind: "solarBand", band },
    });
  }

  for (const capture of frame.captures) {
    assertSupportedAppearance(capture, "capture");
    if (
      typeof capture.effectiveComponentId !== "string" ||
      capture.effectiveComponentId.trim().length === 0
    )
      throw new Error(
        `NATIVE_COMPOSITION_CAPTURE_SOURCE_COMPONENT_ID_MISSING:${capture.nodeId}`,
      );
    const sourceFraming = {
      fit: capture.fit,
      contentBox: capture.contentBox,
      sourceZoom: capture.sourceZoom,
      objectPosition: capture.objectPosition,
      authoredSize: capture.authoredSize,
      sourceSize: capture.sourceSize,
    };
    insertChild(children, capture.ownerNodeId, {
      paintOrder: capture.paintOrder,
      sequence: sequence++,
      nodeId: capture.nodeId,
      child: {
        kind: "capture",
        componentId: captureComponentId(capture.nodeId),
        sourceComponentId: capture.effectiveComponentId,
        localSize: {
          width: capture.localSize[0],
          height: capture.localSize[1],
        },
        affine: affine(capture.localToWorld),
        localOpacity: capture.localOpacity,
        visible: capture.visible,
        cropPercent: capture.sourceCropPercent ?? {
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
        },
        sourceFraming,
      },
    });
  }

  for (const owner of frame.owners) {
    const destination = children.get(owner.nodeId)!;
    for (const child of destination.sort(compareChildren))
      projectedOwners.get(owner.nodeId)!.children.push(child.child);
  }

  const groups = [
    projectedOwners.get(rootOwner.nodeId)!,
    ...frame.owners
      .filter((owner) => owner.nodeId !== rootOwner.nodeId)
      .slice()
      .sort(
        (a, b) =>
          ownerDepth(a.nodeId) - ownerDepth(b.nodeId) ||
          a.paintOrder - b.paintOrder ||
          a.nodeId - b.nodeId,
      )
      .map((owner) => projectedOwners.get(owner.nodeId)!),
  ];

  return {
    coordinateSpace: "global-scene-texels",
    atlasSize: { width: frame.canvasSize[0], height: frame.canvasSize[1] },
    width: frame.canvasSize[0],
    height: frame.canvasSize[1],
    viewport: { width: frame.sceneSize[0], height: frame.sceneSize[1] },
    groups,
    surfaces: projectedSurfaces,
  };
}

function ownerPath(
  nodeId: number,
  owners: Map<number, VisionCompositionOwner>,
  nativeIds: Map<number, string>,
): string[] {
  const owner = owners.get(nodeId);
  const id = nativeIds.get(nodeId);
  if (!owner || !id) throw new Error("VISION_NATIVE_COMPOSITION_OWNER_MISSING");
  return owner.parentNodeId === null
    ? [NATIVE_COMPOSITION_ROOT_ID]
    : [...ownerPath(owner.parentNodeId, owners, nativeIds), id];
}
