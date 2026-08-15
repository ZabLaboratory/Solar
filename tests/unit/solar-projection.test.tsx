import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decodeClientFrame,
  decodeServerFrame,
  delta,
  encodeFrame,
  snapshot,
  type Cause,
  type ClientFrame,
  type LeafValue,
} from "@lumencast/protocol";
import { hashInlineBundle } from "@lumencast/protocol/conformance";
import type { RenderBundle } from "@lumencast/runtime";
import { mount } from "../../src/mount";
import type { SolarError, SolarStatus } from "../../src/types";

interface SnapshotFixture {
  v: 1;
  type: "snapshot";
  seq: number;
  scene_id: string;
  scene_version: string;
  state: Record<string, LeafValue>;
}

interface ProjectionDeltaFixture {
  v: 1;
  type: "delta";
  seq: number;
  patches: Array<{ path: string; value: LeafValue }>;
  cause: Cause;
  schema_version: string;
  scene_digest: string;
  runtime_instance_id: string;
  target: "preview" | "program";
  render_revision: string;
  correlation_id: string;
}

function readFixture<T>(name: string): T {
  const path = resolve(
    process.cwd(),
    "tests",
    "fixtures",
    "orion-blue-solar-projection-v1",
    `${name}.json`,
  );
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const BUNDLE = readFixture<RenderBundle>("bundle");
const SNAPSHOT_FIXTURE = readFixture<SnapshotFixture>("snapshot");
const DELTA_FIXTURE = readFixture<ProjectionDeltaFixture>("delta");
const SESSION_ID = "preview-session-48";

function validSnapshotFrame(): ReturnType<typeof snapshot> {
  return snapshot({
    seq: SNAPSHOT_FIXTURE.seq,
    scene_id: SNAPSHOT_FIXTURE.scene_id,
    scene_version: SNAPSHOT_FIXTURE.scene_version,
    state: { ...SNAPSHOT_FIXTURE.state },
  });
}

function validDeltaFrame(): ReturnType<typeof delta> {
  return delta({
    seq: DELTA_FIXTURE.seq,
    patches: DELTA_FIXTURE.patches.map(({ path, value }) => ({ path, value })),
    cause: DELTA_FIXTURE.cause,
  });
}

/**
 * Build a valid LSDP/1.1 delta with the real codec, then add the producer's
 * logical projection metadata as unknown JSON fields. Solar must consume the
 * existing `patches` envelope and ignore those additive fields.
 */
function projectionDeltaWire(): string {
  const wire = JSON.parse(encodeFrame(validDeltaFrame())) as Record<string, unknown>;
  Object.assign(wire, {
    schema_version: DELTA_FIXTURE.schema_version,
    scene_digest: DELTA_FIXTURE.scene_digest,
    runtime_instance_id: DELTA_FIXTURE.runtime_instance_id,
    target: DELTA_FIXTURE.target,
    render_revision: DELTA_FIXTURE.render_revision,
    correlation_id: DELTA_FIXTURE.correlation_id,
  });
  return JSON.stringify(wire);
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | null = null;
  static lastSubscribe: Extract<ClientFrame, { type: "subscribe" }> | null = null;

  readonly CONNECTING = FakeWebSocket.CONNECTING;
  readonly OPEN = FakeWebSocket.OPEN;
  readonly CLOSING = FakeWebSocket.CLOSING;
  readonly CLOSED = FakeWebSocket.CLOSED;

  readyState = FakeWebSocket.CONNECTING;
  protocol = "lsdp.v1.1";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(
    public readonly url: string,
    public readonly protocols?: string | string[],
  ) {
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = this.OPEN;
      this.onopen?.();
    });
  }

  send(raw: string): void {
    const frame = decodeClientFrame(raw);
    if (frame?.type !== "subscribe") return;

    FakeWebSocket.lastSubscribe = frame;
    queueMicrotask(() => {
      this.onmessage?.({ data: encodeFrame(validSnapshotFrame()) });
    });
  }

  push(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = this.CLOSED;
    this.onclose?.({ code: 1000, reason: "client closing" });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeWebSocket.last = null;
  FakeWebSocket.lastSubscribe = null;
  document.body.replaceChildren();
});

describe("Solar preview consumes Orion's additive projection over LSDP/1.1", () => {
  it("loads the content-addressed snapshot and applies the versioned delta", async () => {
    expect(BUNDLE.scene_version).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await hashInlineBundle(BUNDLE)).toBe(BUNDLE.scene_version);
    expect(SNAPSHOT_FIXTURE.scene_version).toBe(BUNDLE.scene_version);

    const target = document.createElement("div");
    document.body.appendChild(target);
    const statuses: SolarStatus[] = [];
    const errors: SolarError[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(BUNDLE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    let handle: ReturnType<typeof mount> | undefined;
    try {
      handle = mount({
        target,
        orionUrl: "wss://gate.example/orion/api/v1/show/stream.lsdp",
        token: "preview-token",
        mode: "test",
        scene: SNAPSHOT_FIXTURE.scene_id,
        testSession: SESSION_ID,
        onStatus: (status) => statuses.push(status),
        onError: (error) => errors.push(error),
      });

      await waitFor(() => FakeWebSocket.last !== null);
      await waitFor(() => target.textContent?.includes("PREVIEW READY") === true);

      expect(errors).toHaveLength(0);
      expect(statuses).toContain("live");
      expect(FakeWebSocket.lastSubscribe).toMatchObject({
        v: 1,
        type: "subscribe",
        token: "preview-token",
        scene: SNAPSHOT_FIXTURE.scene_id,
        session: SESSION_ID,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [bundleUrl] = fetchMock.mock.calls[0]!;
      const requested = new URL(String(bundleUrl));
      expect(requested.pathname).toContain(
        `/orion/api/v1/scenes/${SNAPSHOT_FIXTURE.scene_id}/render-bundle`,
      );
      expect(requested.searchParams.get("v")).toBe(BUNDLE.scene_version);
      expect(target.querySelector("span")?.textContent).toBe("PREVIEW READY");

      const rawDelta = projectionDeltaWire();
      const decoded = decodeServerFrame(rawDelta);
      expect(decoded).toMatchObject({
        type: "delta",
        seq: DELTA_FIXTURE.seq,
        patches: DELTA_FIXTURE.patches,
        cause: DELTA_FIXTURE.cause,
      });
      expect(decoded).not.toHaveProperty("schema_version");

      FakeWebSocket.last!.push(rawDelta);
      await waitFor(() => target.textContent?.includes("PROJECTION APPLIED") === true);
      expect(target.querySelector("span")?.textContent).toBe("PROJECTION APPLIED");
    } finally {
      handle?.disconnect();
      target.remove();
    }
  });

  it("fails closed with the typed bundle error on a scene-version mismatch", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const errors: SolarError[] = [];
    const mismatchedBundle: RenderBundle = {
      ...BUNDLE,
      scene_version: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(mismatchedBundle), { status: 200 })),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    let handle: ReturnType<typeof mount> | undefined;
    try {
      handle = mount({
        target,
        orionUrl: "wss://gate.example/orion/api/v1/show/stream.lsdp",
        token: "preview-token",
        mode: "test",
        scene: SNAPSHOT_FIXTURE.scene_id,
        testSession: SESSION_ID,
        onError: (error) => errors.push(error),
      });

      await waitFor(() =>
        errors.some((error) => error.code === "BUNDLE_FETCH_FAILED"),
      );

      const error = errors.find(({ code }) => code === "BUNDLE_FETCH_FAILED");
      expect(error).toMatchObject({
        code: "BUNDLE_FETCH_FAILED",
        recoverable: true,
      });
      expect(error?.message).toContain("bundle scene_version mismatch");
      expect(target.textContent).not.toContain("PREVIEW READY");
    } finally {
      handle?.disconnect();
      target.remove();
    }
  });
});

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
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
