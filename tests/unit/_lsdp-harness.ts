// Shared in-process LSDP/1.1 harness for the ADR 007 §B parity tests.
//
// Solar's public surface is `mount()` only — `Tree` / `createStore` are
// runtime internals, not re-exported. So every parity acceptance drives
// the *same seam Solar ships* : mount() over @lumencast/runtime, fed by a
// fake LSDP/1.1 WebSocket + a fake content-addressed bundle fetch. The
// wire frames are encoded with the REAL @lumencast/protocol so the bytes
// the runtime decodes are faithful, not a Solar-local mock of a dead
// protocol.
//
// This mirrors the proven setup in render.test.tsx but is parameterised
// over the bundle + initial state so each acceptance can declare its own
// scene. Network-free and deterministic : no real WS, no real fetch, no
// real timers beyond the microtask/macrotask the runtime's lazy chunks
// need.

import { encodeFrame, snapshot } from "@lumencast/protocol";
import type { LeafValue } from "@lumencast/protocol";
import type { RenderBundle } from "@lumencast/runtime";

/** Minimal fake LSDP/1.1 WebSocket. The runtime's WsClient touches only
 *  this surface : (url, protocols) ctor, `protocol`, `readyState`, the
 *  OPEN/CLOSED constants, the four `on*` handlers, `send()`, `close()`.
 *  On `subscribe` it replies with a real encoded snapshot frame carrying
 *  the harness's initial state. */
export class FakeWebSocket {
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

  // Set by installHarness() so the instance can answer `subscribe`.
  static sceneId = "scene-parity";
  static sceneVersion = "sha256-parity-0001";
  static initialState: Record<string, LeafValue> = {};

  constructor(
    public url: string,
    _protocols?: string | string[],
  ) {
    FakeWebSocket.last = this;
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
        scene_id: FakeWebSocket.sceneId,
        scene_version: FakeWebSocket.sceneVersion,
        state: FakeWebSocket.initialState,
      });
      queueMicrotask(() => this.onmessage?.({ data: encodeFrame(snap) }));
    }
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = this.CLOSED;
    this.onclose?.({ code: 1000, reason: "client closing" });
  }
}

export interface HarnessConfig {
  bundle: RenderBundle;
  initialState?: Record<string, LeafValue>;
}

export interface InstalledHarness {
  /** Spy count of bundle fetches the runtime performed. */
  fetchMock: ReturnType<typeof makeFetchMock>;
  /** The bundle the fake server serves on the content-addressed fetch. */
  bundle: RenderBundle;
}

function makeFetchMock(bundle: RenderBundle) {
  // The runtime requests `${base}/lsdp/v1/scenes/{id}/bundle?v={hash}`.
  // We serve the bundle regardless of the exact path so the test is not
  // coupled to the runtime's internal path scheme.
  return async (): Promise<Response> =>
    new Response(JSON.stringify(bundle), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

/** Wire up the fake WS + fake fetch globals for one test. The caller is
 *  responsible for `vi.restoreAllMocks()` / resetting `FakeWebSocket.last`
 *  in afterEach. Returns the fetch spy so assertions can count calls. */
export function installHarness(
  vi: typeof import("vitest").vi,
  cfg: HarnessConfig,
): InstalledHarness {
  FakeWebSocket.sceneId = "scene-parity";
  FakeWebSocket.sceneVersion = cfg.bundle.scene_version;
  FakeWebSocket.initialState = cfg.initialState ?? {};

  const fetchMock = vi.fn(makeFetchMock(cfg.bundle));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

  return { fetchMock, bundle: cfg.bundle };
}

/** Locate the rendered Frame primitive's div. The runtime wraps the
 *  scene in a mode container that is ALSO `position: absolute`, so the
 *  Frame is disambiguated by its `will-change: transform, opacity` —
 *  emitted only by the Frame primitive (see frame.js). Returns null until
 *  the Frame has rendered. */
export function findFrame(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>(
    "div[style*='will-change: transform']",
  );
}

/** Poll a predicate until true or timeout. happy-dom + React + the
 *  runtime's lazy mode chunks resolve over several micro/macrotasks. */
export async function waitFor(
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
