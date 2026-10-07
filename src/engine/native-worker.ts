import { BrowserLSDP } from "../../vendor/lsdp-native-browser/src/browser.js";
import { NativeState } from "../internal/native-state";
import { workerDigest } from "../internal/native-digest";
import {
  nativeChange,
  scalarOperations,
  type NativeChange,
} from "../internal/native-stream";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (value: unknown) => void;
};
workerDigest(crypto.subtle);
let peer: BrowserLSDP,
  state: NativeState | null = null,
  sequence: number | null = null,
  serial = 0;
const waiting = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const transactions = new Map<number, AbortController>();
const serializedError = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
  ...(error && typeof error === "object" && "code" in error
    ? { code: String(error.code) }
    : {}),
});
scope.onmessage = ({ data }) => {
  if (data.type === "cancel-transaction") {
    transactions.get(data.id)?.abort();
    return;
  }
  if (data.type === "result") {
    const call = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error)
      call?.reject(Object.assign(new Error(data.error.message), data.error));
    else call?.resolve(data.value);
    return;
  }
  if (data.type === "connect") {
    const transport = {
      authToken: data.authToken,
      onClose: (error: Error) =>
        scope.postMessage({ type: "closed", error: serializedError(error) }),
      onIncomingFailed: (
        _context: import("../../vendor/lsdp-native-browser/src/browser.js").IncomingContext,
        error: Error,
      ) => scope.postMessage({ type: "closed", error: serializedError(error) }),
      onTransaction: async (
        value: unknown,
        context: import("../../vendor/lsdp-native-browser/src/browser.js").IncomingContext,
      ) => {
        const id = ++serial;
        const event = value as NativeChange;
        let scalar = false;
        if (context.metadata.target !== data.resource)
          throw new Error("Unexpected native resource.");
        if (context.metadata.profile === "lsdp.state.read/1") {
          state = NativeState.from(value);
          sequence = null;
        } else if (
          context.metadata.profile === "lsdp.state.subscription/1" &&
          event.kind !== "resync"
        ) {
          if (!state) throw new Error("Native snapshot required.");
          const next = nativeChange(state, event, data.resource, sequence);
          scalar =
            !data.selector &&
            scalarOperations(event.mutation.operations) &&
            next.value !== null &&
            typeof next.value === "object" &&
            !(next.value as Record<string, unknown>)["x-solar-transition"];
          state = next;
          sequence = event.sequence;
        }
        const delivered = new Promise<unknown>((resolve, reject) =>
          waiting.set(id, { resolve, reject }),
        );
        const cancelled = () =>
          scope.postMessage({ type: "incoming-cancelled", id });
        context.signal.addEventListener("abort", cancelled, { once: true });
        void delivered
          .finally(() => context.signal.removeEventListener("abort", cancelled))
          .catch(() => {});
        scope.postMessage({
          type: "incoming",
          id,
          value,
          metadata: context.metadata,
        });
        if (scalar) {
          // Application is verified in this isolated LSML thread; no pixel claim.
          void delivered.catch((error) =>
            scope.postMessage({
              type: "closed",
              error: serializedError(error),
            }),
          );
          return {
            level: "received",
            transactionId: event.mutation.id,
            stateHash: state!.stateHash,
          };
        }
        return await delivered;
      },
    };
    peer = new BrowserLSDP(data.url, transport);
    void peer.ready
      .then(() => scope.postMessage({ type: "ready" }))
      .catch((error) =>
        scope.postMessage({ type: "closed", error: serializedError(error) }),
      );
    return;
  }
  if (data.type === "transaction") {
    const abort = new AbortController();
    transactions.set(data.id, abort);
    void peer
      .transaction(data.value, { signal: abort.signal })
      .then((value) =>
        scope.postMessage({ type: "transaction-result", id: data.id, value }),
      )
      .catch((error) =>
        scope.postMessage({
          type: "transaction-result",
          id: data.id,
          error: serializedError(error),
        }),
      )
      .finally(() => transactions.delete(data.id));
  }
};
