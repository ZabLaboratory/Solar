// count-up — tween a numeric path from `from` to `to` over `duration_ms`.
//
// The runner steps via requestAnimationFrame and writes the in-flight
// value through `store.set()` on every tick. Components reading the
// signal re-render with the latest number ; no patches are pushed on
// the wire — by design.
//
// Params (all optional, defaults in code) :
//   - from         : starting value (default 0)
//   - to           : ending value (default 0)
//   - decimals     : rounding (default 0)
//   - formatter    : "integer" | "decimal" — informational only.

import type { ActionRunner } from "../action-runner";
import { resolveEasing } from "../easing-resolver";

interface CountUpParams {
  from?: number;
  to?: number;
  decimals?: number;
}

const DEFAULT_DURATION_MS = 800;

export const runCountUp: ActionRunner = async (ctx) => {
  const { store, patch, signal } = ctx;
  const action = patch.action;
  if (!action) return;
  const params = (action.params ?? {}) as CountUpParams;
  const from = Number.isFinite(params.from) ? (params.from as number) : 0;
  const toCandidate =
    typeof patch.value === "number"
      ? patch.value
      : Number.isFinite(params.to)
        ? (params.to as number)
        : 0;
  const to = toCandidate;
  const decimals =
    typeof params.decimals === "number" && params.decimals >= 0
      ? Math.floor(params.decimals)
      : 0;
  const duration = action.duration_ms ?? DEFAULT_DURATION_MS;
  const easing = resolveEasing(action.easing);

  // Edge cases — zero duration or no-op : commit immediately.
  if (duration <= 0 || from === to) {
    store.set(patch.path, round(to, decimals), patch.transition);
    return;
  }

  const start = nowMs();
  const raf = pickRaf();

  await new Promise<void>((resolve) => {
    function tick() {
      if (signal?.aborted) {
        store.set(patch.path, round(to, decimals));
        resolve();
        return;
      }
      const elapsed = nowMs() - start;
      const t = Math.min(1, elapsed / duration);
      const eased = easing.fn(t);
      const value = from + (to - from) * eased;
      store.set(patch.path, round(value, decimals));
      if (t < 1) raf(tick);
      else resolve();
    }
    raf(tick);
  });
};

function round(v: number, decimals: number): number {
  if (decimals === 0) return Math.round(v);
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

type RafFn = (cb: FrameRequestCallback) => number;

function pickRaf(): RafFn {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame;
  }
  return (cb) => setTimeout(() => cb(nowMs()), 16) as unknown as number;
}
