import type { Operation } from "fast-json-patch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { nativeTreeHash } from "../../src/internal/native-tree";
import { NativeLsdpRuntime } from "../../src/engine/native-lsdp-runtime";
import { NativeLsdpReconnect } from "../../src/engine/native-lsdp-reconnect";
import type { MountOptions } from "../../src/types";
import type { SceneSourceDelivery } from "../../src/scenes/types";
import { nativeManifest } from "../helpers/native-source";
import { compositionFrame } from "../helpers/vision-composition-frame";

const mocks = vi.hoisted(() => ({
  compositionPublisherOptions: null as unknown,
  compositionPublishers: [] as Array<{
    options: Record<string, unknown>;
    onDisconnected: (error: unknown) => void;
  }>,
  composition: {
    publish: vi.fn(async (..._args: unknown[]) => "completed"),
    clear: vi.fn(async () => "completed"),
    retire: vi.fn(async () => {}),
  },
  peers: [] as Array<{ options: Record<string, unknown> }>,
  mount: vi.fn(),
  prewarm: vi.fn(async () => {}),
  disconnectSession: vi.fn(),
  activate: vi.fn(),
  feedback: vi.fn(async () => {}),
  media: {
    update: vi.fn(),
    refresh: vi.fn(),
    pause: vi.fn(async () => {}),
    resume: vi.fn(),
    dispose: vi.fn(),
  },
  stream: { onReservedLeaves: vi.fn(), dispose: vi.fn() },
}));

vi.mock("../../vendor/lsdp-native-browser/src/browser.js", () => ({
  BrowserLSDP: class {
    ready = Promise.resolve();
    close = vi.fn();
    transaction = vi.fn(async () => ({}));
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
  prewarmVisionSession: mocks.prewarm,
  disconnectVisionSession: mocks.disconnectSession,
  activateVisionScene: mocks.activate,
  visionMaxTextureSize: vi.fn(() => 8192),
}));
vi.mock("../../src/engine/native-composition-publisher", () => ({
  NativeCompositionPublisher: class {
    constructor(
      options: unknown,
      _onError: (error: unknown) => void,
      _createPeer: unknown,
      onDisconnected: (error: unknown) => void,
    ) {
      mocks.compositionPublisherOptions = options;
      mocks.compositionPublishers.push({
        options: options as Record<string, unknown>,
        onDisconnected,
      });
    }
    publish(...args: unknown[]) {
      return mocks.composition.publish(...args);
    }
    clear() {
      return mocks.composition.clear();
    }
    discard() {}
    retire() {
      return mocks.composition.retire();
    }
  },
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

async function setup(initial: unknown, token: MountOptions["token"] = "") {
  let handleSceneId = "";
  let handleSceneVersion = "";
  let acceptedFrame: ReturnType<typeof compositionFrame> | null = null;
  const scene = {
    get sceneId() {
      return handleSceneId;
    },
    get sceneVersion() {
      return handleSceneVersion;
    },
    get compositionFrame() {
      return acceptedFrame;
    },
    applyPatch: vi.fn(async () => {
      if (acceptedFrame)
        acceptedFrame = {
          ...acceptedFrame,
          pixelRevision: (BigInt(acceptedFrame.pixelRevision) + 1n).toString(),
        };
    }),
    clearMedia: vi.fn(async () => {}),
    canApplyPatch: vi.fn(() => true),
    dispose: vi.fn(),
    mediaSources: [],
    activate: vi.fn(),
    feedback: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
  };
  mocks.mount.mockImplementation(async (...args: unknown[]) => {
    const source = args[1] as SceneSourceDelivery;
    const renderPackage = args[5] as { sceneVersion: string };
    handleSceneId = source.sceneId;
    handleSceneVersion = renderPackage.sceneVersion;
    const frame = compositionFrame();
    frame.sceneId = source.sceneId;
    frame.sceneVersion = renderPackage.sceneVersion;
    frame.sceneSize = [640, 480];
    frame.sceneScale = [1, 1];
    frame.atlasSize = [640, 480];
    frame.canvasSize = [640, 480];
    frame.owners[0]!.localSize = [640, 480];
    frame.owners[0]!.localToWorld = [1, 0, 0, 1, 0, 0];
    frame.captures[0]!.localToWorld = [1, 0, 0, 1, 20, 30];
    frame.surfaces[0]!.sceneRect = [0, 0, 640, 480];
    frame.surfaces[0]!.atlasRect = [0, 0, 640, 480];
    acceptedFrame = frame;
    return scene;
  });
  const resource = "solar/lane-a";
  const options: MountOptions = {
    target: documentElement(),
    nativeLSDP: {
      url: "ws://127.0.0.1:4520/lsdp",
      resource,
    },
    nativeComposition: { width: 640, height: 480 },
    nativeCompositionLSDP: {
      url: "ws://127.0.0.1:4520/lsdp",
      resource: "solar/composition",
      graph: "A",
      producer_id: "solar-host-a-incarnation-1",
    },
    token,
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
    value: unknown,
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
  return { runtime, scene, receive, context };
}

function documentElement(): HTMLElement {
  return globalThis.document.createElement("div");
}

function change() {
  const id = "a".repeat(32);
  return {
    kind: "applied_change",
    sequence: 1,
    mutation: {
      format: "lsdp.apply/1",
      id,
      target: "solar/lane-a",
      beforeHash: "",
      operations: [
        {
          op: "replace",
          path: "/defaults/__lit.text.title",
          value: "edited",
        },
      ] as Operation[],
    },
    receipt: {
      transactionId: id,
      target: "solar/lane-a",
      level: "applied",
    },
  };
}

function turn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("native Solar composition attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.peers.length = 0;
    mocks.compositionPublishers.length = 0;
    mocks.compositionPublisherOptions = null;
  });

  it("publishes the accepted Vision receipt and refreshes it after a scalar patch", async () => {
    const initial = {
      ...structuredClone(document),
      layout: {
        kind: "frame",
        id: "authored-root",
        size: { w: 640, h: 480 },
        children: [
          {
            kind: "x-zab.capture",
            id: "camera.main",
            size: { w: 320, h: 180 },
          },
        ],
      },
    };
    const ready = await setup(initial);
    const initialPublication = mocks.composition.publish.mock.calls[0];
    expect(initialPublication).toBeDefined();
    const [projection, initialDocument, initialHash] = initialPublication!;
    expect(projection).toMatchObject({
      coordinateSpace: "global-scene-texels",
      atlasSize: { width: 640, height: 480 },
      groups: [
        {
          id: "prism.native-composition.root.v1",
          children: [
            { kind: "solarBand", band: 0 },
            {
              kind: "capture",
              componentId: "vision.capture.2",
              sourceComponentId: "camera",
            },
          ],
        },
      ],
      surfaces: [
        {
          band: 0,
          ownerId: "prism.native-composition.root.v1",
          coordinateSpace: "global-scene-texels",
          rect: { x: 0, y: 0, width: 640, height: 480 },
        },
      ],
    });
    expect(initialDocument).toEqual(initial);
    expect(initialHash).toBe(nativeTreeHash(initial));
    expect(mocks.mount.mock.calls[0]?.[5]).toMatchObject({
      nativeComposition: true,
      surface: { width: 640, height: 480 },
    });
    expect(mocks.compositionPublisherOptions).toMatchObject({
      resource: "solar/composition",
      graph: "A",
      producer_id: "solar-host-a-incarnation-1",
      source: { resource: "solar/lane-a" },
    });

    const event = change();
    event.mutation.beforeHash = nativeTreeHash(initial);
    await ready.receive(event, ready.context("lsdp.state.subscription/1"));
    const nextPublication = mocks.composition.publish.mock.calls.at(-1)!;
    const nextDocument = {
      ...initial,
      defaults: { "__lit.text.title": "edited" },
    };
    expect(nextPublication[1]).toEqual(nextDocument);
    expect(nextPublication[2]).toBe(nativeTreeHash(nextDocument));
    expect(nextPublication[0]).toEqual(projection);
    expect(mocks.mount).toHaveBeenCalledOnce();
    expect(ready.scene.applyPatch).toHaveBeenCalledWith({
      "__lit.text.title": "edited",
    });
    ready.runtime.disconnect();
  });

  it("reconnects only the composition peer with a fresh token and the latest accepted state", async () => {
    const initial = {
      ...structuredClone(document),
      layout: {
        kind: "frame",
        id: "authored-root",
        size: { w: 640, h: 480 },
        children: [
          {
            kind: "x-zab.capture",
            id: "camera.main",
            size: { w: 320, h: 180 },
          },
        ],
      },
    };
    const fetch = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("initial-composition-token")
      .mockResolvedValueOnce("refreshed-composition-token");
    const ready = await setup(initial, { fetch });
    expect(mocks.compositionPublishers).toHaveLength(1);
    const update = change();
    update.mutation.beforeHash = nativeTreeHash(initial);
    await ready.receive(update, ready.context("lsdp.state.subscription/1"));
    const latestPublication = mocks.composition.publish.mock.calls.at(-1);
    expect(latestPublication?.[1]).toMatchObject({
      defaults: { "__lit.text.title": "edited" },
    });

    vi.useFakeTimers();
    try {
      mocks.compositionPublishers[0]!.onDisconnected(
        new Error("composition websocket closed"),
      );
      await vi.advanceTimersByTimeAsync(250);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.compositionPublishers).toHaveLength(2);
      expect(mocks.compositionPublishers[1]!.options).toMatchObject({
        authToken: "refreshed-composition-token",
      });
      expect(mocks.peers).toHaveLength(1);
      expect(mocks.composition.publish.mock.calls.at(-1)).toEqual(
        latestPublication,
      );
      mocks.compositionPublishers[0]!.onDisconnected(
        new Error("late close from replaced composition peer"),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.compositionPublishers).toHaveLength(2);

      mocks.compositionPublishers[1]!.onDisconnected(
        new Error("composition websocket closed again"),
      );
      ready.runtime.disconnect();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.compositionPublishers).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      ready.runtime.disconnect();
    }
  });
});

it("gives primary reconnection priority over a pending composition retry", async () => {
  vi.useFakeTimers();
  try {
    const connectPrimary = vi.fn();
    const reconnectComposition = vi.fn();
    const connecting = vi.fn();
    const reconnect = new NativeLsdpReconnect({
      active: () => true,
      connectPrimary,
      reconnectComposition,
      connecting,
    });

    reconnect.schedule("composition");
    reconnect.schedule("primary");
    await vi.advanceTimersByTimeAsync(500);

    expect(connecting).toHaveBeenCalledOnce();
    expect(connectPrimary).toHaveBeenCalledOnce();
    expect(reconnectComposition).not.toHaveBeenCalled();
    reconnect.clear();
  } finally {
    vi.useRealTimers();
  }
});

it("does not reset composition backoff when peer construction returns", async () => {
  vi.useFakeTimers();
  try {
    const start = vi.fn();
    const reconnect: NativeLsdpReconnect = new NativeLsdpReconnect({
      active: () => true,
      connectPrimary: vi.fn(),
      reconnectComposition: () =>
        void reconnect.recoverComposition("token", start, vi.fn()),
      connecting: vi.fn(),
    });

    reconnect.schedule("composition");
    await vi.advanceTimersByTimeAsync(250);
    expect(start).toHaveBeenCalledOnce();

    // A returned start call has not completed a handshake or publication.
    reconnect.schedule("composition");
    await vi.advanceTimersByTimeAsync(250);
    expect(start).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(250);
    expect(start).toHaveBeenCalledTimes(2);
    reconnect.clear();
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a composition token fetch superseded by primary token refresh", async () => {
  let resolveToken!: (token: string) => void;
  const token: MountOptions["token"] = {
    fetch: () => new Promise((resolve) => (resolveToken = resolve)),
  };
  const starts: string[] = [];
  const reconnect = new NativeLsdpReconnect({
    active: () => true,
    connectPrimary: vi.fn(),
    reconnectComposition: vi.fn(),
    connecting: vi.fn(),
  });

  const attempt = reconnect.recoverComposition(
    token,
    (value) => starts.push(value),
    vi.fn(),
  );
  reconnect.schedule("primary");
  resolveToken("stale-composition-token");
  await attempt;

  expect(starts).toEqual([]);
  reconnect.clear();
});

it("does not admit a token fetch from a stopped composition lifetime", async () => {
  let active = true;
  let resolveOld!: (token: string) => void;
  const oldToken: MountOptions["token"] = {
    fetch: () => new Promise((resolve) => (resolveOld = resolve)),
  };
  const starts: string[] = [];
  const report = vi.fn();
  const reconnect = new NativeLsdpReconnect({
    active: () => active,
    connectPrimary: vi.fn(),
    reconnectComposition: vi.fn(),
    connecting: vi.fn(),
  });

  const oldAttempt = reconnect.recoverComposition(
    oldToken,
    (token) => starts.push(token),
    report,
  );
  active = false;
  reconnect.clear();
  active = true;
  await reconnect.recoverComposition(
    { fetch: async () => "current-token" },
    (token) => starts.push(token),
    report,
  );
  resolveOld("stale-token");
  await oldAttempt;

  expect(starts).toEqual(["current-token"]);
  expect(report).not.toHaveBeenCalled();
  reconnect.clear();
});
