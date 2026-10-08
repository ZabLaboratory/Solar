export interface VisionFrame {
  patch: Record<string, unknown>;
  frames: Array<{ path: string; bitmap: ImageBitmap }>;
  images?: Array<{ path: string; bytes: Uint8Array }>;
}

/** One submission combines replaceable state and the latest owned camera images. */
export class VisionFrames {
  private patch: Record<string, unknown> = {};
  private frames = new Map<string, ImageBitmap>();
  private images = new Map<string, Uint8Array>();
  private waiting: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private running: Promise<void> = Promise.resolve();
  private busy = false;
  private closed = false;
  private scheduled = false;
  private mediaTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly channel = new MessageChannel();

  constructor(private readonly submit: (frame: VisionFrame) => Promise<void>) {
    this.channel.port1.onmessage = () => {
      this.scheduled = false;
      void this.flush().catch(() => {}); // Each caller receives its rejection.
    };
  }

  addPatch(
    patch: Record<string, unknown>,
    images: NonNullable<VisionFrame["images"]> = [],
  ): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error("Vision frame queue closed."));
    Object.assign(this.patch, patch);
    for (const { path, bytes } of images) this.images.set(path, bytes);
    return this.pending();
  }

  addMedia(frames: VisionFrame["frames"]): Promise<void> {
    if (this.closed) {
      frames.forEach(({ bitmap }) => bitmap.close());
      return Promise.reject(new Error("Vision frame queue closed."));
    }
    for (const { path, bitmap } of frames) {
      this.frames.get(path)?.close();
      this.frames.set(path, bitmap);
    }
    return this.pending();
  }

  private pending(): Promise<void> {
    const result = new Promise<void>((resolve, reject) =>
      this.waiting.push({ resolve, reject }),
    );
    this.schedule();
    return result;
  }

  private schedule(): void {
    if (this.closed || this.busy || this.scheduled || !this.waiting.length)
      return;
    if (Object.keys(this.patch).length === 0) {
      // A camera-only frame may wait one 120 Hz interval for an arriving patch.
      // Patch arrival or an explicit flush bypasses this bounded media grace.
      this.mediaTimer ??= setTimeout(() => {
        this.mediaTimer = null;
        this.scheduled = true;
        this.channel.port2.postMessage(null);
      }, 1000 / 120);
      return;
    }
    if (this.mediaTimer !== null) clearTimeout(this.mediaTimer);
    this.mediaTimer = null;
    this.scheduled = true;
    // Rendering must not be capped by the host's 60 Hz RAF or nested timer clamp.
    this.channel.port2.postMessage(null);
  }

  flush(): Promise<void> {
    if (this.mediaTimer !== null) clearTimeout(this.mediaTimer);
    this.mediaTimer = null;
    if (this.busy) return this.running.then(() => this.flush());
    if (this.closed || this.waiting.length === 0) return Promise.resolve();
    const waiting = this.waiting.splice(0);
    const frame: VisionFrame = {
      patch: this.patch,
      frames: [...this.frames].map(([path, bitmap]) => ({ path, bitmap })),
      ...(this.images.size
        ? { images: [...this.images].map(([path, bytes]) => ({ path, bytes })) }
        : {}),
    };
    this.patch = {};
    this.frames.clear();
    this.images.clear();
    this.busy = true;
    this.running = Promise.resolve().then(async () => {
      try {
        if (this.closed) throw new Error("Vision frame queue closed.");
        await this.submit(frame);
        if (this.closed) throw new Error("Vision frame queue closed.");
        waiting.forEach(({ resolve }) => resolve());
      } catch (failure) {
        const error =
          failure instanceof Error ? failure : new Error(String(failure));
        waiting.forEach(({ reject }) => reject(error));
        throw error;
      } finally {
        frame.frames.forEach(({ bitmap }) => bitmap.close());
        this.busy = false;
        this.schedule();
      }
    });
    return this.running;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.mediaTimer !== null) clearTimeout(this.mediaTimer);
    this.mediaTimer = null;
    this.channel.port1.close();
    this.channel.port2.close();
    this.frames.forEach((bitmap) => bitmap.close());
    this.frames.clear();
    this.patch = {};
    this.images.clear();
    const error = new Error("Vision frame queue closed.");
    this.waiting.splice(0).forEach(({ reject }) => reject(error));
  }
}
