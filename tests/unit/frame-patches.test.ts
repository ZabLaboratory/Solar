import { describe, expect, it, vi } from "vitest";
import { FramePatches } from "../../src/engine/frame-patches";

describe("frame-paced scalar presentation", () => {
  it("merges 512 ordered states into one frame while retaining every receipt", async () => {
    const submit = vi.fn(async () => {}),
      failed = vi.fn();
    const queue = new FramePatches<number>(submit, failed);
    for (let counter = 1; counter <= 512; counter++)
      queue.add({ counter }, counter);
    await queue.flush();
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]).toEqual([
      { counter: 512 },
      Array.from({ length: 512 }, (_, i) => i + 1),
    ]);
    expect(failed).not.toHaveBeenCalled();
    queue.close();
  });
  it("retains arrivals during a blocked GPU submission and drains before structure work", async () => {
    let finish!: () => void;
    const submit = vi.fn(async () => {
      if (submit.mock.calls.length === 1)
        await new Promise<void>((yes) => {
          finish = yes;
        });
    });
    const queue = new FramePatches<number>(submit, vi.fn());
    queue.add({ counter: 1 }, 1);
    const first = queue.flush();
    await Promise.resolve();
    for (let i = 2; i <= 512; i++) queue.add({ counter: i }, i);
    const barrier = queue.flush();
    expect(submit).toHaveBeenCalledTimes(1);
    finish();
    await first;
    await barrier;
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual([
      { counter: 512 },
      Array.from({ length: 511 }, (_, i) => i + 2),
    ]);
    queue.close();
  });
  it("propagates presentation failure and cancels unapplied work on disconnect", async () => {
    const submit = vi.fn(async () => {
      throw new Error("GPU rejected");
    });
    const queue = new FramePatches<number>(submit, vi.fn());
    queue.add({ counter: 1 }, 1);
    await expect(queue.flush()).rejects.toThrow("GPU rejected");
    queue.close();
    expect(() => queue.add({ counter: 2 }, 2)).toThrow("closed");
    const cancelled = new FramePatches<number>(submit, vi.fn());
    cancelled.add({ counter: 3 }, 3);
    cancelled.close();
    await cancelled.flush();
    expect(submit).toHaveBeenCalledOnce();
  });
  it("uses render completion to drain arrivals without an extra empty animation frame", async () => {
    let finish!: () => void;
    const submit = vi.fn(async () => {
      if (submit.mock.calls.length === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    });
    const queue = new FramePatches<number>(submit, vi.fn());
    queue.add({ counter: 1 }, 1);
    const first = queue.flush();
    await Promise.resolve();
    queue.add({ counter: 2 }, 2);
    finish();
    await first;
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]).toEqual([{ counter: 2 }, [2]]);
    queue.close();
  });
});
