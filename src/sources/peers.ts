import type {
  createPeerViewerFromInjection,
  MountOptions as RuntimeMountOptions,
  ResolvePeerStream,
  SubscribePeerStream,
} from "@lumencast/runtime";
import type { MountOptions } from "../types";
import {
  publisherOfferViewerInjection,
  readPeerViewerChannel,
  readPeerViewerInjection,
  ZAB_PEER_VIEWER_GLOBAL,
} from "../peer-viewer/injection";
import { createAntenneController } from "../peer-viewer/antenne-controller";
import { createSlotBindingRegistry } from "../peer-viewer/slot-binding";

export interface PeerSources {
  resolvePeerStream: ResolvePeerStream;
  subscribePeerStream: SubscribePeerStream;
  onReservedLeaves?: RuntimeMountOptions["onReservedLeaves"];
  dispose: () => void;
}

/**
 * The embedded Prism host and the standalone Antenne both use the same
 * receive-only viewer glue, but only the embedded host is guaranteed to have
 * the Meet publishers on the local network.  Keep the historical relay-only
 * policy for a genuinely remote host while allowing local candidates for the
 * loopback Orion runtime.  This is a WebRTC transport choice only; it does not
 * alter the LSDP wire, scene graph, Pulsar, or lane ownership.
 */
function isLocalOrionUrl(orionUrl: string): boolean {
  try {
    const parsed = new URL(orionUrl);
    return /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Owns the host peer session; the renderer only consumes its stream resolvers. */
export function createPeerSources(
  options: Pick<MountOptions, "nativeLSDP" | "onError">,
  createViewer: typeof createPeerViewerFromInjection,
): PeerSources {
  const localOrion = isLocalOrionUrl(options.nativeLSDP.url);

  // ADR 006 #3 / ADR Blue 009 §3.2–3.3 — bridge receive-only Meet peer streams
  // into the runtime's LIVE `media` / `x-zab.meet-peer` primitives. The viewer
  // OWNS the peer connections + track lifecycle ; the primitive is a pure
  // consumer (RC-ReadOnly : never mutates the scene ; RC-Geo enforced inside the
  // primitive — the stream fills the node's box). Two activation paths :
  //
  //   PRISM LOCAL SOLAR (Preview + local live browser_source) — the
  //     scene-server pins `__ZAB_PEER_VIEWER__` BEFORE mount and may also expose
  //     the loopback room-reconciliation channel. Read synchronously, join
  //     every room, and apply channel snapshots to the already-mounted viewer.
  //     The reserved-leaf hook is NOT registered (these pages carry no
  //     `__cam.*` projection).
  //
  //   ANTENNE (Pulsar CEF) — there is no Prism : the viewer creds + slot→peer
  //     projection arrive ASYNC on Orion's LSDP, surfaced by the runtime
  //     (≥ 0.11.0) via `onReservedLeaves`. A slot-aware controller is threaded at
  //     mount and armed by the hook (`leaves.viewer` → join receive-only ;
  //     `leaves.slots` → re-key `x-zab.meet-peer` nodes by `slotRef`). The legacy
  //     `__ZAB_LSDP_PEER_VIEWER__` global (#29) still arms it synchronously for
  //     back-compat.
  const {
    injection: peerViewerInjection,
    slotBindings,
    fromLsdp,
    fromPrism,
  } = readPeerViewerInjection();
  const disablePeerViewer =
    (globalThis as { __ZAB_DISABLE_PEER_VIEWER__?: unknown })
      .__ZAB_DISABLE_PEER_VIEWER__ === true;
  // A local Prism browser_source is still a Prism-owned Solar document even
  // when the vendored runtime has also exposed an LSDP reserved-leaf global.
  // Prefer the same page-global/channel path as Preview in that case.  The
  // previous `!fromLsdp` gate let a stale or auxiliary LSDP leaf divert the
  // live document into the Antenne controller, so Preview received the rooms
  // while the Program browser_source did not.  Remote/standalone hosts keep
  // the Antenne branch exactly as before.
  const peerViewerChannel = readPeerViewerChannel();
  const usePrismLocalViewer =
    (localOrion && (fromPrism || peerViewerChannel !== null)) ||
    (!fromLsdp && (peerViewerInjection !== null || peerViewerChannel !== null));
  let resolvePeerStream: ResolvePeerStream;
  let subscribePeerStream: SubscribePeerStream;
  let onReservedLeaves: RuntimeMountOptions["onReservedLeaves"];
  let teardownPeerViewer: () => void;

  const surfaceJoinError = (err: unknown): void => {
    options.onError?.({
      code: "INTERNAL",
      message: `peer-viewer join failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      recoverable: true,
    });
  };

  if (disablePeerViewer) {
    resolvePeerStream = () => null;
    subscribePeerStream = (_key, listener) => {
      listener(null);
      return () => undefined;
    };
    teardownPeerViewer = () => undefined;
  } else if (usePrismLocalViewer) {
    // PRISM LOCAL SOLAR — join EVERY pinned room and thread the viewer's RAW resolvers
    // (first-connected-wins aggregation, `peer_label`-keyed). A `meet.peer` node
    // that mounts before its peer connects shows a stream-less box and re-renders
    // via `subscribePeerStream` on arrival. A join failure must not take the
    // scene down — surface it through `onError` and let the rest render.
    const peerViewer = createViewer(
      // Both Preview and the local Program browser_source run in Prism's
      // loopback Electron host. Keep relay candidates when configured, but
      // also allow a local host candidate so either return remains useful
      // without a coturn process.
      publisherOfferViewerInjection(peerViewerInjection ?? { rooms: [] }, {
        iceTransportPolicy: "all",
      }),
    );
    void peerViewer.join().catch(surfaceJoinError);
    // Slot-aware on the PREVIEW too (parity with the antenne): wrap the raw
    // `peer_label`-keyed registry with the slot-binding so an `x-zab.meet-peer`
    // node keyed by a positional `@<n>` (auto-fill in arrival order) or a slotRef
    // resolves. A bare `peer_label` passes straight through — a strict superset of
    // the prior raw wiring. Without this the preview resolved `@0` as a LITERAL
    // label → no peer → empty slot, even with the stream received (positional was
    // ANTENNE-only). The registry's `subscribeRoster` drives the re-resolve on a
    // peer connect/leave so a late arrival fills the slot.
    // Prism pins the authored slot snapshot alongside the room credentials.
    // Use it here instead of rebuilding camera identity from WebRTC arrival
    // order. Arrival order is only the fallback for genuinely positional
    // scenes; when `@0`/`@1`/`@2` are explicitly mapped, each Vision texture
    // subscribes to its exact peer before that peer's first track arrives.
    // This also prevents three near-simultaneous joins from leaving one slot
    // behind as a transparent placeholder while the registry already holds
    // all three streams.
    const slots = createSlotBindingRegistry(peerViewer.registry, slotBindings);
    let currentSlotBindings: Record<string, string> = { ...slotBindings };
    let channelSocket: WebSocket | null = null;
    let channelRetry: ReturnType<typeof setTimeout> | null = null;
    let channelStopped = false;
    let stateUpdates = Promise.resolve();

    const applyPeerViewerState = async (state: unknown): Promise<void> => {
      if (typeof state !== "object" || state === null) return;
      const candidate = state as { rooms?: unknown; slots?: unknown };
      if (!Array.isArray(candidate.rooms)) return;
      // Keep the diagnostic global truthful for the already-mounted page. The
      // normaliser below still validates every room before it reaches Meet.
      (globalThis as Record<string, unknown>)[ZAB_PEER_VIEWER_GLOBAL] = state;
      const resolved = readPeerViewerInjection();
      const rooms =
        resolved.injection !== null && "rooms" in resolved.injection
          ? resolved.injection.rooms
          : [];
      // The local multi-room runtime fingerprints credentials and performs an
      // add-first receive-side handoff even when Meet keeps the same opaque
      // room id. Do not call `leave()` here: that would tear down both local
      // consumers before the replacement socket has delivered its first track.
      // The runtime owns the actual replacement lifecycle.
      await peerViewer.setRooms(rooms);
      for (const slotRef of Object.keys(currentSlotBindings)) {
        if (!(slotRef in resolved.slotBindings)) slots.assign(slotRef, null);
      }
      for (const [slotRef, peerLabel] of Object.entries(
        resolved.slotBindings,
      )) {
        slots.assign(slotRef, peerLabel);
      }
      currentSlotBindings = { ...resolved.slotBindings };
    };

    const connectPeerViewerChannel = (): void => {
      if (
        channelStopped ||
        peerViewerChannel === null ||
        typeof globalThis.WebSocket !== "function"
      )
        return;
      const socket = new globalThis.WebSocket(peerViewerChannel.url);
      channelSocket = socket;
      socket.addEventListener("message", (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as {
            type?: unknown;
            state?: unknown;
          };
          if (frame.type !== "peer_viewer") return;
          stateUpdates = stateUpdates
            .then(() => applyPeerViewerState(frame.state))
            .catch(surfaceJoinError);
        } catch {
          // Ignore malformed local control frames; the initial room snapshot
          // remains active and the channel will continue to receive updates.
        }
      });
      socket.addEventListener("close", () => {
        if (channelSocket === socket) channelSocket = null;
        if (channelStopped || channelRetry !== null) return;
        channelRetry = setTimeout(() => {
          channelRetry = null;
          connectPeerViewerChannel();
        }, 250);
      });
      socket.addEventListener("error", () => {
        // The close event schedules the bounded reconnect. No error is allowed
        // to surface into the render path or blank the scene.
      });
    };
    connectPeerViewerChannel();

    const e2eDiagnostics = (
      globalThis as {
        __PRISM_SOLAR_DIAG__?: {
          peerRegistrySnapshot?: () => unknown;
        };
      }
    ).__PRISM_SOLAR_DIAG__;
    if (e2eDiagnostics !== undefined) {
      e2eDiagnostics.peerRegistrySnapshot = () => ({
        labels: peerViewer.registry.orderedLabels(),
        slots: Object.fromEntries(
          Object.keys(currentSlotBindings).map((key) => [
            key,
            {
              peer: slots.boundPeer(key),
              resolved: slots.resolve(key) !== null,
            },
          ]),
        ),
      });
    }
    resolvePeerStream = (key) => slots.resolve(key);
    subscribePeerStream = (key, listener) => slots.subscribe(key, listener);
    const onBeforeUnload = (): void => {
      channelStopped = true;
      if (channelRetry !== null) clearTimeout(channelRetry);
      channelRetry = null;
      channelSocket?.close();
      channelSocket = null;
      peerViewer.leave();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    teardownPeerViewer = () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      onBeforeUnload();
    };
  } else {
    // ANTENNE — slot-aware controller threaded now, armed by the runtime hook
    // (and synchronously by a mount-time `__ZAB_LSDP_PEER_VIEWER__` global, #29).
    // `x-zab.meet-peer` nodes resolve through it ; a bare `peer_label` passes
    // straight through, so this is a strict superset of the `meet.peer` path.
    const controller = createAntenneController({
      createViewer: (injection) =>
        createViewer(
          publisherOfferViewerInjection(
            injection,
            localOrion ? { iceTransportPolicy: "all" } : {},
          ),
        ),
      onJoinError: surfaceJoinError,
    });
    if (peerViewerInjection !== null) {
      // Back-compat : a mount-time LSDP global already carries the antenne creds
      // (+ slot snapshot) — arm the controller exactly as the hook would.
      controller.applyReservedLeaves({
        viewer: publisherOfferViewerInjection(peerViewerInjection),
        slots: slotBindings,
      });
    }
    resolvePeerStream = controller.resolvePeerStream;
    subscribePeerStream = controller.subscribePeerStream;
    onReservedLeaves = (leaves) => controller.applyReservedLeaves(leaves);
    teardownPeerViewer = () => controller.leave();
  }

  return {
    resolvePeerStream,
    subscribePeerStream,
    ...(onReservedLeaves ? { onReservedLeaves } : {}),
    dispose: teardownPeerViewer,
  };
}
