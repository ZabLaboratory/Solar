// ADR Blue 009 §3.1–3.3 (axe 1) — re-keying a `peer_label`-addressed peer-stream
// registry by AUTHORED `slotRef`.
//
// The `x-zab.meet-peer` LSML primitive (Lumencast v0.10.0) carries ONLY a
// hash-stable `slotRef` (e.g. `cam-caster-1`) — never a camera identity. Which
// `peer_label` fills a slot is RUNTIME state, ported by Orion on the LSDP as the
// per-slot leaf `__cam.slots.<slotRef>` = "<peer_label>" (§3.3, item 2). This
// registry maps `slotRef → peer_label → MediaStream` on top of the runtime's
// `peer_label`-keyed `PeerStreamRegistry`, and re-keys a slot INSTANTLY when an
// assignment delta arrives (RC4, part Solar).
//
// Invariants:
//  - A slot with NO binding resolves to `null` → the node renders its transparent
//    placeholder (ADR Blue 009 Amendment 2 / R3). Never the wrong default cam.
//  - A bare `peer_label` key (a legacy `meet.peer` node, no slot indirection)
//    passes straight through — preview non-regression, byte-identical resolution.
//  - Reactivity is on BOTH dimensions : an assignment delta (slot → other peer)
//    AND the underlying peer connecting / leaving re-notify the slot's listeners.
//
// Pure logic, no DOM and no WebRTC : it consumes the runtime's `PeerStreamRegistry`
// and is exercised against a simulated LSDP delta in the unit tests.

import type { PeerStreamListener, PeerStreamRegistry } from "@lumencast/runtime";

/** LSDP leaf prefix Orion emits for slot→peer assignments (ADR Blue 009 §3.3).
 *  One scalar leaf per bound slot : `__cam.slots.<slotRef>` = "<peer_label>".
 *  Exported so a future runtime that surfaces LSDP leaves to the host can route
 *  these deltas into `assign()` without re-deriving the wire name. */
export const CAM_SLOTS_PREFIX = "__cam.slots.";

/** Snapshot of slot→peer assignments (the LSDP `__cam.slots.*` subtree). */
export type SlotBindings = Readonly<Record<string, string>>;

export interface SlotBindingRegistry {
  /** Apply an assignment delta. `peerLabel === null` releases the slot (the slot
   *  falls back to its placeholder). Re-notifies the slot's live listeners. */
  assign(slotRef: string, peerLabel: string | null): void;
  /** The `peer_label` currently bound to a slot, or `null` when unbound. */
  boundPeer(slotRef: string): string | null;
  /** Resolve a node key — a `slotRef` (translated via the current binding) or a
   *  bare `peer_label` (pass-through) — to its live stream. Unbound slot or
   *  unconnected peer → `null` (placeholder). Synchronous, side-effect free. */
  resolve(key: string): MediaStream | null;
  /** Reactive variant : invoked immediately with the current value, then on every
   *  change — re-keys on a slot reassignment AND follows the bound peer's
   *  connect/leave. Returns an unsubscribe. */
  subscribe(key: string, listener: PeerStreamListener): () => void;
}

/** Build a slot-aware view over a `peer_label`-keyed peer-stream registry. */
export function createSlotBindingRegistry(
  peers: PeerStreamRegistry,
  initial?: SlotBindings,
): SlotBindingRegistry {
  // slotRef → peer_label. Only ASSIGNED slots are present ; an unbound slot is
  // absent (resolves through as a bare key → no peer → placeholder).
  const bindings = new Map<string, string>();
  if (initial !== undefined) {
    for (const [slotRef, peerLabel] of Object.entries(initial)) {
      if (peerLabel !== "") bindings.set(slotRef, peerLabel);
    }
  }

  // key → fan-out listeners, and the single peer-registry unsubscribe backing
  // that key. `key` is whatever the caller subscribed with (a slotRef, or a bare
  // peer_label).
  const listeners = new Map<string, Set<PeerStreamListener>>();
  const peerUnsub = new Map<string, () => void>();

  // The peer_label a key currently resolves against : the slot's binding when
  // the key names a bound slot, else the key verbatim (bare peer_label).
  const peerLabelOf = (key: string): string => bindings.get(key) ?? key;

  const resolve = (key: string): MediaStream | null => peers.resolve(peerLabelOf(key));

  const notify = (key: string): void => {
    const set = listeners.get(key);
    if (set === undefined) return;
    const stream = resolve(key);
    for (const l of set) l(stream);
  };

  // (Re)bind the underlying peer-registry subscription for `key` to its current
  // peer_label. Called when the first listener subscribes and on every reassign.
  const wire = (key: string): void => {
    peerUnsub.get(key)?.();
    // The registry fires the listener immediately, which fans out the current
    // value to this key's listeners — no separate kickoff needed.
    peerUnsub.set(key, peers.subscribe(peerLabelOf(key), () => notify(key)));
  };

  return {
    assign(slotRef, peerLabel): void {
      if (peerLabel === null || peerLabel === "") bindings.delete(slotRef);
      else bindings.set(slotRef, peerLabel);
      // Only live slots need re-wiring ; dormant ones pick up the binding on
      // their next resolve/subscribe.
      if (listeners.has(slotRef)) wire(slotRef);
    },

    boundPeer(slotRef): string | null {
      return bindings.get(slotRef) ?? null;
    },

    resolve,

    subscribe(key, listener): () => void {
      let set = listeners.get(key);
      if (set === undefined) {
        set = new Set();
        listeners.set(key, set);
        wire(key);
      }
      set.add(listener);
      listener(resolve(key));
      return () => {
        const live = listeners.get(key);
        if (live === undefined) return;
        live.delete(listener);
        if (live.size === 0) {
          listeners.delete(key);
          peerUnsub.get(key)?.();
          peerUnsub.delete(key);
        }
      };
    },
  };
}
