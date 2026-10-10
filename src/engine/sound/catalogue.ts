import type { LSMLDocument } from "../../scenes/native-document";
import { compileCatalogue } from "../motion/timeline";
import { finite, record } from "../motion/curves";

export type Keys = { at_ms: number; value: number }[];
export interface Effect {
  type: string;
  [key: string]: unknown;
}
export interface Bus {
  id: string;
  output: string;
  gain_db: number;
  pan: number;
  effects: Effect[];
  automation: Record<string, Keys>;
}
export interface Cue {
  id: string;
  asset: string;
  bus: string;
  start: number;
  duration: number;
  offset: number;
  sourceDuration?: number;
  rate: number;
  loop: boolean;
  gain: number;
  pan: number;
  fadeIn: number;
  fadeOut: number;
  automation: Record<string, Keys>;
}
export interface SoundCatalogue {
  assets: Record<string, { src: string; sha256: string }>;
  buses: Bus[];
  shows: Record<string, { duration: number; cues: Cue[] }>;
}
const name = (v: unknown): string => {
  if (typeof v !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(v))
    throw Error("Invalid sound identity");
  return v;
};
function object(v: unknown): Record<string, unknown> {
  const r = record(v);
  if (!r) throw Error("Expected sound object");
  return r;
}
function fields(r: Record<string, unknown>, allowed: string[]): void {
  for (const k of Object.keys(r))
    if (!allowed.includes(k)) throw Error(`Unsupported sound field: ${k}`);
}
export function automation(
  v: unknown,
  duration = 600000,
): Record<string, Keys> {
  if (v === undefined) return {};
  const result: Record<string, Keys> = {};
  for (const [channel, raw] of Object.entries(object(v))) {
    const ranges: Record<string, [number, number]> = {
      gain_db: [-96, 12],
      pan: [-1, 1],
      frequency: [20, 20000],
      wet: [0, 1],
    };
    const range = Object.hasOwn(ranges, channel) ? ranges[channel] : undefined;
    if (!range || !Array.isArray(raw) || !raw.length || raw.length > 256)
      throw Error("Invalid sound automation");
    let previous = -1;
    result[channel] = raw.map((value) => {
      const key = object(value);
      fields(key, ["at_ms", "value"]);
      const at_ms = finite(key.at_ms, "audio automation time", 0, duration);
      if (at_ms <= previous)
        throw Error("Sound automation times must increase");
      previous = at_ms;
      return { at_ms, value: finite(key.value, channel, ...range) };
    });
  }
  return result;
}
export function evaluate(
  keys: Keys | undefined,
  time: number,
  fallback: number,
): number {
  if (!keys?.length) return fallback;
  if (time <= keys[0]!.at_ms) return keys[0]!.value;
  for (let i = 1; i < keys.length; i++)
    if (time <= keys[i]!.at_ms) {
      const a = keys[i - 1]!,
        b = keys[i]!;
      return (
        a.value + ((b.value - a.value) * (time - a.at_ms)) / (b.at_ms - a.at_ms)
      );
    }
  return keys.at(-1)!.value;
}
export const db = (value: number): number => 10 ** (value / 20);
function effects(v: unknown): Effect[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 8)
    throw Error("Sound effect count exceeds eight per bus");
  return v.map((raw) => {
    const e = object(raw),
      type = String(e.type),
      ranges: Record<string, Record<string, [number, number]>> = {
        filter: { frequency: [20, 20000], q: [0.01, 30], gain_db: [-24, 24] },
        compressor: {
          threshold: [-100, 0],
          knee: [0, 40],
          ratio: [1, 20],
          attack: [0, 1],
          release: [0.001, 1],
        },
        delay: { time_ms: [1, 2000], feedback: [0, 0.85], wet: [0, 1] },
        reverb: { wet: [0, 1] },
        distortion: { drive: [0, 50], wet: [0, 1] },
      };
    const bounds = Object.hasOwn(ranges, type) ? ranges[type] : undefined;
    if (!bounds) throw Error(`Unsupported sound effect: ${type}`);
    fields(e, [
      "type",
      ...Object.keys(bounds),
      ...(type === "filter" ? ["kind"] : type === "reverb" ? ["impulse"] : []),
    ]);
    for (const [k, r] of Object.entries(bounds))
      if (e[k] !== undefined) finite(e[k], k, ...r);
    if (
      type === "filter" &&
      ![
        "lowpass",
        "highpass",
        "bandpass",
        "notch",
        "peaking",
        "lowshelf",
        "highshelf",
      ].includes(String(e.kind ?? "lowpass"))
    )
      throw Error("Invalid filter kind");
    if (type === "reverb") name(e.impulse);
    return { ...e, type };
  });
}
/** Explicit experimental LSML extension, strict bounded admission before any voices start. */
export function compileSound(document: LSMLDocument): SoundCatalogue | null {
  const value = document["x-solar.audio"];
  if (value === undefined) return null;
  const root = object(value);
  fields(root, ["version", "assets", "buses", "shows"]);
  if (root.version !== 1) throw Error("Unsupported sound catalogue version");
  const assets: SoundCatalogue["assets"] = Object.create(null);
  const rawAssets = object(root.assets);
  if (Object.keys(rawAssets).length > 32)
    throw Error("Sound asset count exceeds 32");
  for (const [id, raw] of Object.entries(rawAssets)) {
    name(id);
    const a = object(raw);
    fields(a, ["src", "sha256"]);
    if (
      typeof a.src !== "string" ||
      !/^assets\/[a-zA-Z0-9_./-]+\.(wav|mp3|ogg|flac|m4a|aac|webm)$/.test(
        a.src,
      ) ||
      a.src.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw Error("Sound assets must be safe package-local paths");
    if (typeof a.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256))
      throw Error("Sound asset requires SHA-256");
    assets[id] = { src: a.src, sha256: a.sha256 };
  }
  const rawBuses = object(root.buses);
  if (Object.keys(rawBuses).length > 16)
    throw Error("Sound bus count exceeds 16");
  const buses = Object.entries(rawBuses).map(([id, raw]) => {
    name(id);
    const b = object(raw);
    fields(b, ["output", "gain_db", "pan", "effects", "automation"]);
    return {
      id,
      output: id === "master" ? "destination" : name(b.output ?? "master"),
      gain_db: finite(b.gain_db ?? 0, "bus gain", -96, 12),
      pan: finite(b.pan ?? 0, "bus pan", -1, 1),
      effects: effects(b.effects),
      automation: automation(b.automation),
    };
  });
  if (!buses.some((b) => b.id === "master"))
    buses.push({
      id: "master",
      output: "destination",
      gain_db: 0,
      pan: 0,
      effects: [],
      automation: {},
    });
  if (buses.length > 16)
    throw Error("Sound bus count exceeds 16 including master");
  const byId = new Map(buses.map((b) => [b.id, b]));
  for (const bus of buses) {
    const seen = new Set<string>();
    let current: Bus | undefined = bus;
    while (current && current.id !== "master") {
      if (seen.has(current.id)) throw Error("Sound bus cycle");
      seen.add(current.id);
      current = byId.get(current.output);
      if (!current) throw Error("Unknown sound output bus");
    }
    for (const e of bus.effects)
      if (e.type === "reverb" && !assets[String(e.impulse)])
        throw Error("Unknown sound impulse asset");
    if (
      bus.automation.frequency &&
      !bus.effects.some((e) => e.type === "filter")
    )
      throw Error("Frequency automation requires a filter");
    if (
      bus.automation.wet &&
      !bus.effects.some((e) =>
        ["delay", "reverb", "distortion"].includes(e.type),
      )
    )
      throw Error("Wet automation requires a wet effect");
  }
  const plans = compileCatalogue(document),
    shows: SoundCatalogue["shows"] = Object.create(null);
  let total = 0;
  for (const [id, raw] of Object.entries(object(root.shows))) {
    name(id);
    const plan = Object.hasOwn(plans, id) ? plans[id] : undefined;
    if (!plan || plan.duration < 100)
      throw Error("Sound show requires an animation of at least 100ms");
    const show = object(raw);
    fields(show, ["timeline"]);
    const cues: Cue[] = [];
    function visit(value: unknown, start: number, depth: number): number {
      if (depth > 12 || ++total > 2048)
        throw Error("Sound composition budget exceeded");
      const r = object(value),
        delay = finite(r.delay_ms ?? 0, "sound delay", 0, 600000);
      start += delay;
      if (r.sequence || r.parallel) {
        fields(r, ["sequence", "parallel", "delay_ms", "stagger_ms"]);
        if (r.sequence && r.parallel)
          throw Error("Ambiguous sound composition");
        const children = r.sequence ?? r.parallel;
        if (!Array.isArray(children) || !children.length)
          throw Error("Empty sound composition");
        const stagger = finite(r.stagger_ms ?? 0, "sound stagger", 0, 600000);
        let elapsed = 0;
        for (const [i, child] of children.entries()) {
          const end = visit(
            child,
            start + (r.sequence ? elapsed : i * stagger),
            depth + 1,
          );
          elapsed = r.sequence
            ? elapsed + end
            : Math.max(elapsed, i * stagger + end);
        }
        return delay + elapsed;
      }
      fields(r, [
        "id",
        "asset",
        "bus",
        "duration_ms",
        "delay_ms",
        "offset_ms",
        "source_duration_ms",
        "rate",
        "loop",
        "gain_db",
        "pan",
        "fade_in_ms",
        "fade_out_ms",
        "automation",
      ]);
      const cueId = name(r.id);
      if (cues.some((c) => c.id === cueId)) throw Error("Duplicate sound cue");
      const asset = name(r.asset),
        bus = name(r.bus ?? "master");
      if (!assets[asset] || !byId.has(bus))
        throw Error("Unknown sound cue asset/bus");
      const duration = finite(r.duration_ms, "sound duration", 1, 600000);
      if (start + duration > plan!.duration + 0.001)
        throw Error("Sound cue exceeds animation duration");
      if (r.loop !== undefined && typeof r.loop !== "boolean")
        throw Error("Invalid sound loop flag");
      const auto = automation(r.automation, duration);
      if (Object.keys(auto).some((k) => !["gain_db", "pan"].includes(k)))
        throw Error("Cue automation supports gain_db and pan");
      cues.push({
        id: cueId,
        asset,
        bus,
        start,
        duration,
        offset: finite(r.offset_ms ?? 0, "sound offset", 0, 120000),
        ...(r.source_duration_ms === undefined
          ? {}
          : {
              sourceDuration: finite(
                r.source_duration_ms,
                "sound source duration",
                1,
                120000,
              ),
            }),
        rate: finite(r.rate ?? 1, "cue rate", 0.125, 8),
        loop: r.loop === true,
        gain: finite(r.gain_db ?? 0, "cue gain", -96, 12),
        pan: finite(r.pan ?? 0, "cue pan", -1, 1),
        fadeIn: finite(r.fade_in_ms ?? 8, "fade in", 0, duration),
        fadeOut: finite(r.fade_out_ms ?? 12, "fade out", 0, duration),
        automation: auto,
      });
      return delay + duration;
    }
    visit(show.timeline, 0, 0);
    shows[id] = { duration: plan.duration, cues };
  }
  if (!Object.keys(shows).length || Object.keys(shows).length > 32)
    throw Error("Invalid sound show count");
  const catalogue = { assets, buses, shows };
  soundMix(catalogue, document.defaults?.["__audio.mix"]);
  return catalogue;
}

/** Pure command admission before the native document may reach graphics or sound. */
export function soundMix(
  catalogue: SoundCatalogue | null,
  value: unknown,
): Map<
  string,
  {
    gain?: number;
    pan?: number;
    mute?: boolean;
    frequency?: number;
    wet?: number;
  }
> {
  const raw = value === undefined ? {} : object(value);
  const result = new Map<
    string,
    {
      gain?: number;
      pan?: number;
      mute?: boolean;
      frequency?: number;
      wet?: number;
    }
  >();
  for (const [id, value] of Object.entries(raw)) {
    const bus = catalogue?.buses.find((b) => b.id === id);
    if (!bus) throw Error("Unknown sound mix bus");
    const settings = object(value);
    fields(settings, ["gain_db", "pan", "mute", "frequency", "wet"]);
    if (settings.mute !== undefined && typeof settings.mute !== "boolean")
      throw Error("Invalid sound bus mute");
    if (
      settings.frequency !== undefined &&
      !bus.effects.some((e) => e.type === "filter")
    )
      throw Error("Sound frequency override requires a filter");
    if (
      settings.wet !== undefined &&
      !bus.effects.some((e) =>
        ["delay", "reverb", "distortion"].includes(e.type),
      )
    )
      throw Error("Sound wet override requires a wet effect");
    result.set(id, {
      ...(settings.gain_db === undefined
        ? {}
        : { gain: finite(settings.gain_db, "mix gain", -96, 12) }),
      ...(settings.pan === undefined
        ? {}
        : { pan: finite(settings.pan, "mix pan", -1, 1) }),
      ...(settings.frequency === undefined
        ? {}
        : {
            frequency: finite(settings.frequency, "mix frequency", 20, 20000),
          }),
      ...(settings.wet === undefined
        ? {}
        : { wet: finite(settings.wet, "mix wet", 0, 1) }),
      ...(settings.mute === undefined
        ? {}
        : { mute: settings.mute as boolean }),
    });
  }
  return result;
}
