// Proving test for the ADR 007 sub-chantier B swap : Solar's mount() is
// now a thin adapter over @lumencast/runtime. This test mounts Solar end
// to end against a fake LSDP/1.1 transport (fake WebSocket) + a fake
// bundle fetch, and asserts the Lumencast runtime fetches the
// content-addressed RenderBundle, applies the snapshot state, and renders
// the bound text into the mount target.
//
// It exercises the real seam Solar adds (orionUrl → serverUrl mapping,
// delegation to the runtime, lifecycle) without re-testing the runtime's
// internals (those are covered by @lumencast/runtime's own suite). The
// frame encoding uses the real @lumencast/protocol so the wire is
// faithful, not a Solar-local mock of a dead protocol.

import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFrame, snapshot } from "@lumencast/protocol";
import type { RenderBundle } from "@lumencast/runtime";
import { mount } from "../../src/mount";
import type { SolarStatus } from "../../src/types";

const SCENE_ID = "scene-proof";
const SCENE_VERSION = "sha256-proof-0001";

const BUNDLE: RenderBundle = {
  scene_version: SCENE_VERSION,
  root: {
    kind: "stack",
    children: [
      {
        kind: "text",
        id: "headline",
        // The runtime resolves `value` from the bound state path and
        // renders it as the span's text content.
        bindings: { value: "headline.text" },
      },
    ],
  },
};

const INITIAL_STATE = {
  "headline.text": "ON AIR",
};

// --- fake LSDP/1.1 WebSocket -------------------------------------------
//
// Minimal surface the runtime's WsClient touches : constructor with
// (url, protocols), `protocol`, `readyState`, OPEN/CLOSED constants,
// onopen/onmessage/onclose/onerror, send(), close(). On `subscribe` it
// replies with a real encoded snapshot frame.

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  protocol = "lsdp.v1.1"; // server negotiates 1.1
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(
    public url: string,
    _protocols?: string | string[],
  ) {
    FakeWebSocket.last = this;
    // Open on the next microtask so the runtime can attach handlers.
    queueMicrotask(() => {
      this.readyState = this.OPEN;
      this.onopen?.();
    });
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as { type?: string };
    if (frame.type === "subscribe") {
      const snap = snapshot({
        seq: 1,
        scene_id: SCENE_ID,
        scene_version: SCENE_VERSION,
        state: INITIAL_STATE,
      });
      queueMicrotask(() => this.onmessage?.({ data: encodeFrame(snap) }));
    }
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = this.CLOSED;
    this.onclose?.({ code: 1000, reason: "client closing" });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  FakeWebSocket.last = null;
});

describe("Solar mount() over @lumencast/runtime", () => {
  it("fetches the bundle, applies the snapshot, and renders bound text", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    // Fake the content-addressed bundle fetch. The runtime requests
    // `${base}/lsdp/v1/scenes/{id}/bundle?v={hash}` — we serve the bundle
    // regardless of the exact path so the test isn't coupled to the
    // runtime's internal path scheme.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(BUNDLE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const statuses: SolarStatus[] = [];
    const handle = mount({
      target,
      orionUrl: "wss://gate.example/orion/api/v1/show/stream",
      token: "operator-token",
      mode: "broadcast",
      onStatus: (s) => statuses.push(s),
    });

    // Wait for : WS open → subscribe → snapshot → bundle fetch → React
    // lazy mode chunk → render. Poll the DOM rather than guessing a fixed
    // delay.
    await waitFor(() => target.textContent?.includes("ON AIR") === true);

    expect(target.textContent).toContain("ON AIR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The runtime surfaced the live status through Solar's onStatus.
    expect(statuses).toContain("live");

    handle.disconnect();
    target.remove();
  });

  it("maps orionUrl onto the runtime serverUrl (WS opened against it)", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(BUNDLE), { status: 200 })),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const orionUrl = "wss://gate.example/orion/api/v1/show/stream";
    const handle = mount({
      target,
      orionUrl,
      token: "t",
      mode: "broadcast",
    });

    await waitFor(() => FakeWebSocket.last !== null);
    expect(FakeWebSocket.last?.url).toBe(orionUrl);

    handle.disconnect();
    target.remove();
  });
});

// Poll a predicate until true or timeout. happy-dom + React + the
// runtime's lazy chunks resolve over several microtasks/macrotasks.
async function waitFor(
  predicate: () => boolean,
  { timeout = 2000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeout) {
      throw new Error("waitFor: predicate not satisfied within timeout");
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
