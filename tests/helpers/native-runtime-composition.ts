import type { Operation } from "fast-json-patch";
import { vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { NativeLsdpRuntime } from "../../src/engine/native-lsdp-runtime";
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

async function setup(
  initial: unknown,
  token: MountOptions["token"] = "",
  selector?: string,
  varyProjection = false,
  initialFailure?: Error,
) {
  const scenes: Array<ReturnType<typeof makeScene>> = [];
  function makeScene(frame: ReturnType<typeof compositionFrame>) {
    return {
      sceneId: frame.sceneId,
      sceneVersion: frame.sceneVersion,
      get compositionFrame() {
        return frame;
      },
      applyPatch: vi.fn(async (patch: Record<string, unknown>) => {
        const x = patch["__solar.animation.camera.x"];
        frame = {
          ...frame,
          pixelRevision: (BigInt(frame.pixelRevision) + 1n).toString(),
          captures: frame.captures.map((capture) => ({
            ...capture,
            localToWorld:
              typeof x === "number"
                ? ([1, 0, 0, 1, x, 30] as [
                    number,
                    number,
                    number,
                    number,
                    number,
                    number,
                  ])
                : capture.localToWorld,
          })),
        };
      }),
      clearMedia: vi.fn(async () => {}),
      canApplyPatch: vi.fn(() => true),
      dispose: vi.fn(),
      mediaSources: [],
      activate: vi.fn(),
      deactivate: vi.fn(),
      feedback: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
    };
  }
  mocks.mount.mockImplementation(async (...args: unknown[]) => {
    const source = args[1] as SceneSourceDelivery;
    const renderPackage = args[5] as { sceneVersion: string };
    const frame = compositionFrame();
    frame.sceneId = source.sceneId;
    frame.sceneVersion = renderPackage.sceneVersion;
    frame.sceneSize = [640, 480];
    frame.sceneScale = [1, 1];
    frame.atlasSize = [640, 480];
    frame.canvasSize = [640, 480];
    frame.owners[0]!.localSize = [640, 480];
    frame.owners[0]!.localToWorld = [1, 0, 0, 1, 0, 0];
    if (varyProjection && scenes.length > 0) frame.owners[0]!.opacity = 0.5;
    frame.captures[0]!.localToWorld = [1, 0, 0, 1, 20, 30];
    frame.surfaces[0]!.sceneRect = [0, 0, 640, 480];
    frame.surfaces[0]!.atlasRect = [0, 0, 640, 480];
    const scene = makeScene(frame);
    scenes.push(scene);
    return scene;
  });
  if (initialFailure) mocks.mount.mockRejectedValueOnce(initialFailure);
  const resource = "solar/lane-a";
  const options: MountOptions = {
    target: documentElement(),
    nativeLSDP: {
      url: "ws://127.0.0.1:4520/lsdp",
      resource,
      selector,
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
  return {
    runtime,
    scene: scenes[0]!,
    scenes,
    receive,
    receiveRaw,
    flush,
    peer,
    context,
    options,
  };
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

export {
  NativeLsdpRuntime,
  mocks,
  setup,
  document,
  origin,
  version,
  change,
  turn,
};
