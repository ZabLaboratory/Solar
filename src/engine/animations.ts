import type { LSMLDocument } from "../scenes/native-document";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  compileCatalogue,
  channelRange,
  scalarChannels,
  colorChannels,
  waveChannels,
  transformChannels,
  type AnimationFrame,
} from "./motion/timeline";
import { record, type MotionValue } from "./motion/curves";
export { VisionAnimations } from "./motion/player";
export { animationAssets, sampleAnimation } from "./motion/timeline";
export type { AnimationAsset, AnimationFrame } from "./motion/timeline";
type RecordValue = Record<string, unknown>;
export const animationLeaf = (target: string, property: string): string =>
  `__solar.animation.${/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(target) ? target : "n" + bytesToHex(sha256(new TextEncoder().encode(target))).slice(0, 63)}.${property}`;
function visit(value: unknown, callback: (node: RecordValue) => void): void {
  if (Array.isArray(value)) {
    value.forEach((v) => visit(v, callback));
    return;
  }
  const node = record(value);
  if (!node) return;
  callback(node);
  if (node.children) visit(node.children, callback);
  if (node.template) visit(node.template, callback);
}
const nativeProperty = (channel: string): string =>
  waveChannels.includes(channel) || transformChannels.includes(channel)
    ? `x-vision.${channel}`
    : channel.startsWith("shadow")
      ? `shadow.0.${channel.slice(6).toLowerCase()}`
      : channel === "strokeWidth"
        ? "stroke.width"
        : channel === "strokeColor"
          ? "stroke.color"
          : channel;
function base(
  document: LSMLDocument,
  node: RecordValue,
  property: string,
): MotionValue {
  const bind = record(node.bind),
    original = bind?.[property];
  const nested = property.split(".");
  const raw =
    typeof original === "string"
      ? document.defaults?.[original]
      : property.startsWith("x-vision.")
        ? node[property]
        : property.startsWith("shadow.0.")
          ? record(Array.isArray(node.shadow) ? node.shadow[0] : undefined)?.[
              nested[2]!
            ]
          : nested.length === 2
            ? record(node[nested[0]!])?.[nested[1]!]
            : node[property];
  if (typeof raw === "number" || typeof raw === "string") return raw;
  return property === "opacity" ||
    property.endsWith("scaleX") ||
    property.endsWith("scaleY")
    ? 1
    : property.endsWith("anchorX") || property.endsWith("anchorY")
      ? 0.5
      : property.endsWith("waveWavelength")
        ? 720
        : colorChannels.includes(property) ||
            property === "stroke.color" ||
            property === "shadow.0.color"
          ? "#00000000"
          : 0;
}
function targets(document: LSMLDocument): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const plan of Object.values(compileCatalogue(document)))
    for (const clip of plan.clips) {
      const properties =
        result.get(clip.target) ??
        new Set<string>(["opacity", "rotation", "blur", "x", "y"]);
      for (const track of clip.tracks) properties.add(track.property);
      if ([...properties].some((p) => waveChannels.includes(p)))
        for (const p of waveChannels) properties.add(p);
      result.set(clip.target, properties);
    }
  return result;
}
/** Private bindings only; source document/asset identity remains authoritative. */
export function prepareAnimationBindings(
  document: LSMLDocument,
): Record<string, string> {
  const aliases: Record<string, string> = {},
    wanted = targets(document),
    found = new Set<string>(),
    defaults = (document.defaults ??= {});
  visit(document.layout, (node) => {
    if (typeof node.id !== "string" || !wanted.has(node.id)) return;
    found.add(node.id);
    const bind = record(node.bind) ?? {};
    for (const channel of wanted.get(node.id)!) {
      if (channel === "pathProgress") continue;
      if (waveChannels.includes(channel) && node.kind !== "image")
        throw new Error("Wave animation requires an image target.");
      if (channel === "fill" && node.kind !== "shape")
        throw new Error("fill animation requires a shape target");
      if (channel === "background" && node.kind !== "frame")
        throw new Error("background animation requires a frame target");
      if (
        ["strokeWidth", "strokeColor"].includes(channel) &&
        !record(node.stroke)
      )
        throw new Error("Stroke animation requires an authored stroke");
      if (
        channel.startsWith("shadow") &&
        !(Array.isArray(node.shadow) && record(node.shadow[0]))
      )
        throw new Error("Shadow animation requires an authored first shadow");
      const normalized =
        channel === "translateX"
          ? "x"
          : channel === "translateY"
            ? "y"
            : channel;
      const property = ["x", "y"].includes(normalized)
        ? `position.${normalized}`
        : nativeProperty(normalized);
      const path = animationLeaf(node.id, normalized),
        original = bind[property];
      defaults[path] = base(document, node, property);
      if (typeof original === "string" && original !== path)
        aliases[path] = original;
      bind[property] = path;
    }
    node.bind = bind;
  });
  for (const target of wanted.keys())
    if (!found.has(target))
      throw new Error(`Animation target not found: ${target}`);
  return aliases;
}
/** Offsets use current source coordinates; omitted/cancelled channels restore source values. */
export function animationPatch(
  document: LSMLDocument,
  frames: readonly AnimationFrame[],
  resetMissing = false,
): Record<string, MotionValue> {
  const nodes = new Map<string, RecordValue>();
  visit(document.layout, (node) => {
    if (typeof node.id === "string") nodes.set(node.id, node);
  });
  const merged = new Map<string, AnimationFrame>();
  if (resetMissing)
    for (const [target, properties] of targets(document)) {
      const node = nodes.get(target);
      if (!node) throw new Error(`Animation target not found: ${target}`);
      const values: Record<string, MotionValue> = {};
      for (const channel of properties)
        if (scalarChannels.includes(channel) || colorChannels.includes(channel))
          values[channel] = base(document, node, nativeProperty(channel));
      merged.set(target, { target, values });
    }
  for (const frame of frames) {
    const existing = merged.get(frame.target) ?? {
      target: frame.target,
      values: {},
    };
    Object.assign(existing.values, frame.values);
    merged.set(frame.target, existing);
  }
  const patch: Record<string, MotionValue> = {};
  for (const frame of merged.values()) {
    const node = nodes.get(frame.target);
    if (!node) throw new Error(`Animation target not found: ${frame.target}`);
    for (const property of [...scalarChannels, ...colorChannels])
      if (frame.values[property] !== undefined) {
        let value = frame.values[property]!;
        if (typeof value === "number") {
          const [low, high] = channelRange(property);
          value = Math.max(low, Math.min(high, value));
        }
        patch[animationLeaf(frame.target, property)] = value;
      }
    // Legacy manually supplied scale frames remain compatible with retained scale axes.
    if (frame.values.scale !== undefined)
      for (const axis of ["scaleX", "scaleY"])
        patch[animationLeaf(frame.target, axis)] =
          frame.values[axis] ?? frame.values.scale;
    patch[animationLeaf(frame.target, "x")] =
      Number(base(document, node, "position.x")) +
      Number(frame.values.translateX ?? frame.values.x ?? 0);
    patch[animationLeaf(frame.target, "y")] =
      Number(base(document, node, "position.y")) +
      Number(frame.values.translateY ?? frame.values.y ?? 0);
  }
  return patch;
}
/** Structural reloads carry the active sampled state through the same private bindings. */
export function animationDocument(
  document: LSMLDocument,
  frames: readonly AnimationFrame[],
): LSMLDocument {
  const variant = structuredClone(document);
  if (!frames.length) return variant;
  prepareAnimationBindings(variant);
  Object.assign(variant.defaults!, animationPatch(document, frames, true));
  return variant;
}
