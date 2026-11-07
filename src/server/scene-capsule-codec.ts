import { Worker } from "node:worker_threads";
import type { SceneSourceDelivery } from "../scenes/types";

type CapsuleResult = SceneSourceDelivery | Uint8Array;
interface Pending {
  resolve(value: CapsuleResult): void;
  reject(error: Error): void;
}

/** A bounded catalogue pass owns its codec worker and every outstanding request. */
export class SceneCapsuleCodec {
  private worker: Worker | null = null;
  private stopping: Promise<void> | null = null;
  private nextId = 0;
  private failure: Error | null = null;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly signal: AbortSignal) {
    signal.addEventListener("abort", this.cancel, { once: true });
  }

  decode(bytes: Uint8Array): Promise<SceneSourceDelivery> {
    return this.call("decode", bytes) as Promise<SceneSourceDelivery>;
  }

  encode(source: SceneSourceDelivery): Promise<Uint8Array> {
    return this.call("encode", source) as Promise<Uint8Array>;
  }

  private async call(
    operation: "encode" | "decode",
    value: CapsuleResult,
  ): Promise<CapsuleResult> {
    this.signal.throwIfAborted();
    if (this.failure) throw this.failure;
    if (!this.worker) {
      const worker = new Worker(
        new URL("./scene-capsule-worker.mjs", import.meta.url),
        { execArgv: [] },
      );
      this.worker = worker;
      worker.on(
        "message",
        (message: { id: number; value?: CapsuleResult; error?: string }) => {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.value !== undefined) pending.resolve(message.value);
          else
            pending.reject(
              new Error(message.error ?? "SOURCE_CACHE_CODEC_FAILED"),
            );
        },
      );
      worker.once("error", (error) => this.fail(error));
      worker.once("exit", () =>
        this.fail(new Error("SOURCE_CACHE_CODEC_CLOSED")),
      );
    }
    const worker = this.worker;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, operation, value });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
  }

  private cancel = (): void => {
    this.fail(new Error("SOURCE_CACHE_SYNC_CANCELLED"));
    void this.close();
  };

  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.signal.removeEventListener("abort", this.cancel);
    this.fail(new Error("SOURCE_CACHE_CODEC_CLOSED"));
    const worker = this.worker;
    this.worker = null;
    this.stopping = worker
      ? worker.terminate().then(() => undefined)
      : Promise.resolve();
    return this.stopping;
  }
}
