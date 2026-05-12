// mask-reveal — animate a CSS `clip-path` from a hidden state to a
// fully revealed state. Implementation is GPU-friendly (clip-path
// composites on the same layer as transform).
//
// Params :
//   - direction : "left-to-right" | "right-to-left" | "top-to-bottom"
//                 | "bottom-to-top" | "center-out" (default
//                 "left-to-right")

import type { ActionRunner } from "../action-runner";
import { resolveEasing } from "../easing-resolver";

interface MaskParams {
  direction?:
    | "left-to-right"
    | "right-to-left"
    | "top-to-bottom"
    | "bottom-to-top"
    | "center-out";
}

const DEFAULT_DURATION_MS = 600;

const FRAMES: Record<NonNullable<MaskParams["direction"]>, [string, string]> = {
  "left-to-right": [
    "inset(0 100% 0 0)",
    "inset(0 0 0 0)",
  ],
  "right-to-left": [
    "inset(0 0 0 100%)",
    "inset(0 0 0 0)",
  ],
  "top-to-bottom": [
    "inset(0 0 100% 0)",
    "inset(0 0 0 0)",
  ],
  "bottom-to-top": [
    "inset(100% 0 0 0)",
    "inset(0 0 0 0)",
  ],
  "center-out": [
    "inset(50% 50% 50% 50%)",
    "inset(0 0 0 0)",
  ],
};

export const runMaskReveal: ActionRunner = async (ctx) => {
  const { patch, root, signal } = ctx;
  const action = patch.action;
  if (!action) return;
  const params = (action.params ?? {}) as MaskParams;
  const dir = params.direction ?? "left-to-right";
  const duration = action.duration_ms ?? DEFAULT_DURATION_MS;
  const easing = resolveEasing(action.easing).css;

  const target = resolveTarget(root, patch.path);
  if (!target) return;

  const frames = FRAMES[dir];
  if (typeof target.animate !== "function") {
    target.style.clipPath = frames[1];
    return;
  }
  const anim = target.animate(
    [{ clipPath: frames[0] }, { clipPath: frames[1] }],
    { duration, easing, fill: "both" },
  );
  signal?.addEventListener("abort", () => anim.cancel());
  await anim.finished.then(
    () => undefined,
    () => undefined,
  );
};

function resolveTarget(
  root: HTMLElement | null | undefined,
  path: string,
): HTMLElement | null {
  if (!root) return null;
  const exact = root.querySelector<HTMLElement>(
    `[data-anim-path="${cssEscape(path)}"]`,
  );
  if (exact) return exact;
  const last = path.split(/[.[\]]/).filter(Boolean).pop();
  if (last) {
    const byId = root.querySelector<HTMLElement>(
      `[data-anim-id="${cssEscape(last)}"]`,
    );
    if (byId) return byId;
  }
  return root;
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/["\\]/g, "\\$&");
}
