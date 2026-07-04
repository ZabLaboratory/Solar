// End-to-end proof that `?atlas=` reaches the REAL mount point and the runtime
// (@lumencast/runtime ≥ 0.12.3) actually applies `buildAtlasRoot` to the loaded
// bundle (ADR 013 Prism §3.1, issue #41). No mock of the runtime here — this
// drives Solar's production `mount()` with a fake WS + fake fetch (same seam as
// bundle-fetch-auth.test), delivers a snapshot that triggers the bundle fetch,
// and asserts the PAINTED DOM reflects the z-band split when `?atlas=` is on and
// stays verbatim when it is off. This is the "real mount() exercised with
// ?atlas=" test Vigil required on the aborted #40.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFrame, snapshot } from "@lumencast/protocol";
import type { RenderNode } from "@lumencast/runtime";
import { mount } from "../../src/mount";
import { atlasMountOptions } from "../../src/internal/atlas-mount";

const ORION_URL = "wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp";
const SCENE_ID = "scene-atlas";
const SCENE_VERSION = "sha256:atlas-e2e";

// A composed scene with ONE native-capture separator → 2 z-bands, matching
// `?atlas=below,above`. The runtime fetches this as the render bundle; with the
// atlas transform wired it must be split into stacked band frames.
const SCENE_ROOT: RenderNode = {
  kind: "stack",
  children: [
    { kind: "frame", id: "below-box", props: { width: 400, height: 200 } },
    { kind: "x-zab.capture", id: "cam", props: { width: 1920, height: 1080 } },
    { kind: "frame", id: "above-box", props: { width: 300, height: 150 } },
  ],
};

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

describe("mount() applies the atlas transform end-to-end", () => {
  let originalWS: typeof globalThis.WebSocket;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    originalWS = globalThis.WebSocket;
    originalFetch = globalThis.fetch;
    // @ts-expect-error — install the fake WS the runtime picks up.
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ scene_version: SCENE_VERSION, root: SCENE_ROOT }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWS;
    globalThis.fetch = originalFetch;
  });

  async function driveMount(search: string): Promise<HTMLElement> {
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount({
      target,
      orionUrl: ORION_URL,
      token: "fake",
      mode: "broadcast",
      ...atlasMountOptions(search),
    });
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]!.pushSnapshot();
    // Bundle fetch + render are async — wait for the tree to paint.
    await vi.waitFor(() =>
      expect(target.querySelectorAll("div").length).toBeGreaterThan(0),
    );
    return target;
  }

  it("splits the scene into stacked z-bands when ?atlas= is set", async () => {
    const target = await driveMount("?atlas=below,above");
    await vi.waitFor(() => {
      const divs = Array.from(target.querySelectorAll<HTMLElement>("div"));
      // The atlas stage is the full 2×1080 height, with two 1080 band slices —
      // proof the runtime ran buildAtlasRoot on the fetched bundle.
      expect(divs.some((d) => d.style.height === "2160px")).toBe(true);
      expect(divs.filter((d) => d.style.height === "1080px").length).toBe(2);
    });
  });

  it("renders the fetched bundle verbatim when ?atlas= is absent (non-regression)", async () => {
    const target = await driveMount("?mode=broadcast");
    // Give any transform a chance to (wrongly) run before asserting absence.
    await Promise.resolve();
    const divs = Array.from(target.querySelectorAll<HTMLElement>("div"));
    // No 1920×2160 atlas stage — the scene is painted verbatim, NOT stacked
    // into z-bands (the discriminator: only the atlas transform emits a
    // 2×1080 stage; the raw scene has no node that tall).
    expect(divs.some((d) => d.style.height === "2160px")).toBe(false);
    // The authored scenic boxes still paint.
    expect(divs.some((d) => d.style.width === "400px")).toBe(true);
    expect(divs.some((d) => d.style.width === "300px")).toBe(true);
  });
});
