import type { NativeCompositionAffine } from "./native-composition-contracts";

export type NativeCompositionNode = Record<string, unknown>;
export type NativeCompositionMatrix = [
  [number, number, number],
  [number, number, number],
];

export const identityAffine: NativeCompositionAffine = {
  m00: 1,
  m01: 0,
  tx: 0,
  m10: 0,
  m11: 1,
  ty: 0,
};

export function object(value: unknown): NativeCompositionNode | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as NativeCompositionNode)
    : null;
}

export function entries(node: NativeCompositionNode): NativeCompositionNode[] {
  return Array.isArray(node.children)
    ? node.children
        .map(object)
        .filter((value): value is NativeCompositionNode => value !== null)
    : [];
}

export function finite(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`NATIVE_COMPOSITION_INVALID_NUMBER:${label}`);
  return value;
}

export function affine(
  matrix: NativeCompositionMatrix,
): NativeCompositionAffine {
  return {
    m00: matrix[0][0],
    m01: matrix[0][1],
    tx: matrix[0][2],
    m10: matrix[1][0],
    m11: matrix[1][1],
    ty: matrix[1][2],
  };
}

function matrixFrom(
  value: unknown,
  id: string,
): NativeCompositionMatrix | null {
  if (value === undefined || value === null) return null;
  let rows: unknown = value;
  if (
    Array.isArray(value) &&
    value.length === 6 &&
    value.every((entry) => typeof entry === "number")
  ) {
    rows = [value.slice(0, 3), value.slice(3, 6)];
  }
  const candidate = rows as unknown[];
  if (
    !Array.isArray(candidate) ||
    candidate.length !== 2 ||
    !Array.isArray(candidate[0]) ||
    candidate[0].length !== 3 ||
    !Array.isArray(candidate[1]) ||
    candidate[1].length !== 3 ||
    ![...candidate[0], ...candidate[1]].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )
  )
    throw new Error(`NATIVE_COMPOSITION_INVALID_AFFINE:${id}`);
  return [
    [
      candidate[0][0] as number,
      candidate[0][1] as number,
      candidate[0][2] as number,
    ],
    [
      candidate[1][0] as number,
      candidate[1][1] as number,
      candidate[1][2] as number,
    ],
  ];
}

export function boundNumber(
  node: NativeCompositionNode,
  bindKey: string,
  direct: unknown,
  fallback: number,
  defaults: Record<string, unknown>,
  dependencies: Set<string>,
  label: string,
): number {
  const binding = object(node.bind)?.[bindKey];
  if (typeof binding === "string") {
    dependencies.add(binding);
    if (Object.hasOwn(defaults, binding))
      return finite(defaults[binding], fallback, `${label}:${binding}`);
    throw new Error(`NATIVE_COMPOSITION_BOUND_VALUE_MISSING:${binding}`);
  }
  return finite(direct, fallback, label);
}

export function boundBoolean(
  node: NativeCompositionNode,
  bindKey: string,
  direct: unknown,
  fallback: boolean,
  defaults: Record<string, unknown>,
  dependencies: Set<string>,
  label: string,
): boolean {
  const binding = object(node.bind)?.[bindKey];
  if (typeof binding === "string") {
    dependencies.add(binding);
    if (!Object.hasOwn(defaults, binding))
      throw new Error(`NATIVE_COMPOSITION_BOUND_VALUE_MISSING:${binding}`);
    const value = defaults[binding];
    if (typeof value !== "boolean")
      throw new Error(`NATIVE_COMPOSITION_INVALID_BOOLEAN:${label}:${binding}`);
    return value;
  }
  if (direct === undefined) return fallback;
  if (typeof direct !== "boolean")
    throw new Error(`NATIVE_COMPOSITION_INVALID_BOOLEAN:${label}`);
  return direct;
}

export function boundString(
  node: NativeCompositionNode,
  bindKey: string,
  direct: unknown,
  fallback: string,
  defaults: Record<string, unknown>,
  dependencies: Set<string>,
  label: string,
): string {
  const binding = object(node.bind)?.[bindKey];
  if (typeof binding === "string") {
    dependencies.add(binding);
    if (!Object.hasOwn(defaults, binding))
      throw new Error(`NATIVE_COMPOSITION_BOUND_VALUE_MISSING:${binding}`);
    const value = defaults[binding];
    if (typeof value !== "string")
      throw new Error(`NATIVE_COMPOSITION_INVALID_STRING:${label}:${binding}`);
    return value;
  }
  if (direct === undefined) return fallback;
  if (typeof direct !== "string")
    throw new Error(`NATIVE_COMPOSITION_INVALID_STRING:${label}`);
  return direct;
}

export function dimensions(
  node: NativeCompositionNode,
  id: string,
  defaults: Record<string, unknown>,
  dependencies: Set<string>,
  rebuildDependencies: Set<string>,
  viewport?: { width: number; height: number },
): { width: number; height: number } {
  const size = object(node.size);
  const widthBinding = object(node.bind)?.["size.w"];
  const heightBinding = object(node.bind)?.["size.h"];
  if (typeof widthBinding === "string") rebuildDependencies.add(widthBinding);
  if (typeof heightBinding === "string") rebuildDependencies.add(heightBinding);
  const width = boundNumber(
    node,
    "size.w",
    size?.w ?? node.width,
    viewport?.width ?? 0,
    defaults,
    dependencies,
    `${id}.width`,
  );
  const height = boundNumber(
    node,
    "size.h",
    size?.h ?? node.height,
    viewport?.height ?? 0,
    defaults,
    dependencies,
    `${id}.height`,
  );
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  )
    throw new Error(`NATIVE_COMPOSITION_UNRESOLVED_BOUNDS:${id}`);
  return { width, height };
}

export function localMatrix(
  node: NativeCompositionNode,
  id: string,
  defaults: Record<string, unknown>,
  dependencies: Set<string>,
): NativeCompositionMatrix {
  const imported = matrixFrom(node.transform, id);
  if (imported) return imported;
  const size = object(node.size);
  const width = boundNumber(
    node,
    "size.w",
    size?.w ?? node.width,
    0,
    defaults,
    dependencies,
    `${id}.width`,
  );
  const height = boundNumber(
    node,
    "size.h",
    size?.h ?? node.height,
    0,
    defaults,
    dependencies,
    `${id}.height`,
  );
  const position = object(node.position);
  const x = boundNumber(
    node,
    "position.x",
    position?.x ?? node.x,
    0,
    defaults,
    dependencies,
    `${id}.x`,
  );
  const y = boundNumber(
    node,
    "position.y",
    position?.y ?? node.y,
    0,
    defaults,
    dependencies,
    `${id}.y`,
  );
  const rotation = boundNumber(
    node,
    "rotation",
    node.rotation,
    0,
    defaults,
    dependencies,
    `${id}.rotation`,
  );
  if (!rotation)
    return [
      [1, 0, x],
      [0, 1, y],
    ];
  if (width <= 0 || height <= 0)
    throw new Error(`NATIVE_COMPOSITION_UNRESOLVED_BOUNDS:${id}`);
  const cx = width / 2;
  const cy = height / 2;
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // LSML rotates around the center of the authored frame, matching Prism's
  // component geometry projection while keeping all ancestor transforms local.
  return [
    [cos, -sin, x + cx - cos * cx + sin * cy],
    [sin, cos, y + cy - sin * cx - cos * cy],
  ];
}
