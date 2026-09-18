import { describe, expect, it } from "vitest";
// Import the patched concrete module rather than Vite's dependency-optimizer
// cache so this regression test validates the postinstall result itself.
import { MeetViewer } from "../../node_modules/@lumencast/runtime/dist/webrtc/meet-viewer.js";
import { createPeerViewer } from "../../node_modules/@lumencast/runtime/dist/webrtc/index.js";

class FakeMediaStream {
  private readonly tracks: unknown[] = [];
  getTracks(): unknown[] {
    return this.tracks;
  }
  addTrack(track: unknown): void {
    this.tracks.push(track);
  }
  removeTrack(track: unknown): void {
    const index = this.tracks.indexOf(track);
    if (index >= 0) this.tracks.splice(index, 1);
  }
}

class FakePeerConnection {
  signalingState = "stable";
  connectionState = "new";
  remoteDescription: unknown = null;
  localDescription: unknown = null;
  rollbackCount = 0;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  addTransceiver(): { setCodecPreferences(): void } {
    return { setCodecPreferences() {} };
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async setRemoteDescription(description: unknown): Promise<void> {
    this.remoteDescription = description;
  }
  async createOffer(): Promise<{ type: "offer"; sdp: string }> {
    return { type: "offer", sdp: "v=0" };
  }
  async setLocalDescription(
    description?: { type: "offer" | "rollback"; sdp?: string },
  ): Promise<void> {
    if (description?.type === "rollback") {
      this.rollbackCount += 1;
      this.signalingState = "stable";
      this.localDescription = null;
      return;
    }
    const localDescription = description ?? { type: "offer" as const, sdp: "v=0" };
    this.localDescription = localDescription;
    if (localDescription.type === "offer") this.signalingState = "have-local-offer";
  }
  async addIceCandidate(): Promise<void> {}
  close(): void {}
  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("MeetViewer early-signal identity reconciliation", () => {
  it("drops orphan ICE instead of creating a connection without an offer", async () => {
    const pcs: FakePeerConnection[] = [];
    const viewer = new MeetViewer({
      signalingUrl: "wss://meet.example/ws",
      roomId: "room",
      token: "token",
      name: "solar-viewer",
      deps: {
        WebSocket: class {} as never,
        RTCPeerConnection: class {
          constructor() {
            const pc = new FakePeerConnection();
            pcs.push(pc);
            return pc;
          }
        } as never,
        MediaStream: FakeMediaStream as never,
      },
    });
    const receive = (viewer as unknown as { onMessage(raw: string): Promise<void> })
      .onMessage.bind(viewer);

    await receive(
      JSON.stringify({
        type: "peer-joined",
        peer: { id: "publisher-1", name: "invite-2", role: "publisher" },
      }),
    );
    pcs[0]!.connectionState = "failed";
    pcs[0]!.emit("connectionstatechange", {});
    await receive(
      JSON.stringify({
        type: "signal",
        from: "publisher-1",
        payload: {
          kind: "ice",
          candidate: {
            candidate: "candidate:late",
            sdpMid: "0",
            sdpMLineIndex: 0,
          },
        },
      }),
    );

    // The retry is delayed and is the only path allowed to create the next
    // generation. A trickled ICE packet must not create a zombie PC early.
    expect(pcs).toHaveLength(1);
  });

  it("redials a failed publisher leg from the retained room roster", async () => {
    const pcs: FakePeerConnection[] = [];
    const viewer = new MeetViewer({
      signalingUrl: "wss://meet.example/ws",
      roomId: "room",
      token: "token",
      name: "solar-viewer",
      deps: {
        WebSocket: class {} as never,
        RTCPeerConnection: class {
          constructor() {
            const pc = new FakePeerConnection();
            pcs.push(pc);
            return pc;
          }
        } as never,
        MediaStream: FakeMediaStream as never,
      },
    });
    const receive = (viewer as unknown as { onMessage(raw: string): Promise<void> })
      .onMessage.bind(viewer);
    await receive(
      JSON.stringify({
        type: "peer-joined",
        peer: { id: "publisher-2", name: "invite-2", role: "publisher" },
      }),
    );

    pcs[0]!.connectionState = "failed";
    pcs[0]!.emit("connectionstatechange", {});
    await new Promise((resolve) => setTimeout(resolve, 275));

    expect(pcs).toHaveLength(2);
    expect(pcs[1]!.localDescription).toEqual({ type: "offer", sdp: "v=0" });
  });

  it("rolls back a retry offer when the publisher wins the glare", async () => {
    const pcs: FakePeerConnection[] = [];
    const viewer = new MeetViewer({
      signalingUrl: "wss://meet.example/ws",
      roomId: "room",
      token: "token",
      name: "solar-viewer",
      deps: {
        WebSocket: class {} as never,
        RTCPeerConnection: class {
          constructor() {
            const pc = new FakePeerConnection();
            pcs.push(pc);
            return pc;
          }
        } as never,
        MediaStream: FakeMediaStream as never,
      },
    });
    const receive = (viewer as unknown as { onMessage(raw: string): Promise<void> })
      .onMessage.bind(viewer);
    await receive(
      JSON.stringify({
        type: "peer-joined",
        peer: { id: "publisher-glare", name: "invite-2", role: "publisher" },
      }),
    );

    pcs[0]!.connectionState = "failed";
    pcs[0]!.emit("connectionstatechange", {});
    await new Promise((resolve) => setTimeout(resolve, 275));
    expect(pcs[1]!.localDescription).toEqual({ type: "offer", sdp: "v=0" });

    await receive(
      JSON.stringify({
        type: "signal",
        from: "publisher-glare",
        payload: {
          kind: "sdp",
          description: { type: "offer", sdp: "publisher-fresh-offer" },
        },
      }),
    );

    expect(pcs[1]!.rollbackCount).toBe(1);
    expect(pcs[1]!.remoteDescription).toEqual({
      type: "offer",
      sdp: "publisher-fresh-offer",
    });
  });

  it("replaces a terminal receiver before accepting a fresh publisher offer", async () => {
    const pcs: FakePeerConnection[] = [];
    const viewer = new MeetViewer({
      signalingUrl: "wss://meet.example/ws",
      roomId: "room",
      token: "token",
      name: "solar-viewer",
      deps: {
        WebSocket: class {} as never,
        RTCPeerConnection: class {
          constructor() {
            const pc = new FakePeerConnection();
            pcs.push(pc);
            return pc;
          }
        } as never,
        MediaStream: FakeMediaStream as never,
      },
    });
    const receive = (viewer as unknown as { onMessage(raw: string): Promise<void> })
      .onMessage.bind(viewer);

    await receive(
      JSON.stringify({
        type: "peer-joined",
        peer: { id: "publisher-fresh", name: "invite-2", role: "publisher" },
      }),
    );
    pcs[0]!.connectionState = "failed";
    await receive(
      JSON.stringify({
        type: "signal",
        from: "publisher-fresh",
        payload: {
          kind: "sdp",
          description: { type: "offer", sdp: "fresh-offer" },
        },
      }),
    );

    expect(pcs).toHaveLength(2);
    expect(pcs[1]!.remoteDescription).toEqual({ type: "offer", sdp: "fresh-offer" });
  });

  it("publishes a track under the authoritative peer name", async () => {
    const pcs: FakePeerConnection[] = [];
    const viewer = new MeetViewer({
      signalingUrl: "wss://meet.example/ws",
      roomId: "room",
      token: "token",
      name: "solar-viewer",
      deps: {
        WebSocket: class {} as never,
        RTCPeerConnection: class {
          constructor() {
            const pc = new FakePeerConnection();
            pcs.push(pc);
            return pc;
          }
        } as never,
        MediaStream: FakeMediaStream as never,
      },
    });
    const remoteTracks: { peerName: string }[] = [];
    const peerLeaves: { peerName: string }[] = [];
    viewer.on("remote-track", (event) => remoteTracks.push(event));
    viewer.on("peer-left", (event) => peerLeaves.push(event));

    const receive = (viewer as unknown as { onMessage(raw: string): Promise<void> })
      .onMessage.bind(viewer);
    await receive(
      JSON.stringify({
        type: "signal",
        from: "12345678-abcd-efgh",
        payload: { kind: "sdp", description: { type: "answer", sdp: "v=0" } },
      }),
    );
    await receive(
      JSON.stringify({
        type: "peer-joined",
        peer: { id: "12345678-abcd-efgh", name: "invite-1", role: "publisher" },
      }),
    );

    const track = { addEventListener() {} };
    pcs[0]?.emit("track", { track });

    expect(remoteTracks).toHaveLength(1);
    expect(remoteTracks[0]?.peerName).toBe("invite-1");

    // A failed peer connection is removed from the live remote map. Late
    // signaling must recreate it from the retained authoritative roster, not
    // fall back to the opaque UUID again.
    pcs[0]!.connectionState = "failed";
    pcs[0]!.emit("connectionstatechange", {});
    await receive(
      JSON.stringify({
        type: "signal",
        from: "12345678-abcd-efgh",
        payload: { kind: "sdp", description: { type: "answer", sdp: "v=0" } },
      }),
    );
    pcs[1]?.emit("track", { track: { addEventListener() {} } });

    expect(remoteTracks.at(-1)?.peerName).toBe("invite-1");

    // A connected receiver is an authoritative recovery point for the same
    // aggregate MediaStream. Republish it so a raced/cleared registry can
    // resolve the authored slot without opening another peer connection.
    const beforeConnected = remoteTracks.length;
    pcs[1]!.connectionState = "connected";
    pcs[1]!.emit("connectionstatechange", {});
    expect(remoteTracks).toHaveLength(beforeConnected + 1);
    expect(remoteTracks.at(-1)?.peerName).toBe("invite-1");

    // Chromium may deliver another terminal event from the superseded PC
    // after the retry is already live. That stale generation must not evict
    // the replacement stream from the registry.
    expect(peerLeaves).toHaveLength(1);
    pcs[0]!.emit("connectionstatechange", {});
    expect(peerLeaves).toHaveLength(1);
  });

  it("keeps the replacement stream when an older same-label peer leaves late", () => {
    const peerViewer = createPeerViewer({
      signalingUrl: "wss://meet.example/ws",
      roomId: "room",
      token: "token",
      name: "solar-viewer",
      deps: {
        WebSocket: class {} as never,
        RTCPeerConnection: FakePeerConnection as never,
        MediaStream: FakeMediaStream as never,
      },
    });
    const emit = (
      peerViewer.viewer as unknown as {
        emit(type: string, event: unknown): void;
      }
    ).emit.bind(peerViewer.viewer);
    const oldStream = new FakeMediaStream() as unknown as MediaStream;
    const replacementStream = new FakeMediaStream() as unknown as MediaStream;

    emit("remote-track", {
      peerId: "old-peer",
      peerName: "invite-1",
      stream: oldStream,
    });
    emit("remote-track", {
      peerId: "replacement-peer",
      peerName: "invite-1",
      stream: replacementStream,
    });
    expect(peerViewer.resolvePeerStream("invite-1")).toBe(replacementStream);

    emit("peer-left", {
      peerId: "old-peer",
      peerName: "invite-1",
    });
    expect(peerViewer.resolvePeerStream("invite-1")).toBe(replacementStream);

    emit("peer-left", {
      peerId: "replacement-peer",
      peerName: "invite-1",
    });
    expect(peerViewer.resolvePeerStream("invite-1")).toBeNull();
  });

  it("keeps a connected aggregate when a stale signaling leave arrives", async () => {
    const viewer = new MeetViewer({
      signalingUrl: "wss://meet.example/ws",
      roomId: "room",
      token: "token",
      name: "solar-viewer",
      deps: {
        WebSocket: class {} as never,
        RTCPeerConnection: class {
          constructor() {
            const pc = new FakePeerConnection();
            pcs.push(pc);
            return pc;
          }
        } as never,
        MediaStream: FakeMediaStream as never,
      },
    });
    const pcs: FakePeerConnection[] = [];
    const peerLeaves: string[] = [];
    viewer.on("peer-left", (event) => peerLeaves.push(event.peerName));
    const receive = (viewer as unknown as { onMessage(raw: string): Promise<void> })
      .onMessage.bind(viewer);

    await receive(
      JSON.stringify({
        type: "peer-joined",
        peer: { id: "connected-peer", name: "invite-3", role: "publisher" },
      }),
    );
    pcs[0]!.connectionState = "connected";
    const track = { addEventListener() {} };
    pcs[0]!.emit("track", { track });

    await receive(JSON.stringify({ type: "peer-left", peerId: "connected-peer" }));
    expect(peerLeaves).toEqual([]);

    pcs[0]!.connectionState = "closed";
    pcs[0]!.emit("connectionstatechange", {});
    expect(peerLeaves).toEqual(["invite-3"]);
  });
});
