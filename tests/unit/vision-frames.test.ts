import { describe, expect, it, vi } from "vitest";
import { VisionFrames, type VisionFrame } from "../../src/engine/vision-frames";

const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;

describe("combined Vision frame submission", () => {
  it("allows camera coalescing for at most one 120 Hz interval and bypasses it for state", async () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const port1 = { onmessage: null as null | (() => void), close: vi.fn() };
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = port1;
        port2 = { postMessage: post, close: vi.fn() };
      },
    );
    const submit = vi.fn(async (_frame: VisionFrame) => {});
    const queue = new VisionFrames(submit);
    try {
      const image = bitmap();
      const media = queue.addMedia([{ path: "cam", bitmap: image }]);
      await vi.advanceTimersByTimeAsync(7);
      expect(post).not.toHaveBeenCalled();
      const state = queue.addPatch({ score: 1 });
      expect(post).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      port1.onmessage!();
      await Promise.all([state, media]);
      expect(submit).toHaveBeenCalledOnce();
      expect(submit.mock.calls[0]![0]).toEqual({
        patch: { score: 1 },
        frames: [{ path: "cam", bitmap: image }],
      });
      const next = queue.addMedia([{ path: "cam", bitmap: bitmap() }]);
      await vi.advanceTimersByTimeAsync(1000 / 120);
      expect(post).toHaveBeenCalledTimes(2);
      port1.onmessage!();
      await next;
      expect(submit).toHaveBeenCalledTimes(2);
    } finally {
      queue.close();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("submits the latest state and latest camera image once, preserving all completion waiters", async () => {
    const submit = vi.fn(async (_frame: VisionFrame) => {});
    const queue = new VisionFrames(submit);
    const first = bitmap(),
      latest = bitmap();
    const pending = [
      queue.addPatch({ score: 1 }),
      queue.addMedia([{ path: "cam", bitmap: first }]),
      queue.addPatch({ score: 2 }),
      queue.addMedia([{ path: "cam", bitmap: latest }]),
    ];
    expect(first.close).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    await queue.flush();
    await Promise.all(pending);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith({
      patch: { score: 2 },
      frames: [{ path: "cam", bitmap: latest }],
    });
    expect(latest.close).toHaveBeenCalledOnce();
    queue.close();
  });

  it("keeps arrivals behind the in-flight frame and drains them at the barrier", async () => {
    let finish!: () => void;
    const submit = vi.fn(async (_frame: VisionFrame) => {
      if (submit.mock.calls.length === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    });
    const queue = new VisionFrames(submit);
    const first = queue.addPatch({ score: 1 });
    const work = queue.flush();
    await Promise.resolve();
    const image = bitmap();
    const next = [
      queue.addMedia([{ path: "cam", bitmap: image }]),
      queue.addPatch({ score: 2 }),
    ];
    const barrier = queue.flush();
    finish();
    await Promise.all([work, first, barrier, ...next]);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]![0].patch).toEqual({ score: 2 });
    expect(image.close).toHaveBeenCalledOnce();
    queue.close();
  });

  it("rejects every covered waiter on render failure and releases owned images", async () => {
    const queue = new VisionFrames(async () => {
      throw new Error("GPU failure");
    });
    const image = bitmap();
    const state = queue.addPatch({ value: 1 });
    const media = queue.addMedia([{ path: "cam", bitmap: image }]);
    const stateFailed = expect(state).rejects.toThrow("GPU failure");
    const mediaFailed = expect(media).rejects.toThrow("GPU failure");
    await expect(queue.flush()).rejects.toThrow("GPU failure");
    await Promise.all([stateFailed, mediaFailed]);
    expect(image.close).toHaveBeenCalledOnce();
    queue.close();
  });

  it("cancels an unsubmitted frame without fabricating a presentation", async () => {
    const submit = vi.fn(async () => {}),
      queue = new VisionFrames(submit),
      image = bitmap();
    const pending = queue.addMedia([{ path: "cam", bitmap: image }]);
    const failed = expect(pending).rejects.toThrow("closed");
    queue.close();
    await failed;
    await queue.flush();
    expect(submit).not.toHaveBeenCalled();
    expect(image.close).toHaveBeenCalledOnce();
  });
});
