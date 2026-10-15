import type { Operation } from "fast-json-patch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { nativeTreeHash } from "../../src/internal/native-tree";
import { NativeLsdpRuntime } from "../../src/engine/native-lsdp-runtime";
import type { MountOptions } from "../../src/types";
import type { SceneSourceDelivery } from "../../src/scenes/types";
import { nativeManifest } from "../helpers/native-source";

const mocks = vi.hoisted(() => ({
  compositionPublisherOptions: null as unknown,
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
    constructor(options: unknown) {
      mocks.compositionPublisherOptions = options;
    }
    publish(...args: unknown[]) {
      return mocks.composition.publish(...args);
    }
    clear() {
      return mocks.composition.clear();
    }
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

async function setup(initial: unknown) {
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
    mocks.compositionPublisherOptions = null;
  });

  it("publishes the active LSML projection and subsequent scalar state", async () => {
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
      groups: [
        {
          id: "prism.native-composition.root.v1",
          children: [
            { kind: "group", id: "solar.native-composition.authored-root.v1" },
          ],
        },
        {
          id: "solar.native-composition.authored-root.v1",
          children: [
            { kind: "solarBand", band: 0 },
            { kind: "capture", componentId: "camera.main" },
          ],
        },
      ],
      surfaces: [
        {
          band: 0,
          ownerId: "solar.native-composition.authored-root.v1",
          coordinateSpace: "group-local",
          rect: { x: 0, y: 0, width: 640, height: 480 },
        },
      ],
    });
    expect(initialDocument).toEqual(initial);
    expect(initialHash).toBe(nativeTreeHash(initial));
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
    expect(ready.scene.applyPatch).toHaveBeenCalledWith({
      "__lit.text.title": "edited",
    });
    ready.runtime.disconnect();
  });
});
