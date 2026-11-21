import type { BrowserLSDP } from "../../vendor/lsdp-native-browser/src/browser.js";

/** Hash-pinned snapshot/subscribe handshake; only a verified admitted snapshot supplies its hash. */
export async function readNativeSubscription(
  peer: BrowserLSDP,
  resource: string,
  signal: AbortSignal,
  hash: () => string | null,
  pending: (snapshot: {
    resolve: () => void;
    reject: (error: unknown) => void;
  }) => void,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ready = new Promise<void>((resolve, reject) =>
      pending({ resolve, reject }),
    );
    void ready.catch(() => {});
    await peer.transaction(
      { kind: "state.read", target: resource },
      { signal },
    );
    await ready;
    try {
      await peer.transaction(
        { kind: "subscribe", target: resource, stateHash: hash() },
        { signal },
      );
      return;
    } catch (error) {
      if (
        attempt === 3 ||
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "BASE_MISMATCH"
      )
        throw error;
      signal.throwIfAborted();
    }
  }
}
