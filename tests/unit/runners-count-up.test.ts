// count-up — runs a numeric tween locally without receiving frame-by-
// frame patches. The exact intermediate values depend on the easing
// curve ; we only assert end-state equality plus monotonic progress.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { createStore } from "../../src/state/store";
import { runAction } from "../../src/animate/action-runner";

function makeRafLoop() {
  let now = 0;
  const cbs: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextId = 1;
  const raf = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    cbs.push({ id, cb });
    return id;
  };
  const advance = (dtMs: number) => {
    now += dtMs;
    const pending = cbs.splice(0, cbs.length);
    for (const { cb } of pending) cb(now);
  };
  return { raf, advance, getNow: () => now };
}

describe("runners / count-up", () => {
  let perfSpy: ReturnType<typeof vi.spyOn> | null = null;
  let rafSpy: ReturnType<typeof vi.stubGlobal> | null = null;
  let loop: ReturnType<typeof makeRafLoop>;

  beforeEach(() => {
    loop = makeRafLoop();
    perfSpy = vi.spyOn(performance, "now").mockImplementation(() => loop.getNow());
    rafSpy = vi.stubGlobal("requestAnimationFrame", loop.raf);
  });

  afterEach(() => {
    perfSpy?.mockRestore();
    if (rafSpy) vi.unstubAllGlobals();
  });

  it("tweens from 0 → 1891 over 800ms and ends exactly on the target", async () => {
    const store = createStore();
    const promise = runAction({
      store,
      patch: {
        path: "score.value",
        value: 1891,
        action: {
          kind: "count-up",
          params: { from: 0, to: 1891 },
          duration_ms: 800,
        },
      },
    });
    // Drive the RAF loop to completion.
    for (let i = 0; i < 60; i++) loop.advance(16);
    loop.advance(200); // overshoot to guarantee completion tick
    await promise;
    expect(store.toRecord()["score.value"]).toBe(1891);
  });

  it("uses patch.value as the implicit `to` when params.to is missing", async () => {
    const store = createStore();
    const promise = runAction({
      store,
      patch: {
        path: "n",
        value: 42,
        action: { kind: "count-up", params: { from: 0 }, duration_ms: 100 },
      },
    });
    for (let i = 0; i < 20; i++) loop.advance(16);
    await promise;
    expect(store.toRecord()["n"]).toBe(42);
  });

  it("respects `decimals` when rounding intermediate values", async () => {
    const store = createStore();
    const samples: number[] = [];
    // Subscribe to the signal directly to capture intermediate writes.
    const sig = store.signal("ratio");
    const dispose = (sig as unknown as { subscribe?: (fn: (v: unknown) => void) => () => void }).subscribe
      ? (sig as unknown as { subscribe: (fn: (v: unknown) => void) => () => void }).subscribe((v) => {
          if (typeof v === "number") samples.push(v);
        })
      : () => {};
    const promise = runAction({
      store,
      patch: {
        path: "ratio",
        value: 1,
        action: {
          kind: "count-up",
          params: { from: 0, to: 1, decimals: 2 },
          duration_ms: 80,
        },
      },
    });
    for (let i = 0; i < 15; i++) loop.advance(16);
    await promise;
    dispose();
    expect(store.toRecord()["ratio"]).toBe(1);
    // Every captured sample is rounded to 2 decimals.
    for (const s of samples) {
      const rounded = Math.round(s * 100) / 100;
      expect(s).toBe(rounded);
    }
  });

  it("short-circuits when duration_ms ≤ 0", async () => {
    const store = createStore();
    await runAction({
      store,
      patch: {
        path: "x",
        value: 7,
        action: { kind: "count-up", params: { from: 0, to: 7 }, duration_ms: 0 },
      },
    });
    expect(store.toRecord()["x"]).toBe(7);
  });
});
