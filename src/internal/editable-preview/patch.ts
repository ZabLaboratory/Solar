const EDITABLE_PATCH_PATH =
  /^__editable\.([0-9a-f]+)\.(translate|width|height|visible|opacity|rotation|zIndex|value|fontSize|fontWeight|colour|lineHeight|src|fill|radius|background)$/i;

export interface EditableTranslatePatch {
  componentId: string;
  property: "translate";
  x: number;
  y: number;
}

export interface EditableScalarPatch {
  componentId: string;
  property:
    | "width"
    | "height"
    | "visible"
    | "opacity"
    | "rotation"
    | "zIndex"
    | "value"
    | "fontSize"
    | "fontWeight"
    | "colour"
    | "lineHeight"
    | "src"
    | "fill"
    | "radius"
    | "background";
  value: string | number | boolean;
}

export type EditableFastPatch = EditableTranslatePatch | EditableScalarPatch;

function decodeComponentToken(token: string): string | null {
  if (token.length === 0 || token.length % 2 !== 0 || token.length > 2048) {
    return null;
  }
  const bytes = new Uint8Array(token.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(token.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isInteger(value)) return null;
    bytes[index] = value;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function finiteCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1_000_000
  );
}

export function parseEditableTranslatePatch(
  value: unknown,
): EditableTranslatePatch | null {
  const parsed = parseEditableFastPatch(value);
  return parsed?.property === "translate" ? parsed : null;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function safeString(value: unknown, maximum = 16_384): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function safeColour(value: unknown): value is string {
  return (
    safeString(value, 256) &&
    !/[;{}<>\\]/.test(value) &&
    !/^\s*(?:url|var)\s*\(/i.test(value)
  );
}

function safeMediaSource(value: unknown): value is string {
  if (!safeString(value, 16_384)) return false;
  try {
    const url = new URL(
      value,
      globalThis.location?.href ?? "http://localhost/",
    );
    if (["http:", "https:", "blob:"].includes(url.protocol)) return true;
    return (
      url.protocol === "data:" && /^data:(?:image|audio|video)\//i.test(value)
    );
  } catch {
    return false;
  }
}

export function parseEditableFastPatch(
  value: unknown,
): EditableFastPatch | null {
  if (!value || typeof value !== "object") return null;
  const patch = value as { path?: unknown; value?: unknown };
  if (typeof patch.path !== "string") return null;
  const match = EDITABLE_PATCH_PATH.exec(patch.path);
  if (!match) return null;
  const componentId = decodeComponentToken(match[1] ?? "");
  if (componentId === null) return null;
  const property = match[2] as EditableFastPatch["property"];
  if (property === "translate") {
    if (!Array.isArray(patch.value) || patch.value.length !== 2) return null;
    const [x, y] = patch.value;
    return finiteCoordinate(x) && finiteCoordinate(y)
      ? { componentId, property, x, y }
      : null;
  }
  const candidate = patch.value;
  switch (property) {
    case "width":
    case "height":
      return boundedNumber(candidate, 0, 100_000)
        ? { componentId, property, value: candidate }
        : null;
    case "visible":
      return typeof candidate === "boolean"
        ? { componentId, property, value: candidate }
        : null;
    case "opacity":
      return boundedNumber(candidate, 0, 1)
        ? { componentId, property, value: candidate }
        : null;
    case "rotation":
      return boundedNumber(candidate, -100_000, 100_000)
        ? { componentId, property, value: candidate }
        : null;
    case "zIndex":
      return Number.isInteger(candidate) &&
        boundedNumber(candidate, -1_000_000, 1_000_000)
        ? { componentId, property, value: candidate }
        : null;
    case "fontSize":
      return boundedNumber(candidate, 0, 10_000)
        ? { componentId, property, value: candidate }
        : null;
    case "fontWeight":
      return boundedNumber(candidate, 1, 1_000)
        ? { componentId, property, value: candidate }
        : null;
    case "radius":
      return boundedNumber(candidate, 0, 100_000)
        ? { componentId, property, value: candidate }
        : null;
    case "lineHeight":
      return candidate === "normal" || boundedNumber(candidate, 0, 100)
        ? { componentId, property, value: candidate }
        : null;
    case "colour":
    case "fill":
    case "background":
      return safeColour(candidate)
        ? { componentId, property, value: candidate }
        : null;
    case "src":
      return safeMediaSource(candidate)
        ? { componentId, property, value: candidate }
        : null;
    case "value":
      return safeString(candidate)
        ? { componentId, property, value: candidate }
        : null;
  }
}
