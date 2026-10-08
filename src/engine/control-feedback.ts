import { BrowserLSDP } from "../../vendor/lsdp-native-browser/src/browser.js";
import { nativeTreeHash } from "../internal/native-tree";

/** Explicit renderer acknowledgement, separate from the native node's receipt. */
export async function presentationFeedback(
  url: string,
  lane: "program" | "preview",
  value: unknown,
  parent: AbortSignal,
): Promise<void> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(5000)]);
  const peer = new BrowserLSDP(url);
  const close = (): void => peer.close();
  signal.addEventListener("abort", close, { once: true });
  try {
    await peer.ready;
    for (let attempt = 0; attempt < 4; attempt++) {
      let stateHash = "";
      let resolveSnapshot!: () => void;
      let rejectSnapshot!: (error: unknown) => void;
      const snapshot = new Promise<void>((resolve, reject) => {
        resolveSnapshot = resolve;
        rejectSnapshot = reject;
      });
      void snapshot.catch(() => {});
      peer.options.onClose = rejectSnapshot;
      peer.options.onIncomingFailed = (_context, error) =>
        rejectSnapshot(error);
      peer.options.onTransaction = async (state, context) => {
        if (
          context.metadata.profile !== "lsdp.state.read/1" ||
          context.metadata.target !== "orion/state"
        )
          throw new Error("SOLAR_CONTROL_SNAPSHOT_INVALID");
        stateHash = nativeTreeHash(state);
        resolveSnapshot();
        return { level: "received" };
      };
      await peer.transaction(
        { kind: "state.read", target: "orion/state" },
        { signal },
      );
      // The read receipt precedes the separately streamed snapshot.
      await snapshot;
      if (!stateHash) throw new Error("SOLAR_CONTROL_SNAPSHOT_MISSING");
      try {
        await peer.transaction(
          {
            format: "lsdp.apply/1",
            id: crypto.randomUUID().replaceAll("-", ""),
            target: "orion/state",
            beforeHash: stateHash,
            operations: [
              { op: "add", path: `/solar_presentation_${lane}`, value },
            ],
            require: "applied",
          },
          { signal },
        );
        return;
      } catch (error) {
        if (attempt === 3 || !String(error).includes("BASE_MISMATCH"))
          throw error;
      }
    }
  } finally {
    signal.removeEventListener("abort", close);
    peer.close();
  }
}
