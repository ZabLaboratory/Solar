import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publisherOfferViewerInjection,
} from "../../src/peer-viewer/injection";
import type { PeerViewerInjection } from "@lumencast/runtime";

class FakePeerConnection extends EventTarget {
  signalingState: RTCSignalingState = "stable";
  setLocalDescription = vi.fn(() => Promise.resolve());
}

class FakeWebSocket extends EventTarget {
  static sent: unknown[] = [];

  constructor(
    readonly url: string | URL,
    readonly protocols?: string | string[],
  ) {
    super();
  }

  send(data: unknown): void {
    FakeWebSocket.sent.push(data);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.sent = [];
});

describe("publisherOfferViewerInjection()", () => {
  it("scopes the receive-only policy to the injected dependencies", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const originalPolicy = (globalThis as Record<string, unknown>)
      .__PRISM_SOLAR_VIEWER_POLICY__;
    const injection = { rooms: [] } as unknown as PeerViewerInjection;
    const wrapped = publisherOfferViewerInjection(injection);
    const deps = (wrapped as PeerViewerInjection & {
      deps: {
        RTCPeerConnection: typeof RTCPeerConnection;
        WebSocket: typeof WebSocket;
      };
    }).deps;

    expect((globalThis as Record<string, unknown>).__PRISM_SOLAR_VIEWER_POLICY__).toBe(
      originalPolicy,
    );
    expect(globalThis.RTCPeerConnection).toBe(FakePeerConnection);

    const pc = new deps.RTCPeerConnection();
    const negotiation = vi.fn();
    pc.addEventListener("negotiationneeded", negotiation);
    pc.dispatchEvent(new Event("negotiationneeded"));
    expect(negotiation).not.toHaveBeenCalled();
    await expect(pc.setLocalDescription()).rejects.toMatchObject({
      name: "InvalidStateError",
    });

    const ws = new deps.WebSocket("wss://meet.example/ws");
    ws.send(
      JSON.stringify({
        type: "signal",
        to: "publisher",
        payload: { kind: "sdp", description: { type: "offer" } },
      }),
    );
    ws.send(
      JSON.stringify({
        type: "signal",
        to: "publisher",
        payload: { kind: "sdp", description: { type: "answer" } },
      }),
    );
    expect(FakeWebSocket.sent).toHaveLength(1);
    expect(JSON.parse(String(FakeWebSocket.sent[0]))).toMatchObject({
      type: "signal",
      payload: { kind: "sdp", description: { type: "answer" } },
    });
  });
});
