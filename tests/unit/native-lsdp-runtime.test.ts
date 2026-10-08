import type { Operation } from "fast-json-patch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { nativeTreeHash } from "../../src/internal/native-tree";
import { NativeState } from "../../src/internal/native-state";
import { NativeLsdpRuntime } from "../../src/engine/native-lsdp-runtime";
import type { MountOptions } from "../../src/types";
import type { SceneSourceDelivery } from "../../src/scenes/types";
import { nativeManifest } from "../helpers/native-source";

const mocks = vi.hoisted(() => ({
  subscribeConflicts: 0,
  retrySnapshot: null as unknown,
  peers: [] as Array<{
    options: Record<string, unknown>;
    close: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  }>,
  mount: vi.fn(),
  disconnectSession: vi.fn(),
  activate: vi.fn(),
  feedback: vi.fn(
    async (
      _url: string,
      _lane: string,
      _value: unknown,
      _signal: AbortSignal,
    ) => {},
  ),
  media: {
    update: vi.fn(),
    refresh: vi.fn(),
    pause: vi.fn(async () => {}),
    resume: vi.fn(),
    dispose: vi.fn(),
    clearMedia: vi.fn(async () => {}),
  },
  stream: { onReservedLeaves: vi.fn(), dispose: vi.fn() },
}));
vi.mock("../../vendor/lsdp-native-browser/src/browser.js", () => ({
  BrowserLSDP: class {
    ready = Promise.resolve();
    close = vi.fn();
    reads = 0;
    transaction = vi.fn(async (request: { kind: string; target: string }) => {
      if (request.kind === "subscribe" && mocks.subscribeConflicts > 0) {
        mocks.subscribeConflicts--;
        throw Object.assign(new Error("BASE_MISMATCH"), {
          code: "BASE_MISMATCH",
        });
      }
      if (request.kind === "state.read" && this.reads++ > 0) {
        const receive = this.options.onTransaction as (
          value: unknown,
          context: unknown,
        ) => Promise<unknown>;
        await receive(mocks.retrySnapshot, {
          metadata: { target: request.target, profile: "lsdp.state.read/1" },
          signal: new AbortController().signal,
        });
      }
      return {};
    });
    constructor(
      _url: string,
      readonly options: Record<string, unknown>,
    ) {
      mocks.peers.push(this);
    }
  },
}));
vi.mock("../../src/engine/control-feedback", () => ({
  presentationFeedback: mocks.feedback,
}));
vi.mock("../../src/engine/vision-presenter", () => ({
  mountVisionScene: mocks.mount,
  disconnectVisionSession: mocks.disconnectSession,
  activateVisionScene: mocks.activate,
}));
vi.mock("../../src/engine/live-media", () => ({
  CaptureStreamPool: class {},
  LiveMediaController: class {
    update = mocks.media.update;
    refresh = mocks.media.refresh;
    pause = mocks.media.pause;
    resume = mocks.media.resume;
    dispose = mocks.media.dispose;
  },
}));
vi.mock("../../src/sources/peers", () => ({
  createPeerSources: () => mocks.stream,
}));
vi.mock("../../src/sources/capture", () => ({
  createCaptureResolver: () => () => null,
}));

const version = `sha256:${"1".repeat(64)}`;
const document = {
  lsml: "1.1",
  scene_id: "real-source",
  scene_version: version,
  layout: { type: "frame", children: [] },
  defaults: { "__lit.text.title": "before" },
};
const origin: SceneSourceDelivery = {
  sceneId: document.scene_id,
  sceneVersion: version,
  sourceDigest: version,
  revision: 1,
  data: zipSync({ "scene.lsml": strToU8(JSON.stringify(document)) }),
  format: "lsmlz",
  assets: new Map(),
  blueManifest: nativeManifest(document.scene_id, version),
};
const turn = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 10));

async function setup(
  initial: unknown = document,
  selector?: string,
  resource = "scene",
) {
  const scene = {
    applyPatch: vi.fn(async () => {}),
    clearMedia: vi.fn(async () => {}),
    canApplyPatch: vi.fn(() => true),
    dispose: vi.fn(),
    mediaSources: [],
    activate: vi.fn(),
    feedback: vi.fn(async () => {}),
  };
  mocks.mount.mockResolvedValue(scene);
  const options: MountOptions = {
    target: documentElement(),
    nativeLSDP: {
      url: "ws://127.0.0.1:4520/lsdp",
      resource,
      selector,
    },
    token: "",
    mode: "test",
    sceneSourceProvider: { get: vi.fn(async () => origin) },
    onStatus: vi.fn(),
    onError: vi.fn(),
  };
  const runtime = new NativeLsdpRuntime(options);
  runtime.start();
  await turn();
  const peer = mocks.peers.at(-1)!;
  const receiveRaw = peer.options.onTransaction as (
    event: unknown,
    context: unknown,
  ) => Promise<unknown>;
  const flush = () =>
    (
      runtime as unknown as { patches: { flush: () => Promise<void> } | null }
    ).patches?.flush();
  const receive = async (value: unknown, context: unknown) => {
    const receipt = await receiveRaw(value, context);
    await flush();
    return receipt;
  };
  const context = (profile: string) => ({
    metadata: { target: resource, profile },
    signal: new AbortController().signal,
  });
  await receive(structuredClone(initial), context("lsdp.state.read/1"));
  await turn();
  return { runtime, options, peer, scene, receive, receiveRaw, flush, context };
}
function documentElement(): HTMLElement {
  return globalThis.document.createElement("div");
}
function change(path = "/defaults/__lit.text.title") {
  const id = "a".repeat(32);
  return {
    kind: "applied_change",
    sequence: 1,
    mutation: {
      format: "lsdp.apply/1",
      id,
      target: "scene",
      beforeHash: nativeTreeHash(document),
      operations: [{ op: "replace", path, value: "edited" }] as Operation[],
    },
    receipt: { transactionId: id, target: "scene", level: "applied" },
  };
}

describe("native Solar subscriber", () => {
  it("receives all 512 states in order and confirms every identity after their covering frame", async () => {
    const { runtime, receiveRaw, flush, context, scene, options } =
      await setup();
    const presented = vi.fn();
    let completeFrame!: () => void;
    scene.applyPatch.mockImplementationOnce(
      async () =>
        new Promise<void>((resolve) => {
          completeFrame = resolve;
        }),
    );
    options.target.addEventListener("solar:lsdp-applied", presented);
    let state = NativeState.from(document);
    for (let index = 1; index <= 512; index++) {
      const event = change();
      event.sequence = index;
      event.mutation.id = index.toString(16).padStart(32, "0");
      event.receipt.transactionId = event.mutation.id;
      event.mutation.beforeHash = state.stateHash;
      event.mutation.operations[0] = {
        op: "replace",
        path: "/defaults/__lit.text.title",
        value: String(index),
      };
      expect(
        await receiveRaw(event, context("lsdp.state.subscription/1")),
      ).toMatchObject({ level: "received", transactionId: event.mutation.id });
      state = state.patch(event.mutation.operations);
    }
    expect(presented).not.toHaveBeenCalled();
    expect(scene.applyPatch).toHaveBeenCalledOnce();
    completeFrame();
    await flush();
    expect(scene.applyPatch).toHaveBeenCalledTimes(2);
    expect(scene.applyPatch).toHaveBeenCalledWith({
      "__lit.text.title": "512",
    });
    expect(presented).toHaveBeenCalledTimes(512);
    expect(
      presented.mock.calls.map(([event]) => event.detail.sequence),
    ).toEqual(Array.from({ length: 512 }, (_, i) => i + 1));
    expect(presented.mock.calls.at(-1)?.[0].detail.presentation).toEqual({
      throughSequence: 512,
      mutationCount: 511,
      stateHash: state.stateHash,
    });
    runtime.disconnect();
  });
  it("catches up explicit native overflow on the same socket and retained canvas", async () => {
    const { runtime, receive, context, peer, scene, options } = await setup();
    mocks.retrySnapshot = {
      ...document,
      defaults: { "__lit.text.title": "512" },
    };
    const observed = vi.fn();
    options.target.addEventListener("solar:lsdp-resync", observed);
    await expect(
      receive(
        { kind: "resync", target: "scene", reason: "SUBSCRIBER_LAGGED" },
        context("lsdp.state.subscription/1"),
      ),
    ).resolves.toEqual({ level: "received" });
    expect(scene.applyPatch).toHaveBeenCalledWith({
      "__lit.text.title": "512",
    });
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    expect(peer.close).not.toHaveBeenCalled();
    expect(mocks.media.dispose).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalledTimes(1);
    const after = change();
    after.mutation.beforeHash = nativeTreeHash(mocks.retrySnapshot);
    await expect(
      receive(after, context("lsdp.state.subscription/1")),
    ).resolves.toMatchObject({ level: "received" });
    runtime.disconnect();
  });
  it("stages a new archive for an image absent from the current package and retains the media controller", async () => {
    const { runtime, receive, context, scene, options } = await setup();
    const observation = vi.fn();
    options.target.addEventListener("solar:lsdp-applied", observation);
    scene.canApplyPatch.mockReturnValue(false);
    await receive(change(), context("lsdp.state.subscription/1"));
    expect(scene.applyPatch).not.toHaveBeenCalled();
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(mocks.media.dispose).not.toHaveBeenCalled();
    expect(mocks.media.pause).toHaveBeenCalled();
    expect(mocks.media.resume).toHaveBeenCalled();
    expect(observation).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ render: "document" }),
      }),
    );
    runtime.disconnect();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.peers.length = 0;
    mocks.subscribeConflicts = 0;
    mocks.retrySnapshot = structuredClone(document);
  });
  it("keeps exact generation identity and ignores changes to another physical lane", async () => {
    const collection = {
      a: structuredClone(document),
      b: structuredClone(document),
    };
    const { runtime, receive, context, scene, options } = await setup(
      collection,
      "a",
    );
    const event = change();
    event.mutation.beforeHash = nativeTreeHash(collection);
    event.mutation.operations = [
      {
        op: "replace",
        path: "/b/defaults/__lit.text.title",
        value: "other lane",
      },
    ];
    await receive(event, context("lsdp.state.subscription/1"));
    expect(mocks.mount).toHaveBeenCalledOnce();
    expect(scene.applyPatch).not.toHaveBeenCalled();
    collection.b.defaults["__lit.text.title"] = "other lane";
    event.sequence = 2;
    event.mutation.beforeHash = nativeTreeHash(collection);
    event.mutation.operations = [
      {
        op: "replace",
        path: "/a/defaults/__lit.text.title",
        value: "own lane",
      },
      {
        op: "add",
        path: "/a/x-orion",
        value: { runtime_instance_id: "Blue-1" },
      },
    ] as typeof event.mutation.operations;
    await receive(event, context("lsdp.state.subscription/1"));
    expect(scene.applyPatch).toHaveBeenCalledWith({
      "__lit.text.title": "own lane",
    });
    expect(options.sceneSourceProvider.get).toHaveBeenCalledOnce();
    expect(mocks.mount).toHaveBeenCalledOnce();
    runtime.disconnect();
  });
  it("waits for a missing generation and clears a removed session instead of selecting another entry", async () => {
    const { runtime, receive, context } = await setup({ b: document }, "a");
    expect(mocks.mount).not.toHaveBeenCalled();
    const event = change();
    event.mutation.beforeHash = nativeTreeHash({ b: document });
    event.mutation.operations = [
      { op: "add", path: "/a", value: document },
    ] as typeof event.mutation.operations;
    await receive(event, context("lsdp.state.subscription/1"));
    expect(mocks.mount).toHaveBeenCalledOnce();
    event.sequence = 2;
    event.mutation.beforeHash = nativeTreeHash({ a: document, b: document });
    event.mutation.operations = [
      { op: "remove", path: "/a" },
    ] as typeof event.mutation.operations;
    await receive(event, context("lsdp.state.subscription/1"));
    expect(mocks.media.dispose).toHaveBeenCalledOnce();
    expect(mocks.mount).toHaveBeenCalledOnce();
    runtime.disconnect();
  });
  it("subscribes to an unselected resource and renders the first real LSML received", async () => {
    const { runtime, peer, receive, context, options } = await setup(null);
    expect(mocks.mount).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
    expect(peer.transaction).toHaveBeenCalledWith(
      { kind: "subscribe", target: "scene", stateHash: nativeTreeHash(null) },
      expect.anything(),
    );
    const base = change();
    const event = {
      ...base,
      mutation: {
        ...base.mutation,
        beforeHash: nativeTreeHash(null),
        operations: [{ op: "replace", path: "", value: document }],
      },
    };
    await receive(event, context("lsdp.state.subscription/1"));
    expect(mocks.mount).toHaveBeenCalledOnce();
    runtime.disconnect();
  });
  it("subscribes only after the fragmented snapshot is rendered", async () => {
    const { runtime, peer, options } = await setup();
    expect(peer.transaction).toHaveBeenCalledWith(
      { kind: "state.read", target: "scene" },
      expect.anything(),
    );
    expect(peer.transaction).toHaveBeenCalledWith(
      {
        kind: "subscribe",
        target: "scene",
        stateHash: nativeTreeHash(document),
      },
      expect.anything(),
    );
    expect(options.onStatus).toHaveBeenLastCalledWith("live");
    runtime.disconnect();
  });
  it("reads and renders a fresh baseline when the scene advances before subscription", async () => {
    mocks.subscribeConflicts = 1;
    const next = {
      ...document,
      defaults: { "__lit.text.title": "new snapshot" },
    };
    mocks.retrySnapshot = next;
    const { runtime, peer, options } = await setup();
    expect(peer.transaction).toHaveBeenLastCalledWith(
      { kind: "subscribe", target: "scene", stateHash: nativeTreeHash(next) },
      expect.anything(),
    );
    expect(options.onStatus).toHaveBeenLastCalledWith("live");
    expect(options.onError).not.toHaveBeenCalled();
    runtime.disconnect();
  });
  it("surfaces repeated baseline conflicts after four attempts", async () => {
    mocks.subscribeConflicts = 4;
    const { runtime, peer, options } = await setup();
    expect(
      peer.transaction.mock.calls.filter(
        ([request]) => request.kind === "subscribe",
      ),
    ).toHaveLength(4);
    expect(options.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INTERNAL", recoverable: true }),
    );
    expect(options.onStatus).not.toHaveBeenLastCalledWith("live");
    runtime.disconnect();
  });
  it("applies and presents received mutations without producer feedback or projection", async () => {
    const initial = { ...document, "x-orion": { producer: "upstream" } };
    const resource = "solar/preview";
    const { runtime, receiveRaw, flush, context, scene, options, peer } =
      await setup(initial, undefined, resource);
    let finish!: () => void;
    scene.applyPatch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const observed = vi.fn();
    const reception = vi.fn();
    options.target.addEventListener("solar:lsdp-applied", observed);
    options.target.addEventListener("solar:lsdp-received", reception);
    const event = change();
    event.mutation.beforeHash = nativeTreeHash(initial);
    event.mutation.target = resource;
    event.receipt.target = resource;
    const received = await receiveRaw(
      event,
      context("lsdp.state.subscription/1"),
    );
    expect(received).toMatchObject({
      level: "received",
      transactionId: "a".repeat(32),
    });
    const applied = flush();
    await turn();
    expect(observed).not.toHaveBeenCalled();
    expect(scene.applyPatch).toHaveBeenCalledWith({
      "__lit.text.title": "edited",
    });
    expect(reception).toHaveBeenCalledOnce();
    expect(reception.mock.calls[0]![0].detail).not.toHaveProperty("projection");
    expect(mocks.feedback).not.toHaveBeenCalled();
    finish();
    await applied;
    expect(observed).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          transactionId: "a".repeat(32),
          presentation: expect.objectContaining({ mutationCount: 1 }),
        }),
      }),
    );
    expect(observed.mock.calls[0]![0].detail).not.toHaveProperty("projection");
    expect(mocks.feedback).not.toHaveBeenCalled();
    expect(mocks.peers).toHaveLength(1);
    expect(
      peer.transaction.mock.calls.every(
        ([request]) => request.target === resource,
      ),
    ).toBe(true);
    runtime.disconnect();
  });
  it("rebuilds a structural edit in memory while retaining the original source manifest", async () => {
    const { runtime, receive, context, options } = await setup();
    const event = change();
    event.mutation.operations = [
      { op: "add", path: "/layout/background", value: "#ffa000" },
    ];
    await receive(event, context("lsdp.state.subscription/1"));
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(options.sceneSourceProvider.get).toHaveBeenCalledTimes(1);
    expect(mocks.media.dispose).not.toHaveBeenCalled();
    expect(mocks.media.pause).toHaveBeenCalledTimes(1);
    expect(mocks.media.resume).toHaveBeenCalled();
    expect(mocks.mount.mock.calls[1]![1]).toBe(origin);
    expect(origin.blueManifest.scene_version).toBe(version);
    expect(mocks.feedback).not.toHaveBeenCalled();
    runtime.disconnect();
  });
  it("rejects stale baselines and invalid receipts without touching Vision", async () => {
    const { runtime, receive, context, scene } = await setup();
    const stale = change();
    stale.mutation.beforeHash = `tree-sha256:${"0".repeat(64)}`;
    await expect(
      receive(stale, context("lsdp.state.subscription/1")),
    ).rejects.toThrow(/resynchronization/);
    const invalid = change();
    invalid.receipt.transactionId = "other";
    await expect(
      receive(invalid, context("lsdp.state.subscription/1")),
    ).rejects.toThrow();
    expect(scene.applyPatch).not.toHaveBeenCalled();
    runtime.disconnect();
  });

  it("drains camera uploads before staging a structural replacement", async () => {
    const { runtime, receive, context } = await setup();
    let drained!: () => void;
    mocks.media.pause.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          drained = resolve;
        }),
    );
    const event = change();
    event.mutation.operations = [
      { op: "add", path: "/layout/background", value: "#ffa000" },
    ];
    const applied = receive(event, context("lsdp.state.subscription/1"));
    await turn();
    expect(mocks.media.pause).toHaveBeenCalled();
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    drained();
    await applied;
    expect(mocks.mount).toHaveBeenCalledTimes(2);
    expect(mocks.media.resume).toHaveBeenCalled();
    expect(mocks.media.dispose).not.toHaveBeenCalled();
    runtime.disconnect();
  });
  it("rejects failed presentation and late work after disconnect", async () => {
    const { runtime, receive, context, scene } = await setup();
    scene.applyPatch.mockRejectedValueOnce(new Error("Vision rejected"));
    await expect(
      receive(change(), context("lsdp.state.subscription/1")),
    ).rejects.toThrow("Vision rejected");
    runtime.disconnect();
    await expect(
      receive(change(), context("lsdp.state.subscription/1")),
    ).rejects.toThrow();
    expect(scene.dispose).toHaveBeenCalled();
  });

  it("keeps the accepted scene alive when staging activation fails", async () => {
    const { runtime, receive, context, scene } = await setup();
    const replacement = { ...scene, dispose: vi.fn() };
    mocks.mount.mockResolvedValueOnce(replacement);
    mocks.activate.mockImplementationOnce(() => {
      throw new Error("activation failed");
    });
    const event = change();
    event.mutation.operations = [
      { op: "add", path: "/layout/background", value: "black" },
    ];
    await expect(
      receive(event, context("lsdp.state.subscription/1")),
    ).rejects.toThrow("activation failed");
    expect(replacement.dispose).toHaveBeenCalledOnce();
    expect(scene.dispose).not.toHaveBeenCalled();
    expect(mocks.media.resume).toHaveBeenCalled();
    await receive(change(), context("lsdp.state.subscription/1"));
    expect(scene.applyPatch).toHaveBeenCalled();
    runtime.disconnect();
  });

  it("recovers subscription failures through a fresh native snapshot", async () => {
    const { runtime, peer } = await setup();
    vi.useFakeTimers();
    try {
      const failed = peer.options.onIncomingFailed as (
        context: unknown,
        error: Error,
      ) => void;
      failed({}, new Error("EVENT_CAPACITY"));
      expect(peer.close).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(mocks.peers).toHaveLength(2);
      expect(mocks.peers[1]!.transaction).toHaveBeenCalledWith(
        { kind: "state.read", target: "scene" },
        expect.anything(),
      );
      runtime.disconnect();
      await vi.runOnlyPendingTimersAsync();
      expect(mocks.peers).toHaveLength(2);
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });
});

describe("coordinated physical lane presentation", () => {
  it.each(["commit", "finalize"])(
    "reconstructs a fresh subscriber from a compact %s resource",
    async (phase) => {
      vi.clearAllMocks();
      const ready = await setup(
        {
          ...document,
          "x-solar-transition": { request_id: "compact-recovery", phase },
        },
        undefined,
        "solar/preview",
      );
      expect(mocks.mount).toHaveBeenCalledOnce();
      expect(ready.scene.activate).toHaveBeenCalledOnce();
      expect(mocks.feedback.mock.calls.at(-1)?.[2]).toMatchObject({
        phase: phase === "commit" ? "committed" : "active",
        scene_id: document.scene_id,
      });
      ready.runtime.disconnect();
    },
  );
  it("fetches and mounts a fresh scene on A to B to A without retaining inactive frames", async () => {
    vi.clearAllMocks();
    const initial = {
      ...structuredClone(document),
      layout: {
        type: "frame",
        children: [
          {
            id: "animated-title",
            kind: "text",
            bind: { value: "__lit.text.title" },
            style: { fontSize: 20 },
          },
        ],
      },
      animations: {
        pulse: {
          target: "animated-title",
          keyframes: {
            duration_ms: 100,
            steps: [
              { at: 0, opacity: 1 },
              { at: 1, opacity: 0 },
            ],
          },
        },
      },
    };
    const ready = await setup(initial, undefined, "solar/preview");
    Object.assign(ready.scene, {
      clearMedia: vi.fn(async () => {}),
      deactivate: vi.fn(),
    });
    const second = {
      ...ready.scene,
      applyPatch: vi.fn(async () => {}),
      dispose: vi.fn(),
      activate: vi.fn(),
      clearMedia: vi.fn(async () => {}),
    };
    const third = {
      ...second,
      dispose: vi.fn(),
      applyPatch: vi.fn(async () => {}),
    };
    mocks.mount.mockResolvedValueOnce(second).mockResolvedValueOnce(third);
    vi.mocked(ready.options.sceneSourceProvider.get).mockImplementation(
      async (id) => ({
        ...origin,
        sceneId: id,
        blueManifest: nativeManifest(id, version),
      }),
    );
    let state = initial as Record<string, unknown>,
      sequence = 0;
    const deliver = async (value: Record<string, unknown>) => {
      const transactionId = String(++sequence).padStart(32, "0");
      await ready.receive(
        {
          kind: "applied_change",
          sequence,
          mutation: {
            format: "lsdp.apply/1",
            id: transactionId,
            target: "solar/preview",
            beforeHash: nativeTreeHash(state),
            operations: [{ op: "replace", path: "", value }],
          },
          receipt: { target: "solar/preview", transactionId, level: "applied" },
        },
        ready.context("lsdp.state.subscription/1"),
      );
      state = value;
    };
    const select = async (source: typeof initial, request_id: string) => {
      const previous = state;
      for (const phase of ["prepare", "commit", "finalize"])
        await deliver({
          ...(phase === "finalize" ? source : previous),
          "x-solar-transition": { request_id, phase, source },
        });
      await deliver(source);
    };
    await deliver({
      ...initial,
      defaults: { "__lit.text.title": "mutated before switching" },
    });
    await select({ ...initial, scene_id: "second-source" }, "to-second");
    await select(initial, "back-to-first");
    expect(mocks.mount).toHaveBeenCalledTimes(3);
    expect(ready.options.sceneSourceProvider.get).toHaveBeenCalledTimes(3);
    expect(ready.scene.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(third.dispose).not.toHaveBeenCalled();
    expect(mocks.disconnectSession).not.toHaveBeenCalled();
    for (const call of mocks.mount.mock.calls) expect(call[6]).toBe(true);
    ready.runtime.disconnect();
    expect(third.dispose).toHaveBeenCalledOnce();
    expect(mocks.disconnectSession).toHaveBeenCalledOnce();
  });
  it("restores a fresh subscriber after an aborted Prism request", async () => {
    vi.clearAllMocks();
    const requestId =
      "prepare-preview:8cbef8cd-ed05-42ca-af9c-7e2762e860b8:4c067e0d-c80d-4119-8cc3-4947d01e082b";
    const ready = await setup(
      {
        ...document,
        "x-solar-transition": {
          request_id: requestId,
          phase: "abort",
        },
      },
      undefined,
      "solar/preview",
    );
    expect(mocks.mount).toHaveBeenCalledOnce();
    expect(mocks.activate).toHaveBeenCalledOnce();
    expect(mocks.feedback.mock.calls.at(-1)?.[2]).toMatchObject({
      request_id: requestId,
      phase: "aborted",
      scene_id: document.scene_id,
    });
    ready.runtime.disconnect();
  });
  async function staged() {
    const initial = structuredClone(document);
    const ready = await setup(initial, undefined, "solar/program");
    const next = {
      ...ready.scene,
      applyPatch: vi.fn(async () => {}),
      dispose: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
    };
    mocks.mount.mockResolvedValueOnce(next);
    let state: unknown = initial,
      sequence = 0;
    const deliver = async (phase: string, id = "selection-a") => {
      const value =
        phase === "cleanup"
          ? { ...initial, defaults: { "__lit.text.title": "candidate" } }
          : {
              ...initial,
              "x-solar-transition": {
                request_id: id,
                phase,
                source: {
                  ...initial,
                  defaults: { "__lit.text.title": "candidate" },
                },
              },
            };
      const transactionId = String(++sequence).padStart(32, "0");
      const event = {
        kind: "applied_change",
        sequence,
        mutation: {
          format: "lsdp.apply/1",
          id: transactionId,
          target: "solar/program",
          beforeHash: nativeTreeHash(state),
          operations: [{ op: "replace", path: "", value }],
        },
        receipt: { target: "solar/program", transactionId, level: "applied" },
      };
      await ready.receive(event, ready.context("lsdp.state.subscription/1"));
      state = value;
    };
    return { ...ready, next, deliver };
  }
  it("prepares invisibly, commits while retaining old frame, and aborts without recreating it", async () => {
    const ready = await staged();
    await ready.deliver("prepare");
    expect(ready.next.activate).not.toHaveBeenCalled();
    expect(ready.scene.dispose).not.toHaveBeenCalled();
    expect(mocks.feedback.mock.calls.at(-1)?.[2]).toMatchObject({
      phase: "prepared",
      request_id: "selection-a",
    });
    await ready.deliver("commit");
    expect(ready.next.activate).toHaveBeenCalledOnce();
    expect(ready.scene.dispose).not.toHaveBeenCalled();
    await ready.deliver("abort");
    expect(ready.scene.activate).toHaveBeenCalledOnce();
    expect(ready.next.dispose).toHaveBeenCalledOnce();
    expect(mocks.feedback.mock.calls.at(-1)?.[2]).toMatchObject({
      phase: "aborted",
    });
    ready.runtime.disconnect();
  });
  it("finalizes once and re-acknowledges replay without another mount", async () => {
    const ready = await staged();
    await ready.deliver("prepare");
    await ready.deliver("commit");
    await ready.deliver("finalize");
    expect(ready.scene.dispose).not.toHaveBeenCalled();
    const mounts = mocks.mount.mock.calls.length;
    await ready.deliver("finalize");
    expect(mocks.mount).toHaveBeenCalledTimes(mounts);
    expect(mocks.feedback.mock.calls.at(-1)?.[2]).toMatchObject({
      phase: "active",
    });
    await ready.deliver("cleanup");
    expect(ready.scene.dispose).toHaveBeenCalledOnce();
    expect(mocks.mount).toHaveBeenCalledTimes(mounts);
    expect(ready.next.dispose).not.toHaveBeenCalled();
    ready.runtime.disconnect();
    expect(ready.scene.dispose).toHaveBeenCalledOnce();
  });
  it("can compensate finalization while its receipt or cleanup is unresolved", async () => {
    const ready = await staged();
    await ready.deliver("prepare");
    await ready.deliver("commit");
    await ready.deliver("finalize");
    await ready.deliver("abort");
    expect(ready.scene.activate).toHaveBeenCalledOnce();
    expect(ready.next.dispose).toHaveBeenCalledOnce();
    ready.runtime.disconnect();
  });
  it("reports failed staging while preserving accepted frame", async () => {
    const ready = await staged();
    mocks.mount
      .mockReset()
      .mockRejectedValueOnce(new Error("renderer refused"));
    await ready.deliver("prepare");
    expect(ready.scene.dispose).not.toHaveBeenCalled();
    expect(mocks.feedback.mock.calls.at(-1)?.[2]).toMatchObject({
      phase: "failed",
      error: "renderer refused",
    });
    await ready.deliver("abort");
    ready.runtime.disconnect();
  });
});
