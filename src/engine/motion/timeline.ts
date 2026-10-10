import type { LSMLDocument } from "../../scenes/native-document";
import { morphPath, parseMorphPath } from "./vector";
import {
  curve,
  finite,
  interpolate,
  record,
  rgba,
  type MotionValue,
} from "./curves";

export interface AnimationAsset {
  target: string;
  keyframes: {
    duration_ms: number;
    easing?: unknown;
    steps: Record<string, unknown>[];
  };
  motion_path?: unknown;
}
export type AnimationFrame = {
  target: string;
  values: Record<string, MotionValue>;
};
type Track = { property: string; sample: (progress: number) => MotionValue };
export interface Clip {
  target: string;
  start: number;
  duration: number;
  tracks: Track[];
}
export interface MotionPlan {
  duration: number;
  clips: Clip[];
}
/** Standard LSML 1.1 primitive keyframes; repeat instances need scoped native identities. */
export function nodeAnimations(
  document: LSMLDocument,
): { id: string; asset: AnimationAsset; identity: string }[] {
  const result: { id: string; asset: AnimationAsset; identity: string }[] = [];
  function visit(raw: unknown, repeated = false): void {
    if (Array.isArray(raw)) {
      raw.forEach((v) => visit(v, repeated));
      return;
    }
    const node = record(raw);
    if (!node) return;
    if (node.keyframes !== undefined) {
      if (repeated || node.kind === "repeat")
        throw new Error(
          "Primitive keyframes in repeat require scoped instance animation support",
        );
      if (typeof node.id !== "string")
        throw new Error("Primitive keyframes require a stable node id");
      const keyframes = record(node.keyframes),
        steps = keyframes?.steps;
      if (
        !keyframes ||
        !Array.isArray(steps) ||
        record(steps[0])?.at !== 0 ||
        record(steps.at(-1))?.at !== 1
      )
        throw new Error("Primitive keyframes require endpoints at 0 and 1");
      if (keyframes.key !== undefined && typeof keyframes.key !== "string")
        throw new Error("Invalid primitive keyframes key");
      result.push({
        id: `node:${node.id}`,
        asset: {
          target: node.id,
          keyframes: keyframes as unknown as AnimationAsset["keyframes"],
        },
        identity: JSON.stringify(
          typeof keyframes.key === "string"
            ? (document.defaults?.[keyframes.key] ?? null)
            : "mount",
        ),
      });
    }
    visit(node.children, repeated || node.kind === "repeat");
    visit(node.template, true);
  }
  visit(document.layout);
  return result;
}
export const waveChannels = [
  "waveAmplitude",
  "wavePhase",
  "waveWavelength",
  "waveHarmonic",
];
export const transformChannels = [
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "anchorX",
  "anchorY",
];
export const scalarChannels = [
  "trimStart",
  "trimEnd",
  "opacity",
  "rotation",
  "blur",
  "backdropBlur",
  "strokeWidth",
  "shadowBlur",
  "shadowX",
  "shadowY",
  "shadowSpread",
  ...transformChannels,
  ...waveChannels,
];
export const colorChannels = [
  "fill",
  "background",
  "strokeColor",
  "shadowColor",
];
export const vectorChannels = ["pathData"];
const channels = new Set([
  ...vectorChannels,
  ...scalarChannels,
  ...colorChannels,
  "scale",
  "translateX",
  "translateY",
  "x",
  "y",
  "pathProgress",
]);
export function channelRange(channel: string): [number, number] {
  let low = -1e6,
    high = 1e6;
  if (channel.startsWith("scale")) {
    low = 0;
    high = 64;
  }
  if (channel.startsWith("skew")) {
    low = -88;
    high = 88;
  }
  if (channel.startsWith("anchor")) {
    low = -16;
    high = 16;
  }
  if (["opacity", "pathProgress", "trimStart", "trimEnd"].includes(channel)) {
    low = 0;
    high = 1;
  }
  if (["blur", "backdropBlur", "strokeWidth", "shadowBlur"].includes(channel)) {
    low = 0;
    high = 256;
  }
  if (channel === "waveWavelength") {
    low = 4;
    high = 1e6;
  }
  if (channel === "waveAmplitude") {
    low = -4096;
    high = 4096;
  }
  if (channel === "waveHarmonic") {
    low = -1;
    high = 1;
  }
  return [low, high];
}
export function values(
  step: Record<string, unknown>,
): Record<string, MotionValue> {
  const result: Record<string, MotionValue> = {};
  const expanded = { ...step };
  const transform = record(step.transform),
    filter = record(step.filter);
  if (transform) {
    for (const key of Object.keys(transform))
      if (!["translate", "scale", "rotate"].includes(key))
        throw new Error(`Unsupported transform channel: ${key}`);
    if (transform.translate !== undefined) {
      if (
        !Array.isArray(transform.translate) ||
        transform.translate.length !== 2
      )
        throw new Error("Invalid transform.translate");
      [expanded.translateX, expanded.translateY] = transform.translate;
    }
    if (transform.rotate !== undefined) expanded.rotation = transform.rotate;
    if (Array.isArray(transform.scale)) {
      if (transform.scale.length !== 2)
        throw new Error("Invalid transform.scale");
      [expanded.scaleX, expanded.scaleY] = transform.scale;
    } else if (transform.scale !== undefined) expanded.scale = transform.scale;
  }
  if (filter) {
    for (const key of Object.keys(filter))
      if (key !== "blur")
        throw new Error(`Unsupported Vision animation filter: ${key}`);
    expanded.blur = filter.blur;
  } else if (step.filter !== undefined) {
    const match =
      typeof step.filter === "string" &&
      /^blur\(([\d.]+)px\)$/.exec(step.filter);
    if (!match) throw new Error("Vision animation filter must be blur(px).");
    expanded.blur = Number(match[1]);
  }
  for (const [rawName, raw] of Object.entries(expanded)) {
    if (["at", "easing", "transform", "filter"].includes(rawName)) continue;
    const name = rawName === "rotate" ? "rotation" : rawName;
    if (!channels.has(name))
      throw new Error(`Unsupported Vision animation channel: ${rawName}`);
    if (name === "pathData") {
      parseMorphPath(raw);
      result[name] = raw as string;
      continue;
    }
    if (colorChannels.includes(name)) {
      if (typeof raw !== "string") throw new Error("Invalid animation color");
      rgba(raw);
      result[name] = raw;
      continue;
    }
    const [low, high] = channelRange(name);
    try {
      result[name] = finite(raw, name, low, high);
    } catch {
      throw new Error(`Animation channel ${name} out of range.`);
    }
  }
  if (result.scale !== undefined) {
    result.scaleX ??= result.scale;
    result.scaleY ??= result.scale;
    delete result.scale;
  }
  return result;
}
const samples = new WeakMap<AnimationAsset, Track[]>();
function tracks(asset: AnimationAsset): Track[] {
  const cached = samples.get(asset);
  if (cached) return cached;
  const duration = finite(asset.keyframes.duration_ms, "duration", 0, 600000);
  if (
    !Array.isArray(asset.keyframes.steps) ||
    !asset.keyframes.steps.length ||
    asset.keyframes.steps.length > 32768
  )
    throw new Error("Invalid animation keyframes");
  let last = -1;
  const steps = asset.keyframes.steps.map((raw) => {
    if (!record(raw)) throw new Error("Invalid animation keyframe object");
    const at = finite(raw.at, "keyframe at", 0, 1);
    if (at < last) throw new Error("Invalid animation keyframe order");
    last = at;
    return { at, values: values(raw), easing: raw.easing };
  });
  // Validate curves even on a one-point or unused channel.
  curve(asset.keyframes.easing ?? "linear", duration);
  const properties = new Set(steps.flatMap((s) => Object.keys(s.values)));
  for (const step of steps) {
    if (step.easing === undefined) continue;
    const overrides = record(step.easing);
    if (!overrides || overrides.type === "spring") curve(step.easing, duration);
    else
      for (const [property, easing] of Object.entries(overrides)) {
        if (!channels.has(property) && property !== "rotate")
          throw new Error(`Unsupported easing channel: ${property}`);
        curve(easing, duration);
      }
  }
  const result = [...properties].map((property) => {
    const points = steps.filter((s) => Object.hasOwn(s.values, property));
    const segments = points.slice(1).map((right, i) => {
      const left = points[i]!;
      const overrides = record(left.easing);
      const easing =
        overrides && overrides.type !== "spring"
          ? (overrides[property] ??
            (property.startsWith("scale")
              ? overrides.scale
              : property === "rotation"
                ? overrides.rotate
                : undefined) ??
            asset.keyframes.easing)
          : (left.easing ?? asset.keyframes.easing);
      return {
        start: left.at,
        end: right.at,
        ease: curve(easing ?? "linear", (right.at - left.at) * duration),
        value:
          property === "pathData"
            ? morphPath(
                left.values[property] as string,
                right.values[property] as string,
              )
            : interpolate(left.values[property]!, right.values[property]!),
      };
    });
    return {
      property,
      sample: (progress: number): MotionValue => {
        if (progress < points[0]!.at) return points[0]!.values[property]!;
        // Upper-bound search: duplicate times select the last authored value.
        let low = 0,
          high = points.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          // Milliseconds -> normalized phase can round one ulp below an authored
          // boundary. Hold/discontinuous tracks must still select that pose.
          if (points[mid]!.at <= progress + Number.EPSILON * 4) low = mid + 1;
          else high = mid;
        }
        if (low >= points.length) return points.at(-1)!.values[property]!;
        const segment = segments[low - 1]!;
        return segment.value(
          segment.ease(
            Math.max(
              0,
              (progress - segment.start) / (segment.end - segment.start),
            ),
          ),
        );
      },
    };
  });
  samples.set(asset, result);
  return result;
}
export function sampleAnimation(
  asset: AnimationAsset,
  progress: number,
): Record<string, MotionValue> {
  return Object.fromEntries(
    tracks(asset).map((track) => [
      track.property,
      track.sample(Math.max(0, Math.min(1, progress))),
    ]),
  );
}
function motionPath(raw: unknown, duration: number): Track[] {
  const path = record(raw);
  if (!path) throw new Error("Invalid motion_path");
  if (
    !Array.isArray(path.points) ||
    path.points.length < 4 ||
    (path.points.length - 1) % 3 ||
    path.points.length > 193
  )
    throw new Error(
      "Motion path requires cubic points (3n+1), at most 64 curves",
    );
  if (path.orient !== undefined && typeof path.orient !== "boolean")
    throw new Error("Invalid path orient");
  const points = path.points.map((p) => {
    if (!Array.isArray(p) || p.length !== 2)
      throw new Error("Invalid path point");
    return [finite(p[0], "path x"), finite(p[1], "path y")] as const;
  });
  const ease = curve(path.easing ?? "linear", duration),
    count = (points.length - 1) / 3;
  const component = (phase: number, axis: number, tangent = false) => {
    const u = Math.max(0, Math.min(1, ease(phase))) * count,
      index = Math.min(count - 1, Math.floor(u)) * 3,
      t = Math.min(1, u - index / 3);
    const [a, b, c, d] = points.slice(index, index + 4).map((p) => p[axis]!);
    return tangent
      ? 3 *
          ((1 - t) ** 2 * (b! - a!) +
            2 * (1 - t) * t * (c! - b!) +
            t * t * (d! - c!))
      : (1 - t) ** 3 * a! +
          3 * (1 - t) ** 2 * t * b! +
          3 * (1 - t) * t * t * c! +
          t ** 3 * d!;
  };
  const result: Track[] = [0, 1].map((axis) => ({
    property: axis === 0 ? "translateX" : "translateY",
    sample: (p) => component(p, axis),
  }));
  if (path.orient)
    result.push({
      property: "rotation",
      sample: (p) =>
        (Math.atan2(component(p, 1, true), component(p, 0, true)) * 180) /
        Math.PI,
    });
  return result;
}
export function animationAssets(
  document: LSMLDocument,
): Record<string, AnimationAsset> {
  const catalogue =
    record(document.animations) ??
    record(record(document.layout)?.animations) ??
    {};
  compileCatalogue(document);
  return Object.fromEntries(
    Object.entries(catalogue).filter(
      ([, v]) => typeof record(v)?.target === "string",
    ),
  ) as Record<string, AnimationAsset>;
}
const catalogueCache = new WeakMap<object, Record<string, MotionPlan>>();
// Native worker snapshots clone unchanged catalogue objects. Retain one bounded
// accepted definition by content so a defaults-only command cannot force a full
// vector compilation on the first playback frame. The per-document weak cache
// remains the hot path; changed catalogue/primitive definitions compile normally.
let latestCatalogue:
  | { signature: string; plans: Record<string, MotionPlan> }
  | undefined;
const documentCache = new WeakMap<
  LSMLDocument,
  { source: unknown; layout: unknown; plans: Record<string, MotionPlan> }
>();
export function compileCatalogue(
  document: LSMLDocument,
): Record<string, MotionPlan> {
  const source =
    record(document.animations) ?? record(record(document.layout)?.animations);
  const existing = documentCache.get(document);
  if (
    existing &&
    existing.source === source &&
    existing.layout === document.layout
  )
    return existing.plans;
  const automatic = nodeAnimations(document);
  const catalogue = automatic.length
    ? {
        ...source,
        ...Object.fromEntries(automatic.map((n) => [n.id, n.asset])),
      }
    : (source ?? {});
  const cached = catalogueCache.get(catalogue);
  if (cached) return cached;
  if (Object.keys(catalogue).length > 512)
    throw new Error("Motion catalogue budget exceeded");
  const signature = JSON.stringify(catalogue);
  if (latestCatalogue?.signature === signature) {
    const plans = latestCatalogue.plans;
    catalogueCache.set(catalogue, plans);
    documentCache.set(document, { source, layout: document.layout, plans });
    return plans;
  }
  const plans: Record<string, MotionPlan> = Object.create(null),
    active = new Set<string>();
  let budget = 0,
    vectorBudget = 0;
  function compile(raw: unknown, depth: number): MotionPlan {
    if (depth > 16) throw new Error("Motion composition depth exceeded");
    if (typeof raw === "string") {
      if (active.has(raw)) throw new Error(`Cyclic motion reference: ${raw}`);
      if (plans[raw]) return plans[raw];
      if (!Object.hasOwn(catalogue, raw))
        throw new Error(`Unknown motion reference: ${raw}`);
      active.add(raw);
      const plan = compile(catalogue[raw], depth + 1);
      active.delete(raw);
      return (plans[raw] = plan);
    }
    const item = record(raw);
    if (!item) throw new Error("Invalid LSML animation");
    const modes = ["animation", "sequence", "parallel", "target"].filter(
      (k) => item[k] !== undefined,
    );
    if (modes.length !== 1)
      throw new Error(
        "Motion requires exactly one leaf, reference or composition",
      );
    const allowed =
      modes[0] === "target"
        ? ["target", "keyframes", "delay_ms", "motion_path"]
        : modes[0] === "animation"
          ? ["animation", "delay_ms"]
          : ["sequence", "parallel", "delay_ms", "stagger_ms"];
    for (const key of Object.keys(item))
      if (!allowed.includes(key))
        throw new Error(`Unsupported motion field: ${key}`);
    const delay = finite(item.delay_ms ?? 0, "delay", 0, 600000);
    if (item.animation !== undefined) {
      const plan = compile(item.animation, depth + 1);
      return {
        duration: delay + plan.duration,
        clips: plan.clips.map((c) => ({ ...c, start: c.start + delay })),
      };
    }
    if (item.sequence !== undefined || item.parallel !== undefined) {
      if (item.sequence !== undefined && item.parallel !== undefined)
        throw new Error("Motion cannot be sequence and parallel");
      const children = item.sequence ?? item.parallel;
      if (!Array.isArray(children) || !children.length)
        throw new Error("Empty motion composition");
      const stagger = finite(item.stagger_ms ?? 0, "stagger", 0, 600000);
      if (item.sequence && stagger !== 0)
        throw new Error("stagger_ms applies to parallel compositions");
      let total = 0;
      const clips: Clip[] = [];
      children.forEach((child, i) => {
        const plan = compile(child, depth + 1),
          offset = item.sequence ? total : i * stagger;
        clips.push(
          ...plan.clips.map((c) => ({ ...c, start: delay + offset + c.start })),
        );
        total = item.sequence
          ? total + plan.duration
          : Math.max(total, offset + plan.duration);
      });
      if (clips.length > 2048 || total + delay > 600000)
        throw new Error("Motion composition budget exceeded");
      return { duration: total + delay, clips };
    }
    if (typeof item.target !== "string" || !record(item.keyframes))
      throw new Error("Invalid LSML animation target/keyframes");
    const asset = item as unknown as AnimationAsset,
      duration = finite(asset.keyframes.duration_ms, "duration", 0, 600000);
    if (Array.isArray(asset.keyframes.steps))
      for (const step of asset.keyframes.steps) {
        const path = record(step)?.pathData;
        if (typeof path === "string") vectorBudget += path.length;
      }
    if (vectorBudget > 4 * 1024 * 1024)
      throw new Error("Motion vector catalogue budget exceeded");
    let compiled = tracks(asset);
    budget += asset.keyframes.steps.length;
    if (budget > 32768) throw new Error("Motion keyframe budget exceeded");
    if (asset.motion_path !== undefined) {
      if (
        compiled.some((t) =>
          ["translateX", "translateY", "x", "y"].includes(t.property),
        )
      )
        throw new Error("Motion path conflicts with translation keyframes");
      const path = motionPath(asset.motion_path, duration),
        progress = compiled.find((t) => t.property === "pathProgress");
      compiled = [
        ...compiled.filter(
          (t) =>
            t.property !== "pathProgress" &&
            !(
              asset.motion_path &&
              record(asset.motion_path)?.orient &&
              t.property === "rotation"
            ),
        ),
        ...path.map((t) => ({
          ...t,
          sample: (p: number) =>
            t.sample(progress ? Number(progress.sample(p)) : p),
        })),
      ];
    } else if (compiled.some((t) => t.property === "pathProgress"))
      throw new Error("pathProgress requires motion_path");
    return {
      duration: delay + duration,
      clips: [
        { target: asset.target, start: delay, duration, tracks: compiled },
      ],
    };
  }
  for (const id of Object.keys(catalogue)) compile(id, 0);
  catalogueCache.set(catalogue, plans);
  latestCatalogue = { signature, plans };
  documentCache.set(document, { source, layout: document.layout, plans });
  return plans;
}
export function samplePlan(plan: MotionPlan, time: number): AnimationFrame[] {
  const targets = new Map<string, AnimationFrame>();
  for (const clip of plan.clips) {
    if (time < clip.start) continue;
    const frame = targets.get(clip.target) ?? {
      target: clip.target,
      values: {},
    };
    const phase =
      clip.duration === 0
        ? 1
        : Math.max(0, Math.min(1, (time - clip.start) / clip.duration));
    for (const track of clip.tracks)
      frame.values[track.property] = track.sample(phase);
    targets.set(clip.target, frame);
  }
  return [...targets.values()];
}
