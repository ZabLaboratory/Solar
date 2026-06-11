// Empirical proof for the live-finale black-screen bug (BUNDLE_FETCH_FAILED:
// 401). This drives Solar's REAL mount() with the Pulsar browser-source URL
// shape — the show-token embedded in `orionUrl`'s `?token=` — and asserts the
// render-bundle GET goes out with `Authorization: Bearer <show-token>`.
//
// Before the fix the host entry read a (non-existent) top-level `?token=`, so
// mount({ token: "" }) → resolveCurrentToken() empty → no Authorization header
// → Orion 401. This test fails on the old path and passes on the new one. It
// exercises the full production seam (resolveShowToken → mount → runtime
// WsClient.resolveCurrentToken → bundle fetcher), not just "it compiles".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFrame, snapshot } from "@lumencast/protocol";
import { mount } from "../../src/mount";
import { resolveShowToken } from "../../src/internal/resolve-show-token";

const SHOW_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzaG93In0.sig-_123";
const ORION_URL = `wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp?token=${SHOW_TOKEN}`;
const SCENE_ID = "scene-finale";
const SCENE_VERSION = "sha256:abc123";

// A minimal fake WebSocket that immediately "opens" with the 1.1 subprotocol
// negotiated, so the runtime sends `subscribe`; the test then pushes a
// snapshot frame, which triggers the bundle fetch under test.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 1;
  protocol = "lsdp.v1.1";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  sent: string[] = [];

  constructor(
    public url: string,
    public protocols?: string[],
  ) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
  pushSnapshot(): void {
    this.onmessage?.({
      data: encodeFrame(
        snapshot({
          seq: 1,
          scene_id: SCENE_ID,
          scene_version: SCENE_VERSION,
          state: {},
        }),
      ),
    });
  }
}

describe("render-bundle fetch carries Authorization from the show-token", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalWS: typeof globalThis.WebSocket;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWS = globalThis.WebSocket;
    originalFetch = globalThis.fetch;
    // @ts-expect-error — install the fake WS for the runtime to pick up.
    globalThis.WebSocket = FakeWebSocket;

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        scene_version: SCENE_VERSION,
        root: { kind: "stack" },
      }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWS;
    globalThis.fetch = originalFetch;
  });

  it("attaches `Authorization: Bearer <show-token>` to the bundle GET", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    // This is exactly what the host entry does: pull the token out of the
    // packed orionUrl, then mount with it.
    const token = resolveShowToken(ORION_URL, null);
    expect(token).toBe(SHOW_TOKEN); // guards the extraction half of the fix

    mount({ target, orionUrl: ORION_URL, token, mode: "broadcast" });

    // Let the WS "open" + subscribe, then deliver the snapshot that drives
    // the bundle fetch.
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]!.pushSnapshot();

    // The fetcher resolves the token (async) then fetches — flush microtasks.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0]!;
    // Right artefact: gateway-prefixed render-bundle with the content hash.
    expect(String(url)).toContain(
      "/orion/api/v1/scenes/scene-finale/render-bundle",
    );
    // The load-bearing assertion: the header is present and carries the token.
    expect(init).toBeDefined();
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SHOW_TOKEN}`);
  });

  it("sends NO Authorization header when the orionUrl carries no token (regression guard for the old empty-token path)", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const noTokenUrl =
      "wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp";
    const token = resolveShowToken(noTokenUrl, null);
    expect(token).toBe("");

    mount({ target, orionUrl: noTokenUrl, token, mode: "broadcast" });

    await Promise.resolve();
    FakeWebSocket.instances[0]!.pushSnapshot();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0]!;
    // No token → header-less fetch (runtime v0.5.0 behaviour) — proves the
    // header is driven by the token, i.e. the token IS what was missing.
    expect(init).toBeUndefined();
  });
});
