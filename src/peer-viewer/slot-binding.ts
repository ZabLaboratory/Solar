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

/** Positional slot key (ADR Blue 009 axe 1, positional variant). A node whose
 *  `slotRef` is `@<n>` (n ≥ 0) fills with the n-th peer IN ARRIVAL ORDER : `@0`
 *  = first peer connected, `@1` = second, … It carries NO authored peer identity
 *  and NO LSDP `__cam.slots.*` binding — it resolves purely against the runtime's
 *  arrival-ordered roster (`PeerStreamRegistry.orderedLabels()`), and re-keys
 *  REACTIVELY when a peer connects or leaves (a departure shifts every later
 *  position up by one). Distinct from an authored `slotRef` (LSDP-assigned) and
 *  from a bare `peer_label` (verbatim pass-through). */
const POSITIONAL_KEY = /^@(\d+)$/;

const positionOf = (key: string): number | null => {
  const m = POSITIONAL_KEY.exec(key);
  return m === null ? null : Number(m[1]);
};

/** Snapshot of slot→peer assignments (the LSDP `__cam.slots.*` subtree). */
export type SlotBindings = Readonly<Record<string, string>>;

export interface SlotBindingRegistry {
  /** Apply an assignment delta. `peerLabel === null` releases the slot (the slot
   *  falls back to its placeholder). Re-notifies the slot's live listeners. */
  assign(slotRef: string, peerLabel: string | null): void;
  /** The `peer_label` currently bound to a slot, or `null` when unbound. */
  boundPeer(slotRef: string): string | null;
  /** Resolve a node key — an authored `slotRef` (translated via the current
   *  binding), a positional `@<n>` (the n-th peer in arrival order), or a bare
   *  `peer_label` (pass-through) — to its live stream. Unbound slot, out-of-range
   *  position, or unconnected peer → `null` (placeholder). Synchronous, side-effect
   *  free. */
  resolve(key: string): MediaStream | null;
  /** Reactive variant : invoked immediately with the current value, then on every
   *  change — re-keys on a slot reassignment, follows the resolved peer's
   *  connect/leave, AND (for a positional `@<n>` key) re-resolves when the roster
   *  order shifts. Returns an unsubscribe. */
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
  // Positional keys (`@<n>`) additionally watch the roster : a connect/leave
  // shuffles arrival order, so the key may now resolve to a different peer.
  const rosterUnsub = new Map<string, () => void>();

  // The peer_label a key currently resolves against : the slot's binding when the
  // key names a bound slot ; the n-th arrival for a positional `@<n>` key ; else
  // the key verbatim (bare peer_label). `null` = nothing to resolve (a positional
  // key past the end of the roster) → placeholder.
  const peerLabelOf = (key: string): string | null => {
    const bound = bindings.get(key);
    if (bound !== undefined) return bound;
    const pos = positionOf(key);
    if (pos !== null) return peers.orderedLabels()[pos] ?? null;
    return key;
  };

  const resolve = (key: string): MediaStream | null => {
    const label = peerLabelOf(key);
    return label === null ? null : peers.resolve(label);
  };

  const notify = (key: string): void => {
    const set = listeners.get(key);
    if (set === undefined) return;
    const stream = resolve(key);
    for (const l of set) l(stream);
  };

  // (Re)bind the underlying peer-registry subscription for `key` to its current
  // resolved peer_label. Called when the first listener subscribes, on every
  // reassign, and (positional keys) on every roster shift. Always fans out the
  // current value — directly when there is no peer to watch (out-of-range
  // position / unbound slot), else via the registry's immediate emit.
  const wire = (key: string): void => {
    peerUnsub.get(key)?.();
    const label = peerLabelOf(key);
    if (label === null) {
      peerUnsub.delete(key);
      notify(key); // no peer to subscribe to → emit the placeholder
    } else {
      peerUnsub.set(key, peers.subscribe(label, () => notify(key)));
    }
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
        // A positional key re-resolves when arrivals/departures shift the order :
        // re-wire to the new n-th peer and fan out the new value.
        if (positionOf(key) !== null) {
          rosterUnsub.set(
            key,
            peers.subscribeRoster(() => wire(key)),
          );
        }
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
          rosterUnsub.get(key)?.();
          rosterUnsub.delete(key);
        }
      };
    },
  };
}
