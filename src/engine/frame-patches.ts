/** Merge scalar scene state for one frame, retaining every presentation receipt. */
export class FramePatches<T> {
  private pending: Array<{
    patch: Record<string, unknown>;
    receipt: T;
    addedAt: number;
  }> = [];
  private scheduled = false;
  private running: Promise<void> = Promise.resolve();
  private closed = false;
  private busy = false;
  private queueHighWater = 0;
  constructor(
    private readonly submit: (
      patch: Record<string, unknown>,
      receipts: T[],
    ) => Promise<void>,
    private readonly failed: (error: unknown) => void,
  ) {}

  add(patch: Record<string, unknown>, receipt: T): void {
    if (this.closed) throw new Error("Presentation queue closed.");
    this.pending.push({ patch, receipt, addedAt: performance.now() });
    this.queueHighWater = Math.max(this.queueHighWater, this.pending.length);
    this.schedule();
  }

  private schedule(): void {
    if (
      !this.closed &&
      !this.busy &&
      this.pending.length > 0 &&
      !this.scheduled
    ) {
      this.scheduled = true;
      // VisionFrames supplies the task yield and owns the one GPU submission.
      // An additional channel here delays reception without adding a frame.
      queueMicrotask(() => {
        this.scheduled = false;
        if (!this.closed) void this.flush().catch(this.failed);
      });
    }
  }

  flush(): Promise<void> {
    this.scheduled = false;
    if (this.busy) return this.running.then(() => this.flush());
    const batch = this.pending.splice(0);
    if (batch.length === 0) return this.running;
    const startedAt = performance.now();
    const queueHighWater = this.queueHighWater;
    this.queueHighWater = 0;
    try {
      const stage = "solar:native-stage";
      if (performance.getEntriesByName(stage).length >= 64)
        performance.clearMeasures(stage);
      performance.measure(stage, {
        start: batch[0]!.addedAt,
        end: startedAt,
        detail: {
          stage: "frame-patches-queue",
          pendingAtFlush: batch.length,
          queueHighWater,
          oldestAgeMs: Math.max(0, startedAt - batch[0]!.addedAt),
        },
      });
    } catch {
      // Instrumentation must not interrupt or delay frame submission.
    }
    const patch = Object.assign({}, ...batch.map((item) => item.patch));
    this.busy = true;
    let succeeded = false;
    this.running = Promise.resolve()
      .then(() => {
        if (this.closed) return;
        return this.submit(
          patch,
          batch.map((item) => item.receipt),
        );
      })
      .then(() => {
        succeeded = true;
      })
      .finally(() => {
        this.busy = false;
        // A completed render already supplies the pacing boundary. Drain work
        // received during that render without adding another scheduling interval.
        if (succeeded && !this.closed && this.pending.length > 0)
          queueMicrotask(() => void this.flush().catch(this.failed));
      });
    return this.running;
  }

  close(): void {
    this.closed = true;
    this.scheduled = false;
    this.pending = [];
    this.queueHighWater = 0;
  }
}
