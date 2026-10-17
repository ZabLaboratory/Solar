import { BrowserLSDP } from "../../vendor/lsdp-native-browser/src/browser.js";
import type { IncomingContext } from "../../vendor/lsdp-native-browser/src/browser.js";
import type { Operation } from "fast-json-patch";
import { nativeTreeHash } from "../internal/native-tree";
import {
  withNativeCompositionSource,
  type NativeCompositionPlan,
  type NativeCompositionProjection,
} from "../scenes/native-composition";
import type { NativeCompositionLSDPOptions, NativeLSDPOptions } from "../types";

type PeerOptions = NonNullable<ConstructorParameters<typeof BrowserLSDP>[1]>;
export interface NativeCompositionPeer {
  ready: Promise<void>;
  transaction(
    value: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  close(): void;
}
type Peer = NativeCompositionPeer;
export type NativeCompositionPublishResult =
  | "completed"
  | "superseded"
  | "retired";
export type NativeCompositionPeerFactory = (
  url: string,
  options: PeerOptions,
) => Peer;

interface PublisherOptions extends NativeCompositionLSDPOptions {
  authToken: string;
  source: Pick<NativeLSDPOptions, "resource" | "selector">;
}

interface CompositionState {
  schema: "solar.native-composition.state/1";
  producers: Partial<Record<"A" | "B", string>>;
  graphs: Partial<Record<"A" | "B", NativeCompositionPlan>>;
}

interface Snapshot {
  state: CompositionState;
  stateHash: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface QueuedAction {
  action: () => Promise<void>;
  completions: Deferred<NativeCompositionPublishResult>[];
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compositionState(value: unknown): CompositionState {
  const state = record(value);
  const producers = record(state?.producers);
  const graphs = record(state?.graphs);
  if (
    !state ||
    state.schema !== "solar.native-composition.state/1" ||
    !producers ||
    !graphs ||
    Object.keys(state).some(
      (key) => !["schema", "producers", "graphs"].includes(key),
    ) ||
    Object.keys(producers).some((key) => key !== "A" && key !== "B") ||
    Object.keys(graphs).some((key) => key !== "A" && key !== "B") ||
    Object.values(producers).some(
      (producer) =>
        typeof producer !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(producer),
    )
  )
    throw new Error("NATIVE_COMPOSITION_STATE_INVALID");
  for (const graph of Object.values(graphs)) {
    if (graph === undefined) continue;
    const plan = record(graph);
    if (
      !plan ||
      (plan.schema !== "solar.native-composition.plan/1" &&
        plan.schema !== "solar.native-composition.plan/2") ||
      (plan.schema === "solar.native-composition.plan/2" &&
        !Array.isArray(plan.coverageSurfaces)) ||
      typeof plan.producer_id !== "string" ||
      typeof plan.planHash !== "string"
    )
      throw new Error("NATIVE_COMPOSITION_GRAPH_INVALID");
  }
  for (const [graphId, graph] of Object.entries(graphs)) {
    const plan = graph as Record<string, unknown>;
    if (producers[graphId] !== plan.producer_id)
      throw new Error("NATIVE_COMPOSITION_GRAPH_OWNER_MISMATCH");
  }
  return state as unknown as CompositionState;
}

function isBaseMismatch(error: unknown): boolean {
  const candidate = record(error);
  return (
    candidate?.code === "BASE_MISMATCH" ||
    (error instanceof Error && /BASE_MISMATCH/.test(error.message))
  );
}

function randomTransactionId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Publish a Solar-owned plan on its own LSDP resource without blocking frame ACKs. */
export class NativeCompositionPublisher {
  private readonly peer: Peer;
  private readonly abort = new AbortController();
  private pendingSnapshot: Deferred<Snapshot> | null = null;
  private pendingAction: QueuedAction | null = null;
  private draining = false;
  private retiring = false;
  private retired = false;
  private disconnected = false;
  private retirement: Promise<void> | null = null;

  constructor(
    private readonly options: PublisherOptions,
    private readonly onError: (error: unknown) => void,
    createPeer: NativeCompositionPeerFactory = (url, peerOptions) =>
      new BrowserLSDP(url, peerOptions),
    private readonly onDisconnected: (error: unknown) => void = () => {},
  ) {
    this.peer = createPeer(options.url, {
      authToken: options.authToken,
      onTransaction: (value, context) => this.receiveSnapshot(value, context),
      onIncomingFailed: (_context, error) =>
        this.pendingSnapshot?.reject(error),
      onClose: (error) => {
        this.pendingSnapshot?.reject(error);
        if (!this.retiring && !this.retired) {
          this.disconnected = true;
          try {
            this.onError(error);
          } finally {
            this.onDisconnected(error);
          }
        }
      },
    });
  }

  publish(
    projection: NativeCompositionProjection | null,
    document: { scene_id: string; scene_version: string },
    stateHash: string,
  ): Promise<NativeCompositionPublishResult> {
    if (this.retiring || this.retired) return Promise.resolve("retired");
    const plan =
      projection && projection.groups.length > 0
        ? withNativeCompositionSource(projection, this.options.producer_id, {
            resource: this.options.source.resource,
            ...(this.options.source.selector
              ? { selector: this.options.source.selector }
              : {}),
            scene_id: document.scene_id,
            scene_version: document.scene_version,
            stateHash,
          })
        : null;
    return this.enqueueLatest(() =>
      plan ? this.write(plan) : this.clearOwnedGraph(),
    );
  }

  clear(): Promise<NativeCompositionPublishResult> {
    if (this.retiring || this.retired) return Promise.resolve("retired");
    return this.enqueueLatest(() => this.clearOwnedGraph());
  }

  retire(): Promise<void> {
    if (this.retirement) return this.retirement;
    if (this.retired) return Promise.resolve();
    if (this.disconnected) {
      this.discard();
      return Promise.resolve();
    }
    this.retiring = true;
    const completion = deferred<NativeCompositionPublishResult>();
    this.replacePending({
      action: async () => {
        try {
          await this.clearOwnedGraph();
        } finally {
          this.retired = true;
          this.abort.abort(new Error("Composition publisher retired."));
          this.peer.close();
        }
      },
      completions: [completion],
    });
    this.retirement = completion.promise.then(() => undefined);
    return this.retirement;
  }

  /** Close an unusable peer without attempting a remote clear over it. */
  discard(): void {
    if (this.retired) return;
    this.retiring = true;
    this.retired = true;
    const error = new Error("Composition publisher discarded.");
    this.pendingSnapshot?.reject(error);
    this.pendingSnapshot = null;
    this.pendingAction?.completions.forEach((completion) =>
      completion.resolve("retired"),
    );
    this.pendingAction = null;
    this.abort.abort(error);
    this.peer.close();
  }

  /**
   * A composition is derived latest-state output, not an LSML receipt. Keep
   * one active read/write and replace at most one not-yet-started action.
   * A superseded waiter resolves explicitly as skipped, not as a publish
   * receipt. The result never changes LSML mutation receipts or frame ACKs.
   */
  private enqueueLatest(
    action: () => Promise<void>,
  ): Promise<NativeCompositionPublishResult> {
    if (this.retiring || this.retired || this.disconnected)
      return Promise.resolve("retired");
    const completion = deferred<NativeCompositionPublishResult>();
    if (this.pendingAction)
      this.pendingAction.completions.forEach((pending) =>
        pending.resolve("superseded"),
      );
    this.pendingAction = { action, completions: [completion] };
    this.pump();
    return completion.promise;
  }

  private replacePending(action: QueuedAction): void {
    this.pendingAction?.completions.forEach((pending) =>
      pending.resolve("superseded"),
    );
    this.pendingAction = action;
    this.pump();
  }

  private pump(): void {
    if (this.draining || !this.pendingAction) return;
    this.draining = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pendingAction) {
        const pending = this.pendingAction;
        this.pendingAction = null;
        try {
          await pending.action();
          pending.completions.forEach((completion) =>
            completion.resolve("completed"),
          );
        } catch (error) {
          pending.completions.forEach((completion) => completion.reject(error));
        }
      }
    } finally {
      this.draining = false;
      if (this.pendingAction) this.pump();
    }
  }

  private async receiveSnapshot(
    value: unknown,
    context: IncomingContext,
  ): Promise<unknown> {
    const pending = this.pendingSnapshot;
    if (
      !pending ||
      context.metadata.profile !== "lsdp.state.read/1" ||
      context.metadata.target !== this.options.resource
    )
      throw new Error("NATIVE_COMPOSITION_SNAPSHOT_INVALID");
    try {
      const state = compositionState(value);
      pending.resolve({ state, stateHash: nativeTreeHash(value) });
      return { level: "received" };
    } catch (error) {
      pending.reject(error);
      throw error;
    }
  }

  private async read(): Promise<Snapshot> {
    const pending = deferred<Snapshot>();
    this.pendingSnapshot = pending;
    try {
      await this.peer.ready;
      await this.peer.transaction(
        { kind: "state.read", target: this.options.resource },
        { signal: this.abort.signal },
      );
      return await pending.promise;
    } catch (error) {
      pending.reject(error);
      throw error;
    } finally {
      if (this.pendingSnapshot === pending) this.pendingSnapshot = null;
    }
  }

  private async apply(
    beforeHash: string,
    operations: Operation[],
  ): Promise<void> {
    await this.peer.transaction(
      {
        format: "lsdp.apply/1",
        id: randomTransactionId(),
        target: this.options.resource,
        beforeHash,
        operations,
        require: "applied",
      },
      { signal: this.abort.signal },
    );
  }

  private async write(plan: NativeCompositionPlan): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { state, stateHash } = await this.read();
      if (state.producers[this.options.graph] !== this.options.producer_id)
        return;
      const current = state.graphs[this.options.graph];
      if (current && current.producer_id !== this.options.producer_id)
        throw new Error("NATIVE_COMPOSITION_GRAPH_OWNER_MISMATCH");
      if (
        current?.producer_id === this.options.producer_id &&
        current.planHash === plan.planHash
      ) {
        return;
      }
      const operations: Operation[] = [
        {
          op: current === undefined ? "add" : "replace",
          path: `/graphs/${this.options.graph}`,
          value: plan,
        },
      ];
      try {
        await this.apply(stateHash, operations);
        return;
      } catch (error) {
        if (attempt === 3 || !isBaseMismatch(error)) throw error;
      }
    }
  }

  private async clearOwnedGraph(): Promise<void> {
    if (this.retired) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { state, stateHash } = await this.read();
      if (state.producers[this.options.graph] !== this.options.producer_id)
        return;
      const current = state.graphs[this.options.graph];
      if (!current || current.producer_id !== this.options.producer_id) return;
      try {
        await this.apply(stateHash, [
          { op: "remove", path: `/graphs/${this.options.graph}` },
        ]);
        return;
      } catch (error) {
        if (attempt === 3 || !isBaseMismatch(error)) throw error;
      }
    }
  }
}
