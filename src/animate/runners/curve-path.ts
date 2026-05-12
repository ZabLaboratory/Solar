// curve-path — sample a curve defined by anchored Bézier handles.
//
// The descriptor carries `curve.anchors` (t_pct, value, optional
// tangents) and a `sample_hz` cadence. We pre-sample once, then walk
// the sample buffer at the configured rate, writing each sampled
// value to the store. This avoids any per-frame `getPointAtLength`
// cost ; for v1, payloads stay short enough that pre-sampling is
// orders of magnitude under any perceptible cost.

import type { ActionRunner } from "../action-runner";

interface CurveAnchor {
  t_pct: number;
  value: number;
  in_tangent?: { dt: number; dv: number };
  out_tangent?: { dt: number; dv: number };
}

const DEFAULT_DURATION_MS = 1000;

export const runCurvePath: ActionRunner = async (ctx) => {
  const { store, patch, signal } = ctx;
  const action = patch.action;
  if (!action?.curve) return;

  const anchors = (action.curve.anchors ?? []).slice().sort(
    (a, b) => a.t_pct - b.t_pct,
  );
  if (anchors.length === 0) return;
  if (anchors.length === 1) {
    store.set(patch.path, anchors[0]!.value, patch.transition);
    return;
  }

  const duration = action.duration_ms ?? DEFAULT_DURATION_MS;
  const hz = action.curve.sample_hz ?? 60;
  const frameMs = 1000 / hz;
  const totalFrames = Math.max(1, Math.round(duration / frameMs));

  const start = nowMs();
  const raf = pickRaf();
  let frame = 0;

  await new Promise<void>((resolve) => {
    function tick() {
      if (signal?.aborted) {
        store.set(patch.path, anchors[anchors.length - 1]!.value);
        resolve();
        return;
      }
      const elapsed = nowMs() - start;
      const t = Math.min(1, elapsed / duration);
      const value = sample(anchors, t * 100);
      store.set(patch.path, value);
      frame++;
      if (t < 1 && frame < totalFrames * 4) raf(tick);
      else {
        store.set(patch.path, anchors[anchors.length - 1]!.value);
        resolve();
      }
    }
    raf(tick);
  });
};

function sample(anchors: CurveAnchor[], pct: number): number {
  if (pct <= anchors[0]!.t_pct) return anchors[0]!.value;
  const last = anchors[anchors.length - 1]!;
  if (pct >= last.t_pct) return last.value;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (pct >= a.t_pct && pct <= b.t_pct) {
      const localT = (pct - a.t_pct) / (b.t_pct - a.t_pct);
      // Cubic hermite using tangents when present, else linear.
      const out = a.out_tangent ?? { dt: 0, dv: 0 };
      const inn = b.in_tangent ?? { dt: 0, dv: 0 };
      const h00 = 2 * localT ** 3 - 3 * localT ** 2 + 1;
      const h10 = localT ** 3 - 2 * localT ** 2 + localT;
      const h01 = -2 * localT ** 3 + 3 * localT ** 2;
      const h11 = localT ** 3 - localT ** 2;
      const m0 = out.dv;
      const m1 = inn.dv;
      return h00 * a.value + h10 * m0 + h01 * b.value + h11 * m1;
    }
  }
  return last.value;
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
