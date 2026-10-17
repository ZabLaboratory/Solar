/** Accepted GPU graph facts from the persistent Vision presenter, never an LSML layout. */
export interface VisionCompositionOwner {
  nodeId: number;
  parentNodeId: number | null;
  paintOrder: number;
  localSize: [number, number];
  localToWorld: [number, number, number, number, number, number];
  opacity: number;
  visible: boolean;
  blendMode: string;
  maskPresent: boolean;
  clipPresent: boolean;
  clipKind: "none" | "viewport-bounds" | "authored";
}

export interface VisionCompositionCapture {
  nodeId: number;
  ownerNodeId: number;
  paintOrder: number;
  localSize: [number, number];
  localToOwner: [number, number, number, number, number, number];
  localToWorld: [number, number, number, number, number, number];
  localOpacity: number;
  visible: boolean;
  effectiveComponentId: string | null;
  liveMediaPath: string | null;
  authoredSize: [number | null, number | null];
  sourceSize: [number, number];
  blendMode: string;
  maskPresent: boolean;
  clipPresent: boolean;
  clipKind: "none" | "image-bounds" | "authored";
  fit: string | null;
  sourceCropPercent: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
  contentBox: {
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
  } | null;
  sourceZoom: number | null;
  objectPosition: { x: number | null; y: number | null } | null;
}

export interface VisionCompositionSurface {
  ownerNodeId: number;
  bandIndex: number;
  paintOrder: number;
  beforeNodeId: number | null;
  afterNodeId: number | null;
  coordinateSpace: "global-scene-texels";
  sceneRect: [number, number, number, number];
  atlasRect: [number, number, number, number];
}

export interface VisionCompositionFrame {
  schema: "vision.native-composition-frame/1";
  coordinateSpace: "global-scene-texels";
  sceneId: string;
  sceneVersion: string;
  pixelRevision: string;
  layoutProjectionRevision: string;
  sceneSize: [number, number];
  sceneScale: [number, number];
  atlasSize: [number, number];
  canvasSize: [number, number];
  gpuSubmission: "present-queued";
  physicalPresentation: "not-measured";
  owners: VisionCompositionOwner[];
  captures: VisionCompositionCapture[];
  surfaces: VisionCompositionSurface[];
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const id = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= 3.4028234663852886e38;
const tuple = (
  value: unknown,
  length: number,
  valid = finite,
): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(valid);
const size = (value: unknown): value is number[] =>
  tuple(value, 2, (part): part is number => id(part) && part > 0);
const nullableSize = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((part) => part === null || finite(part));
const opacity = (value: unknown): boolean =>
  finite(value) && value >= 0 && value <= 1;
const nullableId = (value: unknown): boolean => value === null || id(value);
const optionalText = (value: unknown): boolean =>
  value === null ||
  (typeof value === "string" && value.length > 0 && value.length <= 4096);

function appearance(
  value: Record<string, unknown>,
  clipKinds: readonly string[],
): boolean {
  return (
    typeof value.blendMode === "string" &&
    optionalText(value.blendMode) &&
    typeof value.maskPresent === "boolean" &&
    typeof value.clipPresent === "boolean" &&
    typeof value.clipKind === "string" &&
    clipKinds.includes(value.clipKind) &&
    value.clipPresent === (value.clipKind !== "none")
  );
}

function nullableFields(value: unknown, fields: string[]): boolean {
  if (value === null) return true;
  const record = object(value);
  return (
    !!record &&
    fields.every((key) => record[key] === null || finite(record[key]))
  );
}

function framing(value: Record<string, unknown>): boolean {
  const crop = object(value.sourceCropPercent);
  return (
    optionalText(value.fit) &&
    (value.sourceCropPercent === null ||
      (!!crop &&
        [crop.left, crop.top, crop.right, crop.bottom].every(
          (part) => finite(part) && part >= 0 && part <= 99,
        ) &&
        // Rust normalizes with f32 arithmetic; allow its rounding at the 99% boundary.
        (crop.left as number) + (crop.right as number) <= 99.00001 &&
        (crop.top as number) + (crop.bottom as number) <= 99.00001)) &&
    nullableFields(value.contentBox, ["x", "y", "width", "height"]) &&
    (value.sourceZoom === null || finite(value.sourceZoom)) &&
    nullableFields(value.objectPosition, ["x", "y"])
  );
}

function invalid(): never {
  throw new Error("VISION_NATIVE_COMPOSITION_FRAME_INVALID");
}

/** Refuse an incompatible/stale receipt before accepting its presented canvas. */
export function acceptVisionCompositionFrame(
  input: unknown,
  expected: {
    sceneId: string;
    sceneVersion: string;
    width: number;
    height: number;
  },
  previous?: VisionCompositionFrame | null,
): VisionCompositionFrame {
  const frame = object(input);
  if (
    !frame ||
    frame.schema !== "vision.native-composition-frame/1" ||
    frame.coordinateSpace !== "global-scene-texels" ||
    frame.gpuSubmission !== "present-queued" ||
    frame.physicalPresentation !== "not-measured" ||
    frame.sceneId !== expected.sceneId ||
    frame.sceneVersion !== expected.sceneVersion ||
    !size(frame.sceneSize) ||
    frame.sceneSize[0] !== expected.width ||
    frame.sceneSize[1] !== expected.height ||
    !tuple(
      frame.sceneScale,
      2,
      (part): part is number => finite(part) && part > 0,
    ) ||
    !size(frame.canvasSize) ||
    !tuple(frame.atlasSize, 2, id) ||
    ![frame.pixelRevision, frame.layoutProjectionRevision].every(
      (part) => typeof part === "string" && /^(0|[1-9][0-9]{0,19})$/.test(part),
    ) ||
    !Array.isArray(frame.owners) ||
    !Array.isArray(frame.captures) ||
    !Array.isArray(frame.surfaces) ||
    frame.owners.length + frame.captures.length + frame.surfaces.length > 100000
  )
    invalid();
  if (
    previous &&
    (BigInt(frame.pixelRevision as string) < BigInt(previous.pixelRevision) ||
      BigInt(frame.layoutProjectionRevision as string) <
        BigInt(previous.layoutProjectionRevision))
  )
    throw new Error("VISION_NATIVE_COMPOSITION_FRAME_STALE");
  const empty = frame.atlasSize[0] === 0 && frame.atlasSize[1] === 0;
  if (
    (frame.atlasSize[0] === 0) !== (frame.atlasSize[1] === 0) ||
    frame.canvasSize[0] !== (empty ? 1 : frame.atlasSize[0]) ||
    frame.canvasSize[1] !== (empty ? 1 : frame.atlasSize[1]) ||
    empty !== (frame.surfaces.length === 0)
  )
    invalid();
  const owners = new Map<number, Record<string, unknown>>();
  for (const raw of frame.owners) {
    const owner = object(raw);
    if (
      !owner ||
      !id(owner.nodeId) ||
      owners.has(owner.nodeId) ||
      !nullableId(owner.parentNodeId) ||
      !id(owner.paintOrder) ||
      !tuple(
        owner.localSize,
        2,
        (part): part is number => finite(part) && part > 0,
      ) ||
      !tuple(owner.localToWorld, 6) ||
      !opacity(owner.opacity) ||
      typeof owner.visible !== "boolean" ||
      !appearance(owner, ["none", "viewport-bounds", "authored"])
    )
      invalid();
    owners.set(owner.nodeId, owner);
  }
  let roots = 0;
  const resolved = new Set<number>();
  for (const [nodeId, owner] of owners) {
    if (owner.parentNodeId === null) roots++;
    const visited = new Set<number>([nodeId]);
    let parent = owner.parentNodeId;
    while (parent !== null && !resolved.has(parent as number)) {
      if (!id(parent) || visited.has(parent)) invalid();
      visited.add(parent);
      const ancestor = owners.get(parent);
      if (!ancestor) invalid();
      parent = ancestor.parentNodeId;
    }
    for (const seen of visited) resolved.add(seen);
  }
  if (owners.size > 0 && roots !== 1) invalid();
  const captures = new Set<number>();
  for (const raw of frame.captures) {
    const capture = object(raw);
    if (
      !capture ||
      !id(capture.nodeId) ||
      captures.has(capture.nodeId) ||
      owners.has(capture.nodeId) ||
      !id(capture.ownerNodeId) ||
      !owners.has(capture.ownerNodeId) ||
      !id(capture.paintOrder) ||
      !tuple(
        capture.localSize,
        2,
        (part): part is number => finite(part) && part > 0,
      ) ||
      !tuple(capture.localToOwner, 6) ||
      !tuple(capture.localToWorld, 6) ||
      !opacity(capture.localOpacity) ||
      typeof capture.visible !== "boolean" ||
      !optionalText(capture.effectiveComponentId) ||
      !optionalText(capture.liveMediaPath) ||
      !nullableSize(capture.authoredSize) ||
      !size(capture.sourceSize) ||
      !appearance(capture, ["none", "image-bounds", "authored"]) ||
      !framing(capture)
    )
      invalid();
    captures.add(capture.nodeId);
  }
  const bands = new Set<string>();
  for (const raw of frame.surfaces) {
    const surface = object(raw);
    if (
      !surface ||
      !id(surface.ownerNodeId) ||
      !owners.has(surface.ownerNodeId) ||
      !id(surface.bandIndex) ||
      !id(surface.paintOrder) ||
      !nullableId(surface.beforeNodeId) ||
      !nullableId(surface.afterNodeId) ||
      surface.coordinateSpace !== "global-scene-texels" ||
      !tuple(surface.sceneRect, 4, id) ||
      !tuple(surface.atlasRect, 4, id)
    )
      invalid();
    const key = `${surface.ownerNodeId}:${surface.bandIndex}`;
    const scene = surface.sceneRect,
      atlas = surface.atlasRect;
    if (
      bands.has(key) ||
      scene[2]! < 1 ||
      scene[3]! < 1 ||
      scene[2] !== atlas[2] ||
      scene[3] !== atlas[3] ||
      scene[0]! + scene[2]! > expected.width ||
      scene[1]! + scene[3]! > expected.height ||
      atlas[0]! + atlas[2]! > frame.canvasSize[0]! ||
      atlas[1]! + atlas[3]! > frame.canvasSize[1]!
    )
      invalid();
    for (const boundary of [surface.beforeNodeId, surface.afterNodeId])
      if (
        boundary !== null &&
        (!id(boundary) || (!owners.has(boundary) && !captures.has(boundary)))
      )
        invalid();
    bands.add(key);
  }
  return input as VisionCompositionFrame;
}
