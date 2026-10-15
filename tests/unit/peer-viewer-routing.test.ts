import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  createPeerViewerFromInjection,
  PeerStreamListener,
  PeerStreamRegistry,
} from "@lumencast/runtime";
import { createPeerSources } from "../../src/sources/peers";
import { ZAB_PEER_VIEWER_CHANNEL_GLOBAL } from "../../src/peer-viewer/injection";

class FakePeerViewerChannel extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static readonly instances: FakePeerViewerChannel[] = [];

  readyState = FakePeerViewerChannel.OPEN;
  failSend = false;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    super();
    FakePeerViewerChannel.instances.push(this);
  }

  send(value: string): void {
    if (this.failSend) throw new Error("channel unavailable");
    this.sent.push(value);
  }

  close(): void {
    this.readyState = FakePeerViewerChannel.CLOSED;
  }

  receive(frame: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(frame) }),
    );
  }
}

function fakePeerRegistry(): PeerStreamRegistry & {
  push: (peerLabel: string, stream: MediaStream | null) => void;
} {
  const streams = new Map<string, MediaStream>();
  const listeners = new Map<string, Set<PeerStreamListener>>();
  const rosterListeners = new Set<() => void>();
  const push = (peerLabel: string, stream: MediaStream | null): void => {
    const wasPresent = streams.has(peerLabel);
    if (stream === null) streams.delete(peerLabel);
    else streams.set(peerLabel, stream);
    for (const listener of listeners.get(peerLabel) ?? []) listener(stream);
    if ((stream !== null && !wasPresent) || (stream === null && wasPresent)) {
      for (const listener of [...rosterListeners]) listener();
    }
  };
  return {
    resolve: (peerLabel) => streams.get(peerLabel) ?? null,
    orderedLabels: () => [...streams.keys()],
    subscribe: (peerLabel, listener) => {
      let set = listeners.get(peerLabel);
      if (set === undefined) {
        set = new Set();
        listeners.set(peerLabel, set);
      }
      set.add(listener);
      listener(streams.get(peerLabel) ?? null);
      return () => set?.delete(listener);
    },
    subscribeRoster: (listener) => {
      rosterListeners.add(listener);
      return () => rosterListeners.delete(listener);
    },
    set: (peerLabel, stream) => push(peerLabel, stream),
    remove: (peerLabel) => push(peerLabel, null),
    clear: () => streams.clear(),
    push,
  };
}

const streamFor = (id: string): MediaStream =>
  ({ id }) as unknown as MediaStream;

const currentSource: { value: ReturnType<typeof createPeerSources> | null } = {
  value: null,
};

describe("Prism local peer-viewer routing readback", () => {
  afterEach(() => {
    currentSource.value?.dispose();
    currentSource.value = null;
    FakePeerViewerChannel.instances.length = 0;
    delete (globalThis as Record<string, unknown>)[
      ZAB_PEER_VIEWER_CHANNEL_GLOBAL
    ];
    vi.unstubAllGlobals();
  });

  function mount() {
    vi.stubGlobal("WebSocket", FakePeerViewerChannel);
    (globalThis as Record<string, unknown>)[ZAB_PEER_VIEWER_CHANNEL_GLOBAL] = {
      url: "ws://127.0.0.1:43123/preview/peer-viewer?token=channel-secret&consumer=program",
    };

    const registry = fakePeerRegistry();
    const viewer = {
      join: vi.fn(async () => undefined),
      leave: vi.fn(),
      resolvePeerStream: registry.resolve,
      subscribePeerStream: registry.subscribe,
      registry,
      setRooms: vi.fn(async () => undefined),
    };
    const createViewer = vi.fn(
      () => viewer,
    ) as unknown as typeof createPeerViewerFromInjection;
    currentSource.value = createPeerSources(
      {
        nativeLSDP: { url: "http://127.0.0.1:8081", resource: "test" },
      },
      createViewer,
    );
    const socket = FakePeerViewerChannel.instances.at(-1);
    if (socket === undefined)
      throw new Error("peer-viewer channel was not opened");
    return { registry, socket, viewer };
  }

  it("reports effective labels and availability, refreshes on roster changes, and excludes credentials", async () => {
    const { registry, socket } = mount();
    registry.push("alice", streamFor("alice-cam"));
    registry.push("bob", streamFor("bob-cam"));

    socket.receive({
      type: "peer_viewer",
      state: {
        rooms: [
          {
            signalingUrl: "wss://meet.invalid/secret-path",
            roomId: "room-secret",
            token: "room-token-secret",
          },
        ],
        slots: { "@0": "alice" },
        slotRefs: ["@0", "@1"],
        routingRevision: 41,
      },
    });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: "peer_viewer_routing",
      revision: 41,
      slots: {
        "@0": { peerLabel: "alice", available: true },
        "@1": { peerLabel: "bob", available: true },
      },
    });
    expect(socket.sent[0]).not.toContain("room-secret");
    expect(socket.sent[0]).not.toContain("room-token-secret");
    expect(socket.sent[0]).not.toContain("secret-path");

    registry.remove("alice");
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      type: "peer_viewer_routing",
      revision: 41,
      slots: {
        "@0": { peerLabel: "alice", available: false },
        "@1": { peerLabel: null, available: false },
      },
    });
  });

  it("keeps explicit releases empty and does not let readback send failures affect routing", async () => {
    const { registry, socket } = mount();
    registry.push("alice", streamFor("alice-cam"));
    socket.receive({
      type: "peer_viewer",
      state: {
        rooms: [],
        slots: { "@0": "alice" },
        slotRefs: ["@0"],
        routingRevision: 5,
      },
    });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));

    socket.receive({
      type: "peer_viewer",
      state: {
        rooms: [],
        slots: {},
        slotRefs: ["@0"],
        routingRevision: 6,
      },
    });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      type: "peer_viewer_routing",
      revision: 6,
      slots: { "@0": { peerLabel: null, available: false } },
    });

    socket.failSend = true;
    expect(() => registry.remove("alice")).not.toThrow();
  });

  it("keeps older Prism snapshots working without emitting readback", async () => {
    const { socket, viewer } = mount();
    socket.receive({
      type: "peer_viewer",
      state: {
        rooms: [],
        slots: { "cam-main": "alice" },
      },
    });

    await vi.waitFor(() => expect(viewer.setRooms).toHaveBeenCalledOnce());
    expect(socket.sent).toEqual([]);
    expect(currentSource.value?.resolvePeerStream("cam-main")).toBeNull();
  });

  it("skips oversized snapshots instead of sending a partial route", async () => {
    const { socket, viewer } = mount();
    const slotRefs = Array.from({ length: 80 }, (_, index) => `slot-${index}`);
    const slots = Object.fromEntries(
      slotRefs.map((slotRef) => [slotRef, "p".repeat(256)]),
    );
    socket.receive({
      type: "peer_viewer",
      state: { rooms: [], slots, slotRefs, routingRevision: 9 },
    });

    await vi.waitFor(() => expect(viewer.setRooms).toHaveBeenCalledOnce());
    expect(socket.sent).toEqual([]);
  });
});
