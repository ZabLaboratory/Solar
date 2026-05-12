// reorder — FLIP animate the children of a list when their order
// changes. Two consumption patterns :
//
//   1. The patch carries a new ordering as `patch.value` (an array of
//      ids). The runner captures FIRST, writes the value to the store
//      (component re-renders with new order), then PLAYs.
//   2. The host mutates the DOM imperatively in `mutate` (rare in
//      Solar — exposed for symmetry with Prism's preview).
//
// Either way the FLIP technique itself comes from `../flip.ts`, the
// canonical implementation shared with Prism.

import type { ActionRunner } from "../action-runner";
import { captureFlip, playFlip } from "../flip";
import { resolveEasing } from "../easing-resolver";

interface ReorderParams {
  /** Override the FLIP-id selector (default `[data-flip-id]`). */
  selector?: string;
  /** Total animation duration in ms (overrides action.duration_ms). */
  duration_ms?: number;
}

const DEFAULT_DURATION_MS = 400;

export const runReorder: ActionRunner = async (ctx) => {
  const { store, patch, root } = ctx;
  const action = patch.action;
  if (!action) return;
  if (!root) {
    // No DOM access — fall back to a plain state write. The host's
    // primitive will reconcile order without animation.
    store.set(patch.path, patch.value, patch.transition);
    return;
  }
  const params = (action.params ?? {}) as ReorderParams;
  const selector = params.selector ?? "[data-flip-id]";
  const duration =
    params.duration_ms ?? action.duration_ms ?? DEFAULT_DURATION_MS;
  const easing = resolveEasing(action.easing).css;

  const snapshot = captureFlip(root, selector);

  // Trigger the reorder by writing the new value into the store. We
  // wait one microtask + one animation frame to let React commit the
  // DOM mutation before we measure LAST.
  store.set(patch.path, patch.value, patch.transition);
  await flushFrame();

  await playFlip(root, snapshot, { duration, easing, selector });
};

function flushFrame(): Promise<void> {
  return new Promise((resolve) => {
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) =>
            setTimeout(() => cb(Date.now()), 16) as unknown as number;
    raf(() => raf(() => resolve()));
  });
}
