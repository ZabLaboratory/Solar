import {
  BrowserLSDP,
  type IncomingContext,
} from "../../vendor/lsdp-native-browser/src/browser.js";

type Options = NonNullable<ConstructorParameters<typeof BrowserLSDP>[1]>;
interface VerifiedWorkerState {
  readonly value: unknown;
  readonly stateHash: string;
}
// Only this client's private Worker channel can certify a delivery. A field
// supplied by the network or a caller's lookalike context cannot bypass hashing.
const verifiedStates = new WeakMap<IncomingContext, VerifiedWorkerState>();
export const verifiedNativeWorkerState = (
  context: IncomingContext,
): VerifiedWorkerState | undefined => verifiedStates.get(context);

/** Same consumer boundary; network/application work does not wait on CEF drawing. */
export class NativeWorkerClient {
  readonly ready: Promise<void>;
  private readonly worker = new Worker(
    new URL("./native-worker.ts", import.meta.url),
    { type: "module" },
  );
  private readonly abort = new AbortController();
  private serial = 0;
  private readonly requests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private queue: Promise<void> = Promise.resolve();
  private rejectReady!: (error: Error) => void;
  private readonly deliveries = new Map<number, AbortController>();
  constructor(
    url: string,
    readonly options: Options,
    resource: string,
    selector?: string,
  ) {
    let resolve!: () => void, reject!: (error: Error) => void;
    this.ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
      this.rejectReady = no;
    });
    void this.ready.catch(() => {});
    const failed = (value: { message: string; code?: string }) => {
      if (this.abort.signal.aborted) return;
      const error = Object.assign(new Error(value.message), value);
      reject(error);
      this.close();
      options?.onClose?.(error);
    };
    this.worker.onerror = (event) => failed({ message: event.message });
    this.worker.onmessage = ({ data }) => {
      if (this.abort.signal.aborted) return;
      if (data.type === "ready") {
        resolve();
        return;
      }
      if (data.type === "closed") {
        failed(data.error);
        return;
      }
      if (data.type === "incoming-cancelled") {
        this.deliveries.get(data.id)?.abort();
      } else if (data.type === "transaction-result") {
        const call = this.requests.get(data.id);
        this.requests.delete(data.id);
        if (data.error)
          call?.reject(
            Object.assign(new Error(data.error.message), data.error),
          );
        else call?.resolve(data.value);
      } else if (data.type === "incoming") {
        const delivery = new AbortController();
        this.deliveries.set(data.id, delivery);
        const deliver = async () => {
          if (this.abort.signal.aborted) return;
          const received = performance.now();
          if (
            Number.isFinite(data.verificationMs) &&
            Number.isFinite(data.sentAt)
          ) {
            if (performance.getEntriesByName("solar:native-stage").length >= 64)
              performance.clearMeasures("solar:native-stage");
            performance.measure("solar:native-stage", {
              start: received,
              duration: Math.max(0, data.verificationMs ?? 0),
              detail: {
                stage: "worker-verify",
                resource,
                phase:
                  data.metadata.profile === "lsdp.state.read/1"
                    ? "snapshot"
                    : "change",
              },
            });
            performance.measure("solar:native-stage", {
              start: Math.min(
                received,
                Math.max(0, data.sentAt - performance.timeOrigin),
              ),
              end: received,
              detail: { stage: "worker-delivery", resource },
            });
          }
          const context: IncomingContext = {
            metadata: data.metadata,
            signal: AbortSignal.any([this.abort.signal, delivery.signal]),
          };
          try {
            context.signal.throwIfAborted();
            if (data.verifiedState) {
              if (
                data.metadata.target !== resource ||
                !/^tree-sha256:[a-f0-9]{64}$/.test(data.verifiedState.stateHash)
              )
                throw new Error("Invalid verified worker delivery.");
              verifiedStates.set(context, data.verifiedState);
            }
            const value = await options?.onTransaction?.(data.value, context);
            context.signal.throwIfAborted();
            this.worker.postMessage({ type: "result", id: data.id, value });
          } catch (error) {
            if (this.abort.signal.aborted) return;
            this.worker.postMessage({
              type: "result",
              id: data.id,
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            });
            options?.onIncomingFailed?.(
              context,
              error instanceof Error ? error : new Error(String(error)),
            );
          } finally {
            verifiedStates.delete(context);
            this.deliveries.delete(data.id);
          }
        };
        if (data.metadata.profile === "lsdp.state.read/1") void deliver();
        else this.queue = this.queue.then(deliver);
      }
    };
    this.worker.postMessage({
      type: "connect",
      url,
      authToken: options?.authToken,
      resource,
      selector,
    });
  }
  async transaction(
    value: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<unknown> {
    options?.signal?.throwIfAborted();
    let stopWaiting!: () => void;
    const cancelledReady = new Promise<never>((_resolve, reject) => {
      stopWaiting = () => reject(new Error("Native transaction cancelled."));
      options?.signal?.addEventListener("abort", stopWaiting, { once: true });
    });
    try {
      await Promise.race([this.ready, cancelledReady]);
    } finally {
      options?.signal?.removeEventListener("abort", stopWaiting);
    }
    options?.signal?.throwIfAborted();
    this.abort.signal.throwIfAborted();
    const id = ++this.serial;
    return await new Promise((resolve, reject) => {
      const cancelled = () => {
        const call = this.requests.get(id);
        this.requests.delete(id);
        if (!this.abort.signal.aborted)
          this.worker.postMessage({ type: "cancel-transaction", id });
        call?.reject(new Error("Native transaction cancelled."));
      };
      options?.signal?.addEventListener("abort", cancelled, { once: true });
      this.requests.set(id, {
        resolve: (value) => {
          options?.signal?.removeEventListener("abort", cancelled);
          resolve(value);
        },
        reject: (error) => {
          options?.signal?.removeEventListener("abort", cancelled);
          reject(error);
        },
      });
      this.worker.postMessage({ type: "transaction", id, value });
    });
  }
  close(): void {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    this.rejectReady(new Error("Native worker closed."));
    this.worker.terminate();
    this.deliveries.clear();
    for (const call of this.requests.values())
      call.reject(new Error("Native worker closed."));
    this.requests.clear();
  }
}
