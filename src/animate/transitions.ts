// Translate an ADR 002 `Transition` into a Framer Motion transition.
//
// We deliberately animate only GPU-friendly properties — transform,
// opacity, filter on a separate layer. Primitives enforce this at
// the DOM level by exposing those props as motion-bindable values
// rather than raw CSS.

import type { Transition as Tx } from "../transport/protocol";

export type FramerEasing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface FramerTransition {
  duration?: number;
  ease?: FramerEasing;
  type?: "tween" | "spring";
  stiffness?: number;
  damping?: number;
}

const NO_ANIMATION: FramerTransition = { duration: 0 };

const EASE_MAP: Record<string, FramerEasing> = {
  linear: "linear",
  "cubic-in": "easeIn",
  "cubic-out": "easeOut",
  "cubic-in-out": "easeInOut",
};

export function toFramer(t: Tx | undefined): FramerTransition {
  if (!t || t.kind === "none") return NO_ANIMATION;
  if (t.kind === "tween") {
    return {
      type: "tween",
      duration: (t.duration_ms ?? 0) / 1000,
      ease: t.ease ? (EASE_MAP[t.ease] ?? "easeOut") : "easeOut",
    };
  }
  if (t.kind === "spring") {
    return {
      type: "spring",
      ...(t.stiffness !== undefined ? { stiffness: t.stiffness } : {}),
      ...(t.damping !== undefined ? { damping: t.damping } : {}),
    };
  }
  // crossfade is handled at scene-tree level (animate/crossfade.tsx)
  // — at the per-prop level it degenerates into a tween on opacity.
  return {
    type: "tween",
    duration: (t.duration_ms ?? 400) / 1000,
    ease: "easeInOut",
  };
}
