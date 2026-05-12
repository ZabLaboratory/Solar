// Easing resolver — turn an EasingRef descriptor into a usable easing.
//
// We return two facets : a CSS easing string (consumed by WAAPI/CSS
// transitions and the FLIP runtime) and a normalised-time function `t
// → eased t` for runners that compute values in JS (count-up,
// curve-path).
//
// Spring easings can't be reduced to a closed-form CSS string ; we
// fall back to `ease-out` for the CSS facet and use a critically-
// damped approximation for the JS facet. That's deliberately
// minimal — the spring authoring path goes through framer-motion when
// fidelity matters.

import type { EasingRef } from "../transport/protocol";

export interface ResolvedEasing {
  /** CSS / WAAPI `easing` value. */
  css: string;
  /** `t ∈ [0,1] → eased t ∈ [0,1]`. */
  fn: (t: number) => number;
}

const LINEAR = (t: number): number => t;
const EASE_IN = (t: number): number => t * t * t;
const EASE_OUT = (t: number): number => 1 - Math.pow(1 - t, 3);
const EASE_IN_OUT = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const STRING_EASINGS: Record<string, ResolvedEasing> = {
  linear: { css: "linear", fn: LINEAR },
  "ease-in": { css: "cubic-bezier(0.42, 0, 1, 1)", fn: EASE_IN },
  "ease-out": { css: "cubic-bezier(0, 0, 0.58, 1)", fn: EASE_OUT },
  "ease-in-out": { css: "cubic-bezier(0.42, 0, 0.58, 1)", fn: EASE_IN_OUT },
  "cubic-in": { css: "cubic-bezier(0.32, 0, 0.67, 0)", fn: EASE_IN },
  "cubic-out": { css: "cubic-bezier(0.33, 1, 0.68, 1)", fn: EASE_OUT },
  "cubic-in-out": { css: "cubic-bezier(0.65, 0, 0.35, 1)", fn: EASE_IN_OUT },
};

const DEFAULT: ResolvedEasing = {
  css: "cubic-bezier(0, 0, 0.58, 1)",
  fn: EASE_OUT,
};

export function resolveEasing(ref: EasingRef | undefined): ResolvedEasing {
  if (!ref) return DEFAULT;
  if (typeof ref === "string") {
    return STRING_EASINGS[ref] ?? DEFAULT;
  }
  // Inline spring → approximate. We damp toward 1 using the ratio.
  const { stiffness, damping } = ref;
  const ratio = damping > 0 ? Math.min(1, damping / Math.max(1, stiffness)) : 1;
  const fn = (t: number): number => {
    const decay = Math.exp(-5 * (1 - ratio) * t);
    return 1 - decay * Math.cos(t * Math.PI * (1 - ratio));
  };
  return { css: "cubic-bezier(0.22, 1, 0.36, 1)", fn };
}
