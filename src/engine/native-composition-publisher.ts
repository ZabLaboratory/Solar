import { BrowserLSDP } from "../../vendor/lsdp-native-browser/src/browser.js";
import type { IncomingContext } from "../../vendor/lsdp-native-browser/src/browser.js";
import type { Operation } from "fast-json-patch";
import jsonPatch from "fast-json-patch";
import { NativeState } from "../internal/native-state";
import { captureTranslationGuard } from "../scenes/capture-translation-guard";
import {
  withNativeCompositionSource,
  type NativeCompositionPlan,
  type NativeCompositionProjection,
} from "../scenes/native-composition";
import type { NativeCompositionLSDPOptions, NativeLSDPOptions } from "../types";
import {
  requireNativeCompositionState,
  type NativeCompositionState,
} from "../scenes/native-composition-state";

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

interface Snapshot {
  state: NativeCompositionState;
  tree: NativeState;
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

/** Keep one atomic publication, but do not retransmit an entire unchanged atlas
 * for an unambiguous capture translation. Any other difference takes the full
 * replacement path. */
function captureTranslationOperations(
  current: NativeCompositionPlan,
  next: NativeCompositionPlan,
  graph: "A" | "B",
): Operation[] | null {
  const oldGuard = current.source?.captureTranslationGuard;
  const nextGuard = next.source?.captureTranslationGuard;
  if (
    !oldGuard ||
    !nextGuard ||
    oldGuard.hash !== nextGuard.hash ||
    JSON.stringify(oldGuard.components) !== JSON.stringify(nextGuard.components)
  )
    return null;
  const changes = jsonPatch.compare(current, next);
  let moved = false;
  for (const change of changes) {
    if (change.op !== "replace") return null;
    if (change.path === "/planHash" || change.path === "/source/stateHash")
      continue;
    const match = /^\/groups\/(\d+)\/children\/(\d+)\/affine\/(?:tx|ty)$/.exec(
      change.path,
    );
    if (!match) return null;
    const before = current.groups[Number(match[1])]?.children[Number(match[2])];
    const after = next.groups[Number(match[1])]?.children[Number(match[2])];
    if (
      before?.kind !== "capture" ||
      after?.kind !== "capture" ||
      before.sourceComponentId !== after.sourceComponentId ||
      !oldGuard.components.includes(before.sourceComponentId)
    )
      return null;
    moved = true;
  }
  return moved
    ? changes.map((change) => ({
        ...change,
        path: `/graphs/${graph}${change.path}`,
      }))
    : null;
}

/** Publish a Solar-owned plan on its own LSDP resource without blocking frame ACKs. */
export class NativeCompositionPublisher {
  private readonly peer: Peer;
  private readonly abort = new AbortController();
  private pendingSnapshot: Deferred<Snapshot> | null = null;
  private lastAcceptedSnapshot: Snapshot | null = null;
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
        this.lastAcceptedSnapshot = null;
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
    document: { scene_id: string; scene_version: string } & Record<
      string,
      unknown
    >,
    stateHash: string,
  ): Promise<NativeCompositionPublishResult> {
    if (this.retiring || this.retired) return Promise.resolve("retired");
    let guard: ReturnType<typeof captureTranslationGuard> = null;
    if (projection) {
      try {
        guard = captureTranslationGuard(
          document,
          projection.groups.flatMap((group) =>
            group.children.flatMap((child) =>
              child.kind === "capture" ? [child.sourceComponentId] : [],
            ),
          ),
        );
      } catch {
        // An unclassifiable document keeps the strict source-hash path.
      }
    }
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
            ...(guard ? { captureTranslationGuard: guard } : {}),
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
    this.lastAcceptedSnapshot = null;
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
      const tree = NativeState.from(value);
      pending.resolve({
        state: requireNativeCompositionState(tree.value),
        tree,
      });
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
  ): Promise<{ receipt: unknown; transactionId: string }> {
    const transactionId = randomTransactionId();
    const receipt = await this.peer.transaction(
      {
        format: "lsdp.apply/1",
        id: transactionId,
        target: this.options.resource,
        beforeHash,
        operations,
        require: "applied",
      },
      { signal: this.abort.signal },
    );
    return { receipt, transactionId };
  }

  private async write(plan: NativeCompositionPlan): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cached = this.lastAcceptedSnapshot;
      const snapshot =
        cached &&
        cached.state.graphs[this.options.graph]?.planHash !== plan.planHash
          ? cached
          : await this.read();
      const { state, tree } = snapshot;
      if (state.producers[this.options.graph] !== this.options.producer_id)
        return;
      const current = state.graphs[this.options.graph];
      if (current && current.producer_id !== this.options.producer_id)
        throw new Error("NATIVE_COMPOSITION_GRAPH_OWNER_MISMATCH");
      if (
        current?.producer_id === this.options.producer_id &&
        current.planHash === plan.planHash
      ) {
        this.lastAcceptedSnapshot = null;
        return;
      }
      const operations: Operation[] = (current &&
        captureTranslationOperations(current, plan, this.options.graph)) || [
        {
          op: current === undefined ? "add" : "replace",
          path: `/graphs/${this.options.graph}`,
          value: plan,
        },
      ];
      try {
        const applied = await this.apply(tree.stateHash, operations);
        const receipt = record(applied.receipt);
        // lsdp.apply/1 acknowledges the transaction, target and guarantee but
        // does not return a state hash. Applying these exact operations to the
        // accepted baseline determines the next hash locally. It is only a CAS
        // candidate: a concurrent change makes the next write re-read Rust.
        this.lastAcceptedSnapshot = null;
        if (
          receipt?.target === this.options.resource &&
          receipt.transactionId === applied.transactionId &&
          (receipt.level === "applied" || receipt.level === "persisted")
        ) {
          const next = tree.patch(operations);
          if (
            receipt.stateHash === undefined ||
            receipt.stateHash === next.stateHash
          )
            this.lastAcceptedSnapshot = {
              state: requireNativeCompositionState(next.value),
              tree: next,
            };
        }
        return;
      } catch (error) {
        this.lastAcceptedSnapshot = null;
        if (attempt === 3 || !isBaseMismatch(error)) throw error;
      }
    }
  }

  private async clearOwnedGraph(): Promise<void> {
    if (this.retired) return;
    // Retire/clear must observe current ownership even after a successful write.
    this.lastAcceptedSnapshot = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { state, tree } = await this.read();
      if (state.producers[this.options.graph] !== this.options.producer_id)
        return;
      const current = state.graphs[this.options.graph];
      if (!current || current.producer_id !== this.options.producer_id) return;
      try {
        await this.apply(tree.stateHash, [
          { op: "remove", path: `/graphs/${this.options.graph}` },
        ]);
        return;
      } catch (error) {
        if (attempt === 3 || !isBaseMismatch(error)) throw error;
      }
    }
  }
}
