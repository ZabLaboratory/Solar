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

const FIXTURE_DIR = resolve(
  process.cwd(),
  "tests",
  "fixtures",
  "orion-181-chat-overlay-v1",
);

interface ProvenanceFixture {
  artifact_kind: string;
  program_id: string;
  program_digest: string;
  schema_version: string;
  compiler_version: string;
  runtime_abi: string;
  source_revision: {
    digest: string;
    id: string;
    kind: string;
    revision: number;
  };
  producer_copies: Array<{
    repo: string;
    pull_request: number;
    merge_commit: string;
    path: string;
    byte_length: number;
    sha256: string;
    byte_identical_to_orion_copy?: boolean;
    byte_identical_to_blue_copy?: boolean;
  }>;
  entrypoint: {
    kind: string;
    leaf: string;
    platform: string;
    channel: string;
    event_type: string;
  };
  state: {
    outputs: Array<{ name: string; type: string }>;
    variables: Array<{ initial: LeafValue; name: string; type: string }>;
  };
  ordering: {
    duplicate_event: string;
    event_inbox: string;
    sequence_gap: string;
  };
  projection: {
    schema_version: string;
    scene_digest: string;
    runtime_instance_id: string;
    target: string;
    render_revision: string;
    correlation_id: string;
  };
  accepted_states: Array<{
    frame: "snapshot" | "delta";
    seq: number;
    event_id: string | null;
    message: string | null;
    overlay_message: string;
    chat_count: number;
  }>;
  render_bundle_scene_version: string;
}

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
  target: string;
  render_revision: string;
  correlation_id: string;
}

function readFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(FIXTURE_DIR, `${name}.json`), "utf8"),
  ) as T;
}

const BUNDLE = readFixture<RenderBundle>("bundle");
const PROVENANCE = readFixture<ProvenanceFixture>("provenance");
const SNAPSHOT_FIXTURE = readFixture<SnapshotFixture>("snapshot");
const FIRST_DELTA = readFixture<ProjectionDeltaFixture>("delta-evt-1");
const SECOND_DELTA = readFixture<ProjectionDeltaFixture>("delta-evt-2");

function validSnapshotFrame(): ReturnType<typeof snapshot> {
  return snapshot({
    seq: SNAPSHOT_FIXTURE.seq,
    scene_id: SNAPSHOT_FIXTURE.scene_id,
    scene_version: SNAPSHOT_FIXTURE.scene_version,
    state: { ...SNAPSHOT_FIXTURE.state },
  });
}

function validDeltaFrame(
  frame: ProjectionDeltaFixture,
): ReturnType<typeof delta> {
  return delta({
    seq: frame.seq,
    patches: frame.patches.map(({ path, value }) => ({ path, value })),
    cause: frame.cause,
    projectionMetadata: {
      schema_version: frame.schema_version,
      scene_digest: frame.scene_digest,
      runtime_instance_id: frame.runtime_instance_id,
      target: frame.target,
      render_revision: frame.render_revision,
      correlation_id: frame.correlation_id,
    },
  });
}

function encodedDelta(frame: ProjectionDeltaFixture): string {
  return encodeFrame(validDeltaFrame(frame));
}

function renderedText(target: HTMLElement): string[] {
  return Array.from(
    target.querySelectorAll("span"),
    (span) => span.textContent ?? "",
  );
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | null = null;
  static lastSubscribe: Extract<ClientFrame, { type: "subscribe" }> | null =
    null;

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

describe("Solar consumes the authenticated Orion #181 chat overlay", () => {
  it("pins producer provenance and renders baseline plus two data-bound projections", async () => {
    expect(PROVENANCE).toMatchObject({
      artifact_kind: "blue.program.v1",
      program_id: "orion-181-chat-overlay",
      program_digest:
        "sha256:e37e2d6e989b4b56f1ff1b74a4f6323331d263fd80b2dc829a5b293deaf502ef",
      schema_version: "blue.program.v1",
      compiler_version: "0.1.0",
      runtime_abi: "blue-runtime-abi.v1",
      render_bundle_scene_version: BUNDLE.scene_version,
    });
    expect(PROVENANCE.producer_copies).toEqual([
      expect.objectContaining({
        repo: "ZabLaboratory/Blue",
        pull_request: 327,
        merge_commit: "5d644a6a2f1b25682c9d79ffdcb470c6d2f92216",
        byte_length: 5505,
        sha256:
          "fc5cd671729f44bbe09ad278d93a8cc0ac0add9c275c541df2aa6b16f4a3b97a",
        byte_identical_to_orion_copy: true,
      }),
      expect.objectContaining({
        repo: "ZabLaboratory/Orion",
        pull_request: 382,
        merge_commit: "c5a2c25b2aed1d68079ed0ab6224625a51516358",
        byte_length: 5505,
        sha256:
          "fc5cd671729f44bbe09ad278d93a8cc0ac0add9c275c541df2aa6b16f4a3b97a",
        byte_identical_to_blue_copy: true,
      }),
    ]);
    expect(PROVENANCE.state.variables).toEqual([
      { initial: 0, name: "chat_count", type: "core.number" },
      { initial: "", name: "overlay_message", type: "core.string" },
    ]);
    expect(PROVENANCE.accepted_states).toEqual([
      {
        frame: "snapshot",
        seq: 1,
        event_id: null,
        message: null,
        overlay_message: "",
        chat_count: 0,
      },
      {
        frame: "delta",
        seq: 2,
        event_id: "evt-1",
        message: "gg",
        overlay_message: "chat: gg",
        chat_count: 1,
      },
      {
        frame: "delta",
        seq: 3,
        event_id: "evt-2",
        message: "hello",
        overlay_message: "chat: hello",
        chat_count: 2,
      },
    ]);

    expect(BUNDLE.scene_version).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await hashInlineBundle(BUNDLE)).toBe(BUNDLE.scene_version);
    expect(SNAPSHOT_FIXTURE.scene_version).toBe(BUNDLE.scene_version);
    expect(PROVENANCE.projection.scene_digest).not.toBe(BUNDLE.scene_version);

    const target = document.createElement("div");
    document.body.appendChild(target);
    const statuses: SolarStatus[] = [];
    const errors: SolarError[] = [];
    const fetchMock = vi.fn(
      async () =>
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
        mode: "broadcast",
        onStatus: (status) => statuses.push(status),
        onError: (error) => errors.push(error),
      });

      await waitFor(() => FakeWebSocket.last !== null);
      await waitFor(() => renderedText(target).join("|") === "|0");

      expect(errors).toHaveLength(0);
      expect(statuses).toContain("live");
      expect(FakeWebSocket.last?.protocols).toEqual(["lsdp.v1.1", "lsdp.v1"]);
      expect(FakeWebSocket.lastSubscribe).toMatchObject({
        v: 1,
        type: "subscribe",
        token: "preview-token",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const firstWire = encodedDelta(FIRST_DELTA);
      const decodedFirst = decodeServerFrame(firstWire);
      expect(decodedFirst).toMatchObject({
        type: "delta",
        seq: FIRST_DELTA.seq,
        patches: FIRST_DELTA.patches,
        cause: FIRST_DELTA.cause,
        schema_version: FIRST_DELTA.schema_version,
        scene_digest: FIRST_DELTA.scene_digest,
        runtime_instance_id: FIRST_DELTA.runtime_instance_id,
        target: FIRST_DELTA.target,
        render_revision: FIRST_DELTA.render_revision,
        correlation_id: FIRST_DELTA.correlation_id,
      });

      FakeWebSocket.last!.push(firstWire);
      await waitFor(() => renderedText(target).join("|") === "chat: gg|1");

      const secondWire = encodedDelta(SECOND_DELTA);
      const decodedSecond = decodeServerFrame(secondWire);
      expect(decodedSecond).toMatchObject({
        type: "delta",
        seq: SECOND_DELTA.seq,
        patches: SECOND_DELTA.patches,
        schema_version: SECOND_DELTA.schema_version,
        target: SECOND_DELTA.target,
      });

      FakeWebSocket.last!.push(secondWire);
      await waitFor(() => renderedText(target).join("|") === "chat: hello|2");

      // The reader owns LSDP sequence handling: a replayed delta is silently
      // dropped. Producer event idempotence remains covered by Orion#181.
      FakeWebSocket.last!.push(secondWire);
      expect(renderedText(target)).toEqual(["chat: hello", "2"]);
      expect(errors).toHaveLength(0);
    } finally {
      handle?.disconnect();
      target.remove();
    }
  });

  it("fails closed when the hashed bundle scene_version mismatches the snapshot", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const errors: SolarError[] = [];
    const mismatchedBundle: RenderBundle = {
      ...BUNDLE,
      scene_version:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(mismatchedBundle), { status: 200 }),
      ),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    let handle: ReturnType<typeof mount> | undefined;
    try {
      handle = mount({
        target,
        orionUrl: "wss://gate.example/orion/api/v1/show/stream.lsdp",
        token: "preview-token",
        mode: "broadcast",
        onError: (error) => errors.push(error),
      });

      await waitFor(() =>
        errors.some((error) => error.code === "BUNDLE_FETCH_FAILED"),
      );

      expect(
        errors.find(({ code }) => code === "BUNDLE_FETCH_FAILED"),
      ).toMatchObject({
        code: "BUNDLE_FETCH_FAILED",
        recoverable: true,
      });
      expect(target.textContent).not.toContain("chat: gg");
      expect(target.textContent).not.toContain("0");
    } finally {
      handle?.disconnect();
      target.remove();
    }
  });
});

async function waitFor(
  predicate: () => boolean,
  {
    timeout = 2000,
    interval = 10,
  }: { timeout?: number; interval?: number } = {},
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
