// ADR Blue 009 §3.2–3.3 (axe 1, antenne) — the runtime-hook-driven activation of
// the `x-zab.meet-peer` path on the ANTENNE.
//
// On the antenne there is no Prism scene-server to pin `__ZAB_PEER_VIEWER__`
// before mount : the receive-only viewer credentials (`__cam.viewer`) and the
// slot→peer projection (`__cam.slots.*`) arrive ASYNC, carried on Orion's LSDP
// bundle and surfaced by the Lumencast runtime (≥ 0.11.0) through
// `MountOptions.onReservedLeaves` — the full snapshot of the projection on every
// change (never deltas). This controller is the host-side sink :
//
//   - `leaves.viewer` → arm (or reconcile) the multi-room peer viewer : on first
//     usable creds it creates the viewer, joins every room RECEIVE-ONLY (no
//     publish), and builds the slotRef-aware registry of #29 over the viewer's
//     `peer_label`-keyed `PeerStreamRegistry`. A later emission reconciles the
//     live room set via `setRooms()`.
//   - `leaves.slots` → reconcile the snapshot onto the slot-binding registry :
//     every present `slotRef → peer_label` is `assign`-ed ; a slotRef that has
//     DISAPPEARED from the snapshot is released (`assign(slotRef, null)`) so its
//     `x-zab.meet-peer` node falls back to its transparent placeholder.
//
// `mount()` threads this controller's STABLE resolvers into the runtime at mount
// time (before the viewer exists), so `x-zab.meet-peer` nodes resolve through it
// the instant the hook arms the viewer. A subscription taken before the viewer is
// armed is buffered (placeholder meanwhile) and replayed onto the real registry
// on arm — though in practice the runtime emits the reserved leaves while applying
// the snapshot, before it renders the nodes.
//
// Pure host glue : it owns no WebRTC and no DOM ; the viewer owns the peer
// connections + track lifecycle, the registry owns `peer_label → MediaStream`.

import type {
  MultiRoomPeerViewer,
  MultiRoomPeerViewerOptions,
  PeerStreamListener,
  ReservedCamLeaves,
} from "@lumencast/runtime";
import { viewerInjectionFromLeaf } from "./injection";
import { createSlotBindingRegistry, type SlotBindingRegistry } from "./slot-binding";

export interface AntenneController {
  /** Stable `resolvePeerStream` to thread into the runtime at mount. Resolves a
   *  node key (a `slotRef`, or a bare `peer_label`) to its live stream, or `null`
   *  (placeholder) before the viewer is armed / when the peer is absent. */
  resolvePeerStream: (key: string) => MediaStream | null;
  /** Stable `subscribePeerStream` to thread into the runtime at mount. Reactive ;
   *  buffered until the viewer is armed, then replayed onto the real registry. */
  subscribePeerStream: (key: string, listener: PeerStreamListener) => () => void;
  /** Sink for `MountOptions.onReservedLeaves` — reconciles the full projection. */
  applyReservedLeaves: (leaves: ReservedCamLeaves) => void;
  /** Tear down : leave the mesh (drops the peer connections) and drop the unload
   *  hook. Idempotent. */
  leave: () => void;
}

export interface AntenneControllerDeps {
  /** Viewer factory — `createPeerViewerFromInjection` in production, a stub in
   *  tests. Receives the normalised multi-room injection. */
  createViewer: (injection: MultiRoomPeerViewerOptions) => MultiRoomPeerViewer;
  /** Surfaced when a join / reconcile rejects — a failure must not take the scene
   *  down (the rest still renders). */
  onJoinError?: (err: unknown) => void;
}

// A subscription taken before the viewer is armed. Replayed on arm ; `unsub` is
// filled then so the caller's returned teardown reaches the real registry.
interface BufferedSub {
  key: string;
  listener: PeerStreamListener;
  unsub?: () => void;
  cancelled: boolean;
}

export function createAntenneController(deps: AntenneControllerDeps): AntenneController {
  let viewer: MultiRoomPeerViewer | null = null;
  let slots: SlotBindingRegistry | null = null;
  // The slotRefs currently bound by the last applied snapshot — used to release
  // a slot that has disappeared from a newer snapshot.
  let boundSlots: ReadonlySet<string> = new Set();
  const buffered: BufferedSub[] = [];
  let unloadHooked = false;

  const leave = (): void => {
    if (unloadHooked && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", leave);
      unloadHooked = false;
    }
    viewer?.leave();
  };

  // First usable creds : create the viewer + slot registry, join receive-only,
  // and replay any subscriptions taken before arming.
  const arm = (injection: MultiRoomPeerViewerOptions): void => {
    viewer = deps.createViewer(injection);
    slots = createSlotBindingRegistry(viewer.registry);
    for (const b of buffered) {
      if (!b.cancelled) b.unsub = slots.subscribe(b.key, b.listener);
    }
    buffered.length = 0;
    if (typeof window !== "undefined") {
      // A webview reload/close doesn't run leave() (the host owns that) — leave
      // the mesh on unload so the server drops this viewer immediately instead of
      // waiting for the heartbeat / TCP timeout (no `solar-viewer` ghosts).
      window.addEventListener("beforeunload", leave);
      unloadHooked = true;
    }
    void viewer.join().catch((err: unknown) => deps.onJoinError?.(err));
  };

  const reconcileSlots = (snapshot: Record<string, string>): void => {
    if (slots === null) return;
    for (const [slotRef, peerLabel] of Object.entries(snapshot)) {
      slots.assign(slotRef, peerLabel);
    }
    for (const slotRef of boundSlots) {
      if (!(slotRef in snapshot)) slots.assign(slotRef, null);
    }
    boundSlots = new Set(Object.keys(snapshot));
  };

  return {
    resolvePeerStream: (key) => slots?.resolve(key) ?? null,

    subscribePeerStream: (key, listener) => {
      if (slots !== null) return slots.subscribe(key, listener);
      // Pre-arm : placeholder now, buffer for replay on arm.
      const b: BufferedSub = { key, listener, cancelled: false };
      buffered.push(b);
      listener(null);
      return () => {
        b.cancelled = true;
        b.unsub?.();
      };
    },

    applyReservedLeaves: (leaves) => {
      const injection = viewerInjectionFromLeaf(leaves.viewer);
      if (injection !== null) {
        if (viewer === null) arm(injection);
        else void viewer.setRooms(injection.rooms).catch((err: unknown) => deps.onJoinError?.(err));
      }
      reconcileSlots(leaves.slots);
    },

    leave,
  };
}
