// ADR Blue 009 §3.1–3.3 (axe 1) — slotRef re-keying over the peer-stream
// registry. Exercises slotRef→peer_label→track resolution from a SIMULATED LSDP
// `__cam.slots.*` delta, the unbound-slot → placeholder rule, instant re-keying,
// and the bare-`peer_label` pass-through (preview non-regression).

import { describe, expect, it, vi } from "vitest";
import type { PeerStreamListener, PeerStreamRegistry } from "@lumencast/runtime";
import {
  CAM_SLOTS_PREFIX,
  createSlotBindingRegistry,
} from "../../src/peer-viewer/slot-binding";

/** A fake `peer_label`-keyed registry : streams are plain sentinels (no real
 *  MediaStream needed). `set`/`remove` push to subscribers, mirroring the
 *  runtime's reactive `PeerStreamRegistry`. */
function fakePeerRegistry(): PeerStreamRegistry & {
  push: (peerLabel: string, stream: MediaStream | null) => void;
} {
  const streams = new Map<string, MediaStream>();
  const subs = new Map<string, Set<PeerStreamListener>>();
  const push = (peerLabel: string, stream: MediaStream | null): void => {
    if (stream === null) streams.delete(peerLabel);
    else streams.set(peerLabel, stream);
    for (const l of subs.get(peerLabel) ?? []) l(stream);
  };
  return {
    resolve: (peerLabel) => streams.get(peerLabel) ?? null,
    subscribe: (peerLabel, listener) => {
      let set = subs.get(peerLabel);
      if (set === undefined) {
        set = new Set();
        subs.set(peerLabel, set);
      }
      set.add(listener);
      listener(streams.get(peerLabel) ?? null);
      return () => set.delete(listener);
    },
    set: (peerLabel, stream) => push(peerLabel, stream),
    remove: (peerLabel) => push(peerLabel, null),
    clear: () => {
      streams.clear();
    },
    push,
  };
}

const streamFor = (id: string): MediaStream => ({ id }) as unknown as MediaStream;

describe("slot-binding registry", () => {
  it("resolves slotRef → peer_label → track from a simulated LSDP delta", () => {
    const peers = fakePeerRegistry();
    const cam = streamFor("cam-1");
    peers.push("alice", cam);
    const reg = createSlotBindingRegistry(peers);

    // No binding yet → placeholder.
    expect(reg.resolve("cam-caster-1")).toBeNull();

    // LSDP delta `__cam.slots.cam-caster-1` = "alice".
    reg.assign("cam-caster-1", "alice");

    expect(reg.boundPeer("cam-caster-1")).toBe("alice");
    expect(reg.resolve("cam-caster-1")).toBe(cam);
  });

  it("seeds bindings from an initial snapshot", () => {
    const peers = fakePeerRegistry();
    const cam = streamFor("cam-2");
    peers.push("bob", cam);
    const reg = createSlotBindingRegistry(peers, { "cam-caster-2": "bob" });
    expect(reg.resolve("cam-caster-2")).toBe(cam);
  });

  it("renders the placeholder (null) for an unbound slot", () => {
    const reg = createSlotBindingRegistry(fakePeerRegistry());
    expect(reg.resolve("cam-unbound")).toBeNull();
    const listener = vi.fn();
    reg.subscribe("cam-unbound", listener);
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it("releases a slot back to placeholder on a null delta", () => {
    const peers = fakePeerRegistry();
    peers.push("alice", streamFor("cam-1"));
    const reg = createSlotBindingRegistry(peers, { "cam-caster-1": "alice" });
    expect(reg.resolve("cam-caster-1")).not.toBeNull();
    reg.assign("cam-caster-1", null);
    expect(reg.boundPeer("cam-caster-1")).toBeNull();
    expect(reg.resolve("cam-caster-1")).toBeNull();
  });

  it("re-keys a live slot instantly on a reassignment delta", () => {
    const peers = fakePeerRegistry();
    const camA = streamFor("cam-A");
    const camB = streamFor("cam-B");
    peers.push("alice", camA);
    peers.push("bob", camB);
    const reg = createSlotBindingRegistry(peers, { "cam-caster-1": "alice" });

    const seen: (MediaStream | null)[] = [];
    reg.subscribe("cam-caster-1", (s) => seen.push(s));
    expect(seen.at(-1)).toBe(camA);

    reg.assign("cam-caster-1", "bob");
    expect(reg.resolve("cam-caster-1")).toBe(camB);
    expect(seen.at(-1)).toBe(camB);
  });

  it("follows the bound peer connecting after the slot is wired", () => {
    const peers = fakePeerRegistry();
    const reg = createSlotBindingRegistry(peers, { "cam-caster-1": "alice" });
    const seen: (MediaStream | null)[] = [];
    reg.subscribe("cam-caster-1", (s) => seen.push(s));
    expect(seen.at(-1)).toBeNull(); // alice not connected yet → placeholder

    const cam = streamFor("cam-late");
    peers.push("alice", cam); // peer joins mid-show
    expect(seen.at(-1)).toBe(cam);
  });

  it("passes a bare peer_label key straight through (meet.peer back-compat)", () => {
    const peers = fakePeerRegistry();
    const cam = streamFor("cam-direct");
    peers.push("carol", cam);
    const reg = createSlotBindingRegistry(peers, { "cam-caster-1": "alice" });
    // "carol" is not a slot → resolves as a direct peer_label.
    expect(reg.resolve("carol")).toBe(cam);
  });

  it("stops notifying after unsubscribe", () => {
    const peers = fakePeerRegistry();
    const reg = createSlotBindingRegistry(peers, { "cam-caster-1": "alice" });
    const listener = vi.fn();
    const off = reg.subscribe("cam-caster-1", listener);
    listener.mockClear();
    off();
    peers.push("alice", streamFor("cam-x"));
    reg.assign("cam-caster-1", "bob");
    expect(listener).not.toHaveBeenCalled();
  });

  it("exposes the LSDP leaf prefix Orion emits", () => {
    expect(CAM_SLOTS_PREFIX).toBe("__cam.slots.");
  });
});
