import type { LSMLDocument } from "./native-document";
import {
  NATIVE_COMPOSITION_AUTHORED_ROOT_ID,
  NATIVE_COMPOSITION_ROOT_ID,
  type NativeCompositionGroup,
  type NativeCompositionProjection,
  type NativeCompositionSurface,
} from "./native-composition-contracts";
import {
  affine,
  boundBoolean,
  boundNumber,
  boundString,
  dimensions,
  entries,
  finite,
  identityAffine,
  localMatrix,
  object,
  type NativeCompositionNode,
} from "./native-composition-geometry";
export {
  NATIVE_COMPOSITION_AUTHORED_ROOT_ID,
  NATIVE_COMPOSITION_ROOT_ID,
} from "./native-composition-contracts";
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
type Node = NativeCompositionNode;

function nodeId(node: Node): string {
  return typeof node.id === "string" ? node.id : "";
}

function containsCapture(
  value: unknown,
  active = new Set<Record<string, unknown>>(),
): boolean {
  if (Array.isArray(value))
    return value.some((item) => containsCapture(item, active));
  const node = object(value);
  if (!node) return false;
  if (active.has(node))
    throw new Error("NATIVE_COMPOSITION_CYCLIC_COMPONENT_TREE");
  if (node.kind === "x-zab.capture") return true;
  active.add(node);
  const found =
    entries(node).some((child) => containsCapture(child, active)) ||
    containsCapture(node.template, active);
  active.delete(node);
  return found;
}

function assertAcyclic(
  value: unknown,
  active = new Set<Record<string, unknown>>(),
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => assertAcyclic(item, active));
    return;
  }
  const node = object(value);
  if (!node) return;
  if (active.has(node))
    throw new Error("NATIVE_COMPOSITION_CYCLIC_COMPONENT_TREE");
  active.add(node);
  for (const child of entries(node)) assertAcyclic(child, active);
  assertAcyclic(node.template, active);
  active.delete(node);
}

function findReservedGroupId(
  value: unknown,
  active = new Set<Record<string, unknown>>(),
): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findReservedGroupId(item, active);
      if (found) return found;
    }
    return null;
  }
  const node = object(value);
  if (!node) return null;
  if (active.has(node))
    throw new Error("NATIVE_COMPOSITION_CYCLIC_COMPONENT_TREE");
  if (
    node.id === NATIVE_COMPOSITION_ROOT_ID ||
    node.id === NATIVE_COMPOSITION_AUTHORED_ROOT_ID
  )
    return node.id;
  active.add(node);
  for (const child of entries(node)) {
    const found = findReservedGroupId(child, active);
    if (found) {
      active.delete(node);
      return found;
    }
  }
  const found = findReservedGroupId(node.template, active);
  active.delete(node);
  return found;
}

function maskFor(
  node: Node,
  size: { width: number; height: number },
): Record<string, unknown> | null {
  if (node.mask !== undefined && node.mask !== null)
    return { kind: "component-mask", value: structuredClone(node.mask) };
  if (node.clipsContent === true)
    return {
      kind: "frame-clip",
      width: size.width,
      height: size.height,
      radius: finite(node.cornerRadius, 0, `${nodeId(node)}.cornerRadius`),
    };
  return null;
}

function backgroundKeys(node: Node): boolean {
  return (
    [
      "fill",
      "fills",
      "background",
      "stroke",
      "strokes",
      "shadow",
      "blur",
      "glass",
      "noise",
    ].some((key) => Object.hasOwn(node, key)) ||
    Boolean(object(node.bind)?.fill)
  );
}

function removeBackground(node: Node): void {
  for (const key of [
    "fill",
    "fills",
    "background",
    "stroke",
    "strokes",
    "shadow",
    "blur",
    "glass",
    "noise",
  ])
    delete node[key];
  const bind = object(node.bind);
  if (bind) {
    delete bind.fill;
    node.bind = bind;
  }
}

function cloneOwnerLayer(
  owner: Node,
  children: unknown[],
  includeBackground: boolean,
): Node {
  const layer = structuredClone(owner);
  layer.children = structuredClone(children);
  delete layer.id;
  layer.position = { x: 0, y: 0 };
  layer.rotation = 0;
  layer.opacity = 1;
  layer.visible = true;
  layer.blendMode = "normal";
  delete layer.transform;
  // These properties belong to the compositor owner. Keeping them on every
  // raster page would apply authored root/frame clipping twice.
  delete layer.mask;
  delete layer.clipsContent;
  delete layer.cornerRadius;
  const bind = object(layer.bind);
  if (bind) {
    for (const key of [
      "position.x",
      "position.y",
      "rotation",
      "opacity",
      "visible",
      "blendMode",
    ])
      delete bind[key];
    layer.bind = bind;
  }
  if (!includeBackground) removeBackground(layer);
  return layer;
}

/**
 * Split the private Vision document into owner-local Solar surfaces and return
 * the same ordered group graph that Main can hand to Pulsar. Only fixed-size
 * LSML frames can own nested captures; unresolved auto-layout is rejected
 * rather than approximated by a second layout engine.
 */
export function prepareNativeComposition(
  document: LSMLDocument,
  viewport: { width: number; height: number },
  maxTextureSize: number,
): NativeCompositionProjection {
  if (
    !Number.isSafeInteger(viewport.width) ||
    viewport.width < 1 ||
    !Number.isSafeInteger(viewport.height) ||
    viewport.height < 1 ||
    !Number.isSafeInteger(maxTextureSize) ||
    maxTextureSize < 1
  )
    throw new Error("NATIVE_COMPOSITION_SURFACE_LIMIT_UNAVAILABLE");
  const authoredLayout = object(document.layout);
  if (!authoredLayout) throw new Error("NATIVE_COMPOSITION_ROOT_INVALID");
  const root = structuredClone(authoredLayout);
  assertAcyclic(root);
  const reservedId = findReservedGroupId(root);
  if (reservedId)
    throw new Error(`NATIVE_COMPOSITION_RESERVED_GROUP_ID:${reservedId}`);
  root.size ??= { w: viewport.width, h: viewport.height };
  if (
    root.kind === "stack" &&
    root.direction === undefined &&
    Array.isArray(root.children) &&
    root.children.length === 0
  )
    root.direction = "vertical";
  if (!containsCapture(root)) {
    document.layout = root;
    return {
      width: viewport.width,
      height: viewport.height,
      viewport: { ...viewport },
      groups: [],
      surfaces: [],
      geometryBindings: [],
      rebuildBindings: [],
    };
  }

  const defaults = document.defaults ?? {};
  const geometryBindings = new Set<string>();
  const rebuildBindings = new Set<string>();
  const surfaces: NativeCompositionSurface[] = [];
  const groups: NativeCompositionGroup[] = [];
  const pages: Array<{
    owner: Node;
    children: unknown[];
    includeBackground: boolean;
    surface: NativeCompositionSurface;
  }> = [];
  const ids = new Set<string>();
  const authoredIds = new Set<string>();
  const captures = new Set<string>();
  let atlasY = 0;
  let atlasWidth = viewport.width;

  const hasAnyCapture = (node: Node): boolean => containsCapture(node);
  const generatedGroupId = (path: string[]): string =>
    `solar.native-composition.group.${path.join(".")}`;
  const pushSurface = (
    owner: Node,
    ownerId: string,
    ownerPath: string[],
    rootOwner: boolean,
    size: { width: number; height: number },
    children: unknown[],
    includeBackground: boolean,
    group: NativeCompositionGroup,
  ): void => {
    const band = surfaces.length;
    const rect = {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    };
    const atlasRect = {
      x: 0,
      y: atlasY,
      width: size.width,
      height: size.height,
    };
    const surface: NativeCompositionSurface = {
      band,
      ownerId,
      ownerPath: [...ownerPath],
      coordinateSpace: rootOwner ? "scene-root" : "group-local",
      rect,
      atlasRect,
      affine: { ...identityAffine },
    };
    surfaces.push(surface);
    pages.push({ owner, children, includeBackground, surface });
    group.children.push({ kind: "solarBand", band });
    atlasY += size.height;
    atlasWidth = Math.max(atlasWidth, size.width);
  };

  const processOwner = (
    owner: Node,
    ownerId: string,
    ownerPath: string[],
    parentGroup: NativeCompositionGroup,
    rootOwner: boolean,
    size: { width: number; height: number },
    path: string[],
    effectiveVisible: boolean,
  ): void => {
    let run: unknown[] = [];
    let separated = false;
    let hadBoundary = false;
    let firstBand = true;
    const flush = (force: boolean): void => {
      if (!force && run.length === 0 && !(firstBand && backgroundKeys(owner)))
        return;
      pushSurface(
        owner,
        ownerId,
        ownerPath,
        rootOwner,
        size,
        run,
        firstBand,
        parentGroup,
      );
      run = [];
      firstBand = false;
      separated = true;
    };
    const children = entries(owner);
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      const childPath = [...path, String(index)];
      const id = nodeId(child);
      if (child.kind === "x-zab.capture") {
        if (!id) throw new Error("NATIVE_COMPOSITION_CAPTURE_ID_MISSING");
        if (captures.has(id))
          throw new Error(`NATIVE_COMPOSITION_DUPLICATE_CAPTURE_ID:${id}`);
        captures.add(id);
        flush(true);
        const crop = object(child.crop) ?? {};
        const cropPercent = {
          left: finite(crop.left, 0, `${id}.crop.left`),
          top: finite(crop.top, 0, `${id}.crop.top`),
          right: finite(crop.right, 0, `${id}.crop.right`),
          bottom: finite(crop.bottom, 0, `${id}.crop.bottom`),
        };
        if (
          Object.values(cropPercent).some(
            (value) => value < 0 || value >= 100,
          ) ||
          cropPercent.left + cropPercent.right >= 100 ||
          cropPercent.top + cropPercent.bottom >= 100
        )
          throw new Error(`NATIVE_COMPOSITION_INVALID_CAPTURE_CROP:${id}`);
        const captureSize = {
          width: boundNumber(
            child,
            "size.w",
            object(child.size)?.w ?? child.width,
            0,
            defaults,
            geometryBindings,
            `${id}.width`,
          ),
          height: boundNumber(
            child,
            "size.h",
            object(child.size)?.h ?? child.height,
            0,
            defaults,
            geometryBindings,
            `${id}.height`,
          ),
        };
        for (const key of ["size.w", "size.h"] as const) {
          const binding = object(child.bind)?.[key];
          if (typeof binding === "string") rebuildBindings.add(binding);
        }
        if (
          !Number.isFinite(captureSize.width) ||
          !Number.isFinite(captureSize.height) ||
          captureSize.width <= 0 ||
          captureSize.height <= 0
        )
          throw new Error(`NATIVE_COMPOSITION_UNRESOLVED_BOUNDS:${id}`);
        const opacity = boundNumber(
          child,
          "opacity",
          child.opacity,
          1,
          defaults,
          geometryBindings,
          `${id}.opacity`,
        );
        const visible = boundBoolean(
          child,
          "visible",
          child.visible,
          true,
          defaults,
          geometryBindings,
          `${id}.visible`,
        );
        if (opacity < 0 || opacity > 1)
          throw new Error(`NATIVE_COMPOSITION_INVALID_OPACITY:${id}`);
        parentGroup.children.push({
          kind: "capture",
          componentId: id,
          localSize: captureSize,
          affine: affine(localMatrix(child, id, defaults, geometryBindings)),
          localOpacity: opacity,
          visible: effectiveVisible && visible,
          cropPercent,
        });
        hadBoundary = true;
        continue;
      }

      if (
        child.kind === "repeat" ||
        child.kind === "stack" ||
        child.kind === "grid"
      ) {
        if (hasAnyCapture(child))
          throw new Error(
            `NATIVE_COMPOSITION_UNRESOLVED_LAYOUT:${id || childPath.join(".")}`,
          );
      }
      if (hasAnyCapture(child)) {
        if (child.kind !== "frame")
          throw new Error(
            `NATIVE_COMPOSITION_UNRESOLVED_LAYOUT:${id || childPath.join(".")}`,
          );
        const groupId = id || generatedGroupId(childPath);
        if (groupId === NATIVE_COMPOSITION_ROOT_ID)
          throw new Error(`NATIVE_COMPOSITION_RESERVED_GROUP_ID:${groupId}`);
        if (!id && authoredIds.has(groupId))
          throw new Error(`NATIVE_COMPOSITION_DUPLICATE_GROUP_ID:${groupId}`);
        if (ids.has(groupId))
          throw new Error(`NATIVE_COMPOSITION_DUPLICATE_GROUP_ID:${groupId}`);
        ids.add(groupId);
        const groupSize = dimensions(
          child,
          groupId,
          defaults,
          geometryBindings,
          rebuildBindings,
        );
        flush(true);
        const opacity = boundNumber(
          child,
          "opacity",
          child.opacity,
          1,
          defaults,
          geometryBindings,
          `${groupId}.opacity`,
        );
        if (opacity < 0 || opacity > 1)
          throw new Error(`NATIVE_COMPOSITION_INVALID_OPACITY:${groupId}`);
        const visible = boundBoolean(
          child,
          "visible",
          child.visible,
          true,
          defaults,
          geometryBindings,
          `${groupId}.visible`,
        );
        const blend = boundString(
          child,
          "blendMode",
          child.blendMode,
          "normal",
          defaults,
          geometryBindings,
          `${groupId}.blendMode`,
        );
        const group: NativeCompositionGroup = {
          id: groupId,
          parentId: parentGroup.id,
          order: parentGroup.children.length,
          opacity,
          visible,
          blendMode: blend,
          bounds: {
            x: 0,
            y: 0,
            width: groupSize.width,
            height: groupSize.height,
          },
          affine: affine(
            localMatrix(child, groupId, defaults, geometryBindings),
          ),
          children: [],
          mask: maskFor(child, groupSize),
        };
        parentGroup.children.push({ kind: "group", id: groupId });
        groups.push(group);
        processOwner(
          child,
          groupId,
          [...ownerPath, groupId],
          group,
          false,
          groupSize,
          childPath,
          effectiveVisible && visible,
        );
        run = [];
        hadBoundary = true;
        continue;
      }

      const blend = boundString(
        child,
        "blendMode",
        child.blendMode,
        "normal",
        defaults,
        geometryBindings,
        `${id || childPath.join(".")}.blendMode`,
      );
      if (hadBoundary && blend !== "normal") {
        if (run.length > 0) flush(true);
        const blendId = `solar.native-composition.blend.${childPath.join(".")}`;
        if (authoredIds.has(blendId))
          throw new Error(`NATIVE_COMPOSITION_DUPLICATE_GROUP_ID:${blendId}`);
        if (ids.has(blendId))
          throw new Error(`NATIVE_COMPOSITION_DUPLICATE_GROUP_ID:${blendId}`);
        ids.add(blendId);
        const blendGroup: NativeCompositionGroup = {
          id: blendId,
          parentId: parentGroup.id,
          order: parentGroup.children.length,
          opacity: 1,
          visible: true,
          blendMode: blend,
          bounds: { x: 0, y: 0, width: size.width, height: size.height },
          affine: { ...identityAffine },
          children: [],
          mask: null,
        };
        parentGroup.children.push({ kind: "group", id: blendId });
        groups.push(blendGroup);
        const isolated = structuredClone(child);
        isolated.blendMode = "normal";
        const bind = object(isolated.bind);
        if (bind) {
          delete bind.blendMode;
          isolated.bind = bind;
        }
        pushSurface(
          owner,
          blendId,
          [...ownerPath, blendId],
          false,
          size,
          [isolated],
          false,
          blendGroup,
        );
        hadBoundary = true;
      } else {
        run.push(child);
      }
    }
    flush(false);
    // A group whose only trailing children are native captures has no final
    // browser surface. Inner empty intervals were emitted before their refs.
    if (
      separated &&
      run.length === 0 &&
      parentGroup.children.at(-1)?.kind === "solarBand"
    ) {
      // `flush(false)` does not add a tail band; this branch documents the
      // intentional absence and leaves all preceding z-order slots intact.
    }
  };

  const collectAuthoredIds = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectAuthoredIds);
      return;
    }
    const node = object(value);
    if (!node) return;
    if (typeof node.id === "string") authoredIds.add(node.id);
    entries(node).forEach(collectAuthoredIds);
    collectAuthoredIds(node.template);
  };
  collectAuthoredIds(root);

  const authoredRootSize = dimensions(
    root,
    NATIVE_COMPOSITION_AUTHORED_ROOT_ID,
    defaults,
    geometryBindings,
    rebuildBindings,
    viewport,
  );
  const rootOpacity = boundNumber(
    root,
    "opacity",
    root.opacity,
    1,
    defaults,
    geometryBindings,
    "root.opacity",
  );
  if (rootOpacity < 0 || rootOpacity > 1)
    throw new Error("NATIVE_COMPOSITION_INVALID_OPACITY:root");
  const rootMatrix = localMatrix(
    root,
    NATIVE_COMPOSITION_ROOT_ID,
    defaults,
    geometryBindings,
  );
  const rootGroup: NativeCompositionGroup = {
    id: NATIVE_COMPOSITION_ROOT_ID,
    parentId: null,
    order: 0,
    opacity: 1,
    visible: true,
    blendMode: "normal",
    bounds: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    affine: { ...identityAffine },
    children: [{ kind: "group", id: NATIVE_COMPOSITION_AUTHORED_ROOT_ID }],
    mask: null,
  };
  const authoredRootGroup: NativeCompositionGroup = {
    id: NATIVE_COMPOSITION_AUTHORED_ROOT_ID,
    parentId: rootGroup.id,
    order: 0,
    opacity: rootOpacity,
    visible: boundBoolean(
      root,
      "visible",
      root.visible,
      true,
      defaults,
      geometryBindings,
      "root.visible",
    ),
    blendMode: boundString(
      root,
      "blendMode",
      root.blendMode,
      "normal",
      defaults,
      geometryBindings,
      "root.blendMode",
    ),
    bounds: {
      x: 0,
      y: 0,
      width: authoredRootSize.width,
      height: authoredRootSize.height,
    },
    affine: affine(rootMatrix),
    children: [],
    mask: maskFor(root, authoredRootSize),
  };
  groups.push(rootGroup);
  groups.push(authoredRootGroup);
  processOwner(
    root,
    authoredRootGroup.id,
    [rootGroup.id, authoredRootGroup.id],
    authoredRootGroup,
    false,
    authoredRootSize,
    [],
    authoredRootGroup.visible,
  );
  // Root belongs first in the canonical array; nested groups were appended
  // during DFS to their paint position.
  if (groups[0] !== rootGroup) {
    groups.splice(groups.indexOf(rootGroup), 1);
    groups.unshift(rootGroup);
  }
  const height = atlasY || viewport.height;
  if (atlasWidth > maxTextureSize || height > maxTextureSize)
    throw new Error(
      `NATIVE_COMPOSITION_SURFACE_LIMIT:${atlasWidth}x${height}:${maxTextureSize}`,
    );

  const atlasChildren = pages.map(
    ({ owner, children, includeBackground, surface }) => {
      const layer = cloneOwnerLayer(owner, children, includeBackground);
      return {
        kind: "frame",
        position: { x: 0, y: surface.atlasRect.y },
        size: { w: surface.rect.width, h: surface.rect.height },
        clipsContent: true,
        children: [layer],
      };
    },
  );
  document.layout = {
    kind: "frame",
    size: { w: atlasWidth, h: height },
    children: atlasChildren,
  };
  return {
    width: atlasWidth,
    height,
    viewport: { ...viewport },
    groups,
    surfaces,
    geometryBindings: [...geometryBindings].sort(),
    rebuildBindings: [...rebuildBindings].sort(),
  };
}

/** Return the exact changed defaults that require rebuilding local surface pages. */
export function nativeCompositionRequiresRebuild(
  plan: NativeCompositionProjection | null | undefined,
  patch: Record<string, unknown>,
): boolean {
  if (!plan || plan.surfaces.length === 0) return false;
  const bound = new Set(plan.rebuildBindings);
  return Object.keys(patch).some((path) => bound.has(path));
}
