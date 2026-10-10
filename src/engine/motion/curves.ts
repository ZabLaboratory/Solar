/** Curves are compiled once; all sampling is independent of frame cadence. */
export type MotionValue = number | string;
export type Curve = (phase: number) => number;
export const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export function finite(
  value: unknown,
  name: string,
  low = -1e6,
  high = 1e6,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < low ||
    value > high
  )
    throw new Error(
      `Invalid motion ${name}: finite value in [${low}, ${high}] required.`,
    );
  return value;
}
export function curve(raw: unknown = "linear", duration = 1000): Curve {
  const spring = record(raw);
  if (spring?.type === "spring") {
    const k = finite(spring.stiffness ?? 170, "spring stiffness", 1, 10000);
    const c = finite(spring.damping ?? 26, "spring damping", 0.01, 1000);
    const m = finite(spring.mass ?? 1, "spring mass", 0.01, 100);
    const w = Math.sqrt(k / m),
      z = c / (2 * Math.sqrt(k * m));
    return (phase) => {
      if (phase <= 0 || phase >= 1) return phase;
      const t = (phase * duration) / 1000;
      if (Math.abs(z - 1) < 1e-5) return 1 - (1 + w * t) * Math.exp(-w * t);
      if (z < 1) {
        const wd = w * Math.sqrt(1 - z * z);
        return (
          1 -
          Math.exp(-z * w * t) *
            (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
        );
      }
      const a = -w * (z - Math.sqrt(z * z - 1)),
        b = -w * (z + Math.sqrt(z * z - 1));
      return 1 - (b * Math.exp(a * t) - a * Math.exp(b * t)) / (b - a);
    };
  }
  if (raw === "hold") return (t) => (t < 1 ? 0 : 1);
  if (raw === "linear") return (t) => t;
  const named: Record<string, number[]> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  const match =
    typeof raw === "string" &&
    /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+)\s*\)$/.exec(
      raw,
    );
  const points =
    typeof raw === "string"
      ? (named[raw] ?? (match ? match.slice(1).map(Number) : null))
      : null;
  if (
    !points ||
    points.some((v) => !Number.isFinite(v)) ||
    points[0]! < 0 ||
    points[0]! > 1 ||
    points[2]! < 0 ||
    points[2]! > 1
  )
    throw new Error(`Unsupported animation easing: ${String(raw)}`);
  const bezier = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  return (t) => {
    if (t <= 0 || t >= 1) return t;
    let low = 0,
      high = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (bezier(mid, points[0]!, points[2]!) < t) low = mid;
      else high = mid;
    }
    return bezier((low + high) / 2, points[1]!, points[3]!);
  };
}
export function rgba(value: string): number[] {
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    let s = hex[1]!;
    if (s.length <= 4) s = [...s].map((c) => c + c).join("");
    if (s.length === 6) s += "ff";
    return [0, 2, 4, 6].map((i) => parseInt(s.slice(i, i + 2), 16));
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      value,
    );
  if (rgb)
    return [
      finite(Number(rgb[1]), "red", 0, 255),
      finite(Number(rgb[2]), "green", 0, 255),
      finite(Number(rgb[3]), "blue", 0, 255),
      finite(Number(rgb[4] ?? 1), "alpha", 0, 1) * 255,
    ];
  throw new Error(
    `Unsupported animation color: ${value}; use hex or rgb/rgba.`,
  );
}
export function interpolate(
  a: MotionValue,
  b: MotionValue,
): (phase: number) => MotionValue {
  if (typeof a === "number" && typeof b === "number")
    return (t) => a + (b - a) * t;
  if (typeof a !== "string" || typeof b !== "string")
    throw new Error("Mixed animation value types.");
  const from = rgba(a),
    to = rgba(b);
  return (t) =>
    "#" +
    from
      .map((v, i) =>
        Math.round(Math.max(0, Math.min(255, v + (to[i]! - v) * t)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
}
