import type { LSMLDocument } from "../scenes/native-document";

type RecordValue = Record<string, unknown>;
export interface AnimationAsset {
  target: string;
  keyframes: { duration_ms: number; easing?: string; steps: RecordValue[] };
}
export type AnimationFrame = { target: string; values: Record<string, number> };
export const animationLeaf = (target: string, property: string): string =>
  `__solar.animation.${encodeURIComponent(target)}.${property}`;
const object = (value: unknown): RecordValue | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : null;
const channels = new Set(["opacity", "rotation", "rotate", "blur", "translateX", "translateY", "x", "y", "scale", "scaleX", "scaleY"]);

function values(step: RecordValue): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [property, raw] of Object.entries(step)) {
    if (property === "at") continue;
    let name = property, value = raw;
    if (property === "filter") {
      const match = typeof raw === "string" && /^blur\(([\d.]+)px\)$/.exec(raw);
      if (!match) throw new Error("Vision animation filter must be blur(px).");
      name = "blur"; value = Number(match[1]);
    }
    if (!channels.has(name) || typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`Unsupported Vision animation channel: ${property}`);
    if (name.startsWith("scale") && value < 0) throw new Error("Negative animation scale is unsupported.");
    result[name === "rotate" ? "rotation" : name] = value;
  }
  return result;
}
export function animationAssets(document: LSMLDocument): Record<string, AnimationAsset> {
  const catalogue = object(document.animations) ?? object(object(document.layout)?.animations) ?? {};
  const result: Record<string, AnimationAsset> = {};
  for (const [id, raw] of Object.entries(catalogue)) {
    const asset = object(raw), keyframes = object(asset?.keyframes);
    if (typeof asset?.target !== "string" || !keyframes || !Array.isArray(keyframes.steps) ||
      typeof keyframes.duration_ms !== "number" || !Number.isFinite(keyframes.duration_ms) || keyframes.duration_ms < 0 || keyframes.steps.length < 1)
      throw new Error(`Invalid LSML animation: ${id}`);
    eased(0, String(keyframes.easing ?? "linear"));
    let previous = -1;
    for (const rawStep of keyframes.steps) {
      const step = object(rawStep);
      if (!step || typeof step.at !== "number" || !Number.isFinite(step.at) || step.at < previous || step.at < 0 || step.at > 1)
        throw new Error(`Invalid animation keyframe: ${id}`);
      values(step); previous = step.at;
    }
    result[id] = asset as unknown as AnimationAsset;
  }
  return result;
}
function eased(t: number, easing: string): number {
  if (easing === "linear") return t;
  const named: Record<string, number[]> = {
    ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1],
  };
  const match = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+)\s*\)$/.exec(easing);
  const curve = named[easing] ?? (match ? match.slice(1).map(Number) : null);
  if (!curve || curve.some(value => !Number.isFinite(value)) || curve[0]! < 0 || curve[0]! > 1 || curve[2]! < 0 || curve[2]! > 1)
    throw new Error(`Unsupported animation easing: ${easing}`);
  if (t === 0 || t === 1) return t;
  const bezier = (u: number, a: number, b: number): number => 3 * (1-u)**2 * u * a + 3 * (1-u) * u**2 * b + u**3;
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    if (bezier(middle, curve[0]!, curve[2]!) < t) low = middle;
    else high = middle;
  }
  return bezier((low + high) / 2, curve[1]!, curve[3]!);
}
export function sampleAnimation(asset: AnimationAsset, progress: number): Record<string, number> {
  const result: Record<string, number> = {};
  const steps = asset.keyframes.steps.map(step => ({ at: step.at as number, values: values(step) }));
  const properties = new Set(steps.flatMap(step => Object.keys(step.values)));
  for (const property of properties) {
    const points = steps.filter(step => Object.hasOwn(step.values, property));
    const right = points.find(point => point.at >= progress) ?? points.at(-1)!;
    const left = [...points].reverse().find(point => point.at <= progress) ?? points[0]!;
    const interval = right.at - left.at;
    const phase = interval > 0 ? eased(Math.max(0, Math.min(1, (progress - left.at) / interval)), asset.keyframes.easing ?? "linear") : 0;
    result[property] = left.values[property]! + (right.values[property]! - left.values[property]!) * phase;
  }
  return result;
}
function visit(value: unknown, callback: (node: RecordValue) => void): void {
  if (Array.isArray(value)) { value.forEach(item => visit(item, callback)); return; }
  const node = object(value); if (!node) return;
  callback(node);
  if (node.children) visit(node.children, callback);
  if (node.template) visit(node.template, callback);
}
function coordinate(document: LSMLDocument, node: RecordValue, axis: "x" | "y"): number {
  const bind = object(node.bind);
  const path = bind?.[`position.${axis}`];
  const value = typeof path === "string" ? document.defaults?.[path] : object(node.position)?.[axis];
  return typeof value === "number" ? value : 0;
}

/** Translation offsets become bound absolute coordinates in the retained scene. */
export function animationPatch(document: LSMLDocument, frames: readonly AnimationFrame[]): Record<string, number> {
  const nodes = new Map<string, RecordValue>();
  visit(document.layout, node => { if (typeof node.id === "string") nodes.set(node.id, node); });
  const patch: Record<string, number> = {};
  for (const frame of frames) {
    const node = nodes.get(frame.target);
    if (!node) throw new Error(`Animation target not found: ${frame.target}`);
    for (const property of ["opacity", "rotation", "blur"])
      if (frame.values[property] !== undefined) patch[animationLeaf(frame.target, property)] = frame.values[property]!;
    patch[animationLeaf(frame.target, "x")] = coordinate(document, node, "x") + (frame.values.translateX ?? frame.values.x ?? 0);
    patch[animationLeaf(frame.target, "y")] = coordinate(document, node, "y") + (frame.values.translateY ?? frame.values.y ?? 0);
  }
  return patch;
}
/** Private bindings only: the original published LSML remains untouched. */
export function prepareAnimationBindings(document: LSMLDocument): Record<string, string> {
  const aliases: Record<string, string> = {};
  const targets = new Set(Object.values(animationAssets(document)).map(asset => asset.target));
  const defaults = document.defaults ??= {};
  const found = new Set<string>();
  visit(document.layout, node => {
    if (typeof node.id !== "string" || !targets.has(node.id)) return;
    found.add(node.id);
    const bind = object(node.bind) ?? {};
    for (const property of ["opacity", "rotation", "blur"]) {
      const existing = typeof bind[property] === "string" ? defaults[bind[property] as string] : node[property];
      const path = animationLeaf(node.id, property);
      if (typeof bind[property] === "string" && bind[property] !== path) aliases[path] = bind[property] as string;
      defaults[path] = typeof existing === "number" ? existing : property === "opacity" ? 1 : 0;
      bind[property] = path;
    }
    for (const axis of ["x", "y"] as const) {
      const path = animationLeaf(node.id, axis);
      const original = bind[`position.${axis}`];
      defaults[path] = coordinate(document, node, axis);
      if (typeof original === "string" && original !== path) aliases[path] = original;
      bind[`position.${axis}`] = path;
    }
    node.bind = bind;
  });
  for (const target of targets) if (!found.has(target)) throw new Error(`Animation target not found: ${target}`);
  return aliases;
}
export function hasGeometry(frame: AnimationFrame): boolean {
  return Object.keys(frame.values).some(key => key.startsWith("scale"));
}
/** Geometry channels use the existing source-preserving Vision scene swap. */
export function animationDocument(document: LSMLDocument, frames: readonly AnimationFrame[]): LSMLDocument {
  const variant = structuredClone(document);
  // The package preparer owns private bindings. Adding them before an empty
  // animation snapshot changes the retention key of an otherwise identical source.
  if (frames.length === 0) return variant;
  prepareAnimationBindings(variant);
  Object.assign(variant.defaults!, animationPatch(document, frames));
  for (const frame of frames) {
    for (const property of ["opacity", "rotation", "blur"]) if (frame.values[property] !== undefined)
      variant.defaults![animationLeaf(frame.target, property)] = frame.values[property];
    visit(variant.layout, node => {
      if (node.id !== frame.target) return;
      const base = object(node.position) ?? {};
      node.position = {
        x: Number(base.x ?? 0) + (frame.values.translateX ?? frame.values.x ?? 0),
        y: Number(base.y ?? 0) + (frame.values.translateY ?? frame.values.y ?? 0),
      };
      const sx = frame.values.scaleX ?? frame.values.scale ?? 1;
      const sy = frame.values.scaleY ?? frame.values.scale ?? 1;
      if (sx < 0 || sy < 0) throw new Error("Negative animation scale is unsupported.");
      if (sx !== 1 || sy !== 1) visit(node, child => {
        const size = object(child.size); if (size) child.size = { ...size, w: Number(size.w) * sx, h: Number(size.h) * sy };
        const position = object(child.position); if (position && child !== node) child.position = { ...position, x: Number(position.x ?? 0) * sx, y: Number(position.y ?? 0) * sy };
        const style = object(child.style); if (style && typeof style.fontSize === "number") child.style = { ...style, fontSize: style.fontSize * sy };
      });
    });
  }
  return variant;
}

/** One queued GPU submission at a time; replay, replacement and teardown are bounded. */
export class VisionAnimations {
  private document: LSMLDocument | null = null;
  private readonly seen = new Map<string, string>();
  private readonly playing = new Map<string, { asset: AnimationAsset; started: number }>();
  private readonly frames = new Map<string, AnimationFrame>();
  private scheduled: number | null = null;
  private inFlight = false;
  private generation = 0;
  private stopped = false;
  constructor(private readonly apply: (frames: readonly AnimationFrame[]) => Promise<void>, private readonly error: (error: unknown) => void) {}
  update(document: LSMLDocument): void {
    if (this.document?.scene_id !== document.scene_id || this.document?.scene_version !== document.scene_version) this.reset();
    this.document = document;
    const assets = animationAssets(document);
    for (const [key, raw] of Object.entries(document.defaults ?? {})) {
      if (!key.startsWith("__animation.")) continue;
      const command = object(raw); if (!command) throw new Error("Invalid Blue animation command.");
      const identity = JSON.stringify(command);
      if (this.seen.get(key) === identity) continue;
      const asset = assets[String(command.animation_id)];
      if (!asset) throw new Error(`Blue animation not declared: ${String(command.animation_id)}`);
      this.seen.set(key, identity);
      this.playing.set(asset.target, { asset, started: performance.now() });
    }
    const targets = new Set(Object.values(assets).map(asset => asset.target));
    for (const target of this.frames.keys()) if (!targets.has(target)) this.frames.delete(target);
    for (const target of this.playing.keys()) if (!targets.has(target)) this.playing.delete(target);
    if (!this.stopped && this.playing.size && this.scheduled === null && !this.inFlight) this.schedule();
  }
  private schedule(): void {
    const generation = this.generation;
    this.scheduled = requestAnimationFrame(now => {
      this.scheduled = null;
      if (this.stopped || generation !== this.generation) return;
      for (const [target, play] of this.playing) {
        const progress = play.asset.keyframes.duration_ms === 0 ? 1 : Math.min(1, (now - play.started) / play.asset.keyframes.duration_ms);
        this.frames.set(target, { target, values: sampleAnimation(play.asset, progress) });
        if (progress >= 1) this.playing.delete(target);
      }
      this.inFlight = true;
      void this.apply([...this.frames.values()]).catch(error => {
        if (generation === this.generation) { this.playing.clear(); this.error(error); }
      }).finally(() => {
        this.inFlight = false;
        if (!this.stopped && this.playing.size && this.scheduled === null) this.schedule();
      });
    });
  }
  current(document?: LSMLDocument): readonly AnimationFrame[] {
    if (!document) return [...this.frames.values()];
    if (this.document?.scene_id !== document.scene_id || this.document?.scene_version !== document.scene_version) return [];
    const targets = new Set(Object.values(animationAssets(document)).map(asset => asset.target));
    return [...this.frames.values()].filter(frame => targets.has(frame.target));
  }
  private reset(): void {
    this.generation++;
    if (this.scheduled !== null) cancelAnimationFrame(this.scheduled);
    this.scheduled = null; this.playing.clear(); this.frames.clear(); this.seen.clear();
  }
  dispose(): void { this.stopped = true; this.reset(); this.document = null; }
  clear(): void { this.reset(); this.document = null; }
}
