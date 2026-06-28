// Unit coverage for the antenne reserved-leaf controller (ADR Blue 009 §3.2–3.3).
// Drives the controller with a REAL in-memory `peer_label`-keyed registry (so the
// slot-binding reactivity of #29 is exercised end to end) and a stub viewer, with
// NO WebRTC and NO runtime.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createAntenneController } from "../../src/peer-viewer/antenne-controller";
import type { MultiRoomPeerViewer, PeerStreamListener } from "@lumencast/runtime";

/** Minimal `peer_label → MediaStream` registry with the subscribe semantics the
 *  slot-binding registry relies on (fires immediately + on every change). */
function fakeRegistry() {
  const streams = new Map<string, MediaStream>();
  const listeners = new Map<string, Set<PeerStreamListener>>();
  const resolve = (label: string): MediaStream | null => streams.get(label) ?? null;
  const fire = (label: string): void => {
    for (const l of listeners.get(label) ?? []) l(resolve(label));
  };
  return {
    resolve,
    subscribe(label: string, l: PeerStreamListener): () => void {
      let s = listeners.get(label);
      if (s === undefined) listeners.set(label, (s = new Set()));
      s.add(l);
      l(resolve(label));
      return () => s.delete(l);
    },
    set(label: string, stream: MediaStream): void {
      streams.set(label, stream);
      fire(label);
    },
    remove(label: string): void {
      streams.delete(label);
      fire(label);
    },
    clear(): void {
      streams.clear();
    },
  };
}

/** A stub multi-room viewer over a given registry. `join`/`setRooms`/`leave` are
 *  spies ; there is no `publish` surface at all (receive-only by construction). */
function fakeViewer(registry: ReturnType<typeof fakeRegistry>) {
  return {
    join: vi.fn(() => Promise.resolve()),
    leave: vi.fn(),
    setRooms: vi.fn(() => Promise.resolve()),
    resolvePeerStream: (l: string) => registry.resolve(l),
    subscribePeerStream: (l: string, cb: PeerStreamListener) => registry.subscribe(l, cb),
    registry,
  } as unknown as MultiRoomPeerViewer & {
    join: ReturnType<typeof vi.fn>;
    setRooms: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
  };
}

const ROOM = { signalingUrl: "wss://meet/ws", roomId: "r", token: "tok" };
const viewerLeaf = { rooms: [ROOM] };

afterEach(() => vi.restoreAllMocks());

describe("antenne controller", () => {
  it("arms the viewer once and joins receive-only", () => {
    const reg = fakeRegistry();
    const viewer = fakeViewer(reg);
    const createViewer = vi.fn(() => viewer);
    const ctl = createAntenneController({ createViewer });

    ctl.applyReservedLeaves({ viewer: viewerLeaf, slots: {} });

    expect(createViewer).toHaveBeenCalledWith({ rooms: [ROOM] });
    expect(viewer.join).toHaveBeenCalledTimes(1);
    // No publish surface exists on the viewer — receive-only by construction.
    expect((viewer as unknown as Record<string, unknown>).publish).toBeUndefined();
  });

  it("resolves a bound slot to its peer track and an unbound slot to null", () => {
    const reg = fakeRegistry();
    const cam = { id: "alice-cam" } as unknown as MediaStream;
    reg.set("alice", cam);
    const ctl = createAntenneController({ createViewer: () => fakeViewer(reg) });

    ctl.applyReservedLeaves({ viewer: viewerLeaf, slots: { "cam-1": "alice" } });

    expect(ctl.resolvePeerStream("cam-1")).toBe(cam);
    expect(ctl.resolvePeerStream("cam-2")).toBeNull();
  });

  it("buffers a pre-arm subscription and replays it once armed + on peer arrival", () => {
    const reg = fakeRegistry();
    const ctl = createAntenneController({ createViewer: () => fakeViewer(reg) });

    const seen: Array<MediaStream | null> = [];
    const unsub = ctl.subscribePeerStream("cam-1", (s) => seen.push(s));
    // Pre-arm : placeholder pushed immediately.
    expect(seen).toEqual([null]);

    ctl.applyReservedLeaves({ viewer: viewerLeaf, slots: { "cam-1": "alice" } });
    // Replayed onto the real registry → re-emits current value (still null).
    expect(seen[seen.length - 1]).toBeNull();

    const cam = { id: "alice-cam" } as unknown as MediaStream;
    reg.set("alice", cam);
    expect(seen[seen.length - 1]).toBe(cam);

    // Unsub reaches the real registry — no further pushes.
    unsub();
    reg.set("alice", { id: "other" } as unknown as MediaStream);
    expect(seen[seen.length - 1]).toBe(cam);
  });

  it("releases a slot that disappears from a newer snapshot", () => {
    const reg = fakeRegistry();
    const cam = { id: "alice-cam" } as unknown as MediaStream;
    reg.set("alice", cam);
    const ctl = createAntenneController({ createViewer: () => fakeViewer(reg) });

    ctl.applyReservedLeaves({ viewer: viewerLeaf, slots: { "cam-1": "alice" } });
    expect(ctl.resolvePeerStream("cam-1")).toBe(cam);

    ctl.applyReservedLeaves({ slots: {} });
    expect(ctl.resolvePeerStream("cam-1")).toBeNull();
  });

  it("re-keys a slot when reassigned to another peer", () => {
    const reg = fakeRegistry();
    const a = { id: "a" } as unknown as MediaStream;
    const b = { id: "b" } as unknown as MediaStream;
    reg.set("alice", a);
    reg.set("bob", b);
    const ctl = createAntenneController({ createViewer: () => fakeViewer(reg) });

    ctl.applyReservedLeaves({ viewer: viewerLeaf, slots: { "cam-1": "alice" } });
    expect(ctl.resolvePeerStream("cam-1")).toBe(a);

    ctl.applyReservedLeaves({ slots: { "cam-1": "bob" } });
    expect(ctl.resolvePeerStream("cam-1")).toBe(b);
  });

  it("reconciles the room set on a later emission instead of re-creating", () => {
    const reg = fakeRegistry();
    const viewer = fakeViewer(reg);
    const createViewer = vi.fn(() => viewer);
    const ctl = createAntenneController({ createViewer });

    ctl.applyReservedLeaves({ viewer: viewerLeaf, slots: {} });
    const ROOM2 = { signalingUrl: "wss://meet/ws", roomId: "r2", token: "tok2" };
    ctl.applyReservedLeaves({ viewer: { rooms: [ROOM2] }, slots: {} });

    expect(createViewer).toHaveBeenCalledTimes(1);
    expect(viewer.setRooms).toHaveBeenCalledWith([ROOM2]);
  });

  it("stays inert when slots arrive before any usable viewer creds", () => {
    const reg = fakeRegistry();
    const createViewer = vi.fn(() => fakeViewer(reg));
    const ctl = createAntenneController({ createViewer });

    ctl.applyReservedLeaves({ slots: { "cam-1": "alice" } });
    expect(createViewer).not.toHaveBeenCalled();
    expect(ctl.resolvePeerStream("cam-1")).toBeNull();
  });

  it("surfaces a join rejection through onJoinError without throwing", async () => {
    const reg = fakeRegistry();
    const viewer = fakeViewer(reg);
    viewer.join.mockRejectedValueOnce(new Error("handshake failed"));
    const onJoinError = vi.fn();
    const ctl = createAntenneController({ createViewer: () => viewer, onJoinError });

    expect(() => ctl.applyReservedLeaves({ viewer: viewerLeaf, slots: {} })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(onJoinError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("leaves the mesh on teardown", () => {
    const reg = fakeRegistry();
    const viewer = fakeViewer(reg);
    const ctl = createAntenneController({ createViewer: () => viewer });
    ctl.applyReservedLeaves({ viewer: viewerLeaf, slots: {} });

    ctl.leave();
    expect(viewer.leave).toHaveBeenCalledTimes(1);
  });
});
