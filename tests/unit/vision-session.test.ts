import { afterEach, expect, it, vi } from "vitest";
import {
  mountVisionScene,
  disconnectVisionSession,
  prewarmVisionSession,
  visionMaxTextureSize,
} from "../../src/engine/vision-presenter";
import { nativeManifest } from "../helpers/native-source";
import { compositionFrame } from "../helpers/vision-composition-frame";
import { VisionMediaBridge } from "../../src/engine/vision-media-bridge";
import { LiveMediaController } from "../../src/engine/live-media";
import type {
  VisionLiveMediaSource,
  VisionPresenterMessage,
} from "../../src/engine/vision-contracts";

const fake = vi.hoisted(() => ({
  heldTypes: new Set<string>(),
  held: [] as Array<{ type: string; deliver: () => void }>,
  listeners: [] as Array<
    ((event: { data: VisionPresenterMessage }) => void) | null
  >,
  created: 0,
  terminated: 0,
  failTerminate: false,
  failLoads: 0,
  requests: [] as string[],
  composition: null as unknown,
  canvasSizeOverride: null as [number, number] | null,
  refuseNativeMode: false,
}));

vi.mock("http://localhost:3000/vision/ui/mainpresenter.mjs", () => ({
  createMainThreadPresenter: (canvas: HTMLCanvasElement) => {
    fake.created++;
    let nativeComposition = false;
    let listener: ((event: { data: VisionPresenterMessage }) => void) | null =
      null;
    return {
      addEventListener: (_type: string, next: typeof listener) => {
        listener = next;
        fake.listeners.push(next);
      },
      postMessage: (request: Record<string, unknown>) => {
        canvas.width = 1920;
        canvas.height = 1080;
        const type = String(request.type);
        if (type === "native-composition-mode")
          nativeComposition = request.enabled === true;
        const composition = fake.composition as {
          canvasSize?: number[];
        } | null;
        if (nativeComposition && composition?.canvasSize) {
          canvas.width = composition.canvasSize[0]!;
          canvas.height = composition.canvasSize[1]!;
        }
        if (fake.canvasSizeOverride) {
          [canvas.width, canvas.height] = fake.canvasSizeOverride;
        }
        fake.requests.push(type);
        const rejectLoad = type === "load" && fake.failLoads > 0;
        if (rejectLoad) fake.failLoads--;
        const deliver = (): void =>
          listener?.({
            data: rejectLoad
              ? {
                  type: "error",
                  seq: request.seq as number,
                  phase: "load",
                  message: "Malformed Repeat key.",
                }
              : {
                  type:
                    type === "init-empty"
                      ? "engine-ready"
                      : type === "native-composition-mode"
                        ? "native-composition-mode-set"
                        : "frame-submitted",
                  seq: request.seq as number,
                  ...(type === "native-composition-mode"
                    ? {
                        enabled: fake.refuseNativeMode
                          ? false
                          : nativeComposition,
                      }
                    : {}),
                  ...(nativeComposition && type !== "native-composition-mode"
                    ? { composition: fake.composition }
                    : {}),
                  timing: { gpuSubmitCallMs: 2.5 },
                },
          });
        if (fake.heldTypes.has(type)) fake.held.push({ type, deliver });
        else queueMicrotask(deliver);
      },
      flush: async () => {},
      terminate: () => {
        fake.terminated++;
        if (fake.failTerminate) throw new Error("presenter termination failed");
      },
    };
  },
}));

const targets: HTMLElement[] = [];

function setup() {
  document.head.innerHTML = '<base href="http://localhost:3000/">';
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    MAX_TEXTURE_SIZE: 3379,
    getParameter: vi.fn(() => 8192),
    isContextLost: vi.fn(() => false),
  } as unknown as WebGL2RenderingContext);
  const target = document.createElement("div");
  document.body.append(target);
  targets.push(target);
  const delivery = {
    format: "lsmlz" as const,
    data: new Uint8Array([1]),
    revision: 1,
    sourceDigest: "unit-source",
    assets: new Map<string, Uint8Array>(),
    blueManifest: nativeManifest("scene", "v1"),
    sceneId: "scene",
    sceneVersion: "v1",
  };
  const pack = {
    data: delivery.data,
    sceneVersion: "v1",
    surface: { width: 1920, height: 1080 },
    installationFonts: async function* () {},
  };
  return { target, delivery, pack };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  for (const target of targets) disconnectVisionSession(target);
  targets.length = 0;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  fake.heldTypes.clear();
  fake.held.length = 0;
  fake.listeners.length = 0;
  fake.created = 0;
  fake.terminated = 0;
  fake.failTerminate = false;
  fake.failLoads = 0;
  fake.requests.length = 0;
  fake.composition = null;
  fake.canvasSizeOverride = null;
  fake.refuseNativeMode = false;
});

it("prepares the empty engine and installation fonts before any scene, then reuses them", async () => {
  const { target, delivery, pack } = setup();
  let catalogs = 0;
  const fonts = async function* () {
    catalogs++;
    yield [new Uint8Array([1, 2, 3])];
  };
  await prewarmVisionSession(target, vi.fn(), fonts);
  expect(fake.created).toBe(1);
  expect(fake.requests).toEqual(["init-empty", "preload-fonts"]);
  expect(visionMaxTextureSize(target)).toBe(8192);
  expect(target.querySelector("[data-solar-vision-scene]")).toBeNull();
  await prewarmVisionSession(target, vi.fn(), fonts);
  expect(catalogs).toBe(1);
  const scene = await mountVisionScene(
    target,
    delivery,
    {},
    vi.fn(),
    vi.fn(),
    pack,
    true,
  );
  expect(fake.created).toBe(1);
  expect(fake.requests.filter((x) => x === "init-empty")).toHaveLength(1);
  expect(fake.requests.filter((x) => x === "load")).toHaveLength(1);
  scene.dispose();
});

it("enables native atlas mode before loading and returns only the matching submitted frame", async () => {
  const { target, delivery, pack } = setup();
  // This suite mocks the presenter rather than constructing a WASM media engine.
  vi.spyOn(VisionMediaBridge.prototype, "upload").mockImplementation(() => {});
  fake.composition = compositionFrame();
  const scene = await mountVisionScene(
    target,
    delivery,
    {},
    vi.fn(),
    vi.fn(),
    { ...pack, nativeComposition: true, lsmlDefaults: true },
    true,
  );
  expect(fake.requests.indexOf("native-composition-mode")).toBeLessThan(
    fake.requests.indexOf("load"),
  );
  expect(scene.compositionFrame?.canvasSize).toEqual([1922, 1082]);
  expect((target.firstElementChild as HTMLElement).style.width).toBe("1922px");
  expect((target.firstElementChild as HTMLElement).style.height).toBe("1082px");
  const accepted = scene.compositionFrame;
  fake.composition = { ...compositionFrame(), sceneVersion: "stale" };
  await expect(scene.applyPatch({ opacity: 0.5 })).rejects.toThrow(
    "VISION_NATIVE_COMPOSITION_FRAME_INVALID",
  );
  expect(scene.compositionFrame).toBe(accepted);
  expect(fake.created).toBe(1);
});

it("disables atlas output when the same engine later renders a canonical scene", async () => {
  const { target, delivery, pack } = setup();
  fake.composition = compositionFrame();
  const atlas = await mountVisionScene(
    target,
    delivery,
    {},
    vi.fn(),
    vi.fn(),
    { ...pack, nativeComposition: true },
    true,
  );
  const canonical = await mountVisionScene(
    target,
    delivery,
    {},
    vi.fn(),
    vi.fn(),
    pack,
    true,
  );
  expect(fake.created).toBe(1);
  expect(
    fake.requests.filter((type) => type === "native-composition-mode"),
  ).toHaveLength(2);
  expect(canonical.compositionFrame).toBeNull();
  expect(atlas.compositionFrame).toBeNull();
  atlas.dispose();
  canonical.dispose();
});

it.each(["missing receipt", "wrong canvas", "refused mode"])(
  "refuses %s before accepting native atlas output",
  async (reason) => {
    const { target, delivery, pack } = setup();
    fake.composition = reason === "missing receipt" ? null : compositionFrame();
    fake.canvasSizeOverride = reason === "wrong canvas" ? [1920, 1080] : null;
    fake.refuseNativeMode = reason === "refused mode";
    await expect(
      mountVisionScene(
        target,
        delivery,
        {},
        vi.fn(),
        vi.fn(),
        { ...pack, nativeComposition: true },
        true,
      ),
    ).rejects.toThrow(
      reason === "missing receipt"
        ? "VISION_NATIVE_COMPOSITION_FRAME_INVALID"
        : reason === "wrong canvas"
          ? "VISION_NATIVE_COMPOSITION_CANVAS_MISMATCH"
          : "VISION_NATIVE_COMPOSITION_MODE_REFUSED",
    );
    if (reason === "refused mode") expect(fake.requests).not.toContain("load");
  },
);

it("reports an unclaimed Vision context-restoration error to the host", async () => {
  const { target, delivery, pack } = setup();
  const onError = vi.fn();
  await mountVisionScene(target, delivery, {}, vi.fn(), onError, pack, true);

  const listener = fake.listeners[0];
  expect(listener).toBeTypeOf("function");
  listener?.({
    data: {
      type: "error",
      seq: 999,
      phase: "context",
      message: "GPU context unavailable after restoration.",
    },
  });

  const error = onError.mock.calls[0]?.[0] as
    | (Error & { phase?: string })
    | undefined;
  expect(error).toBeInstanceOf(Error);
  expect(error?.message).toBe(
    "Vision context: GPU context unavailable after restoration.",
  );
  expect(error?.phase).toBe("context");
});

it("reports only the presenter's render-call timing with its frame-submitted media receipt", async () => {
  const { target, delivery, pack } = setup();
  const scene = await mountVisionScene(
    target,
    delivery,
    {},
    vi.fn(),
    vi.fn(),
    pack,
    true,
  );
  const onSubmission = vi.fn();
  const update = scene.updateMedia(
    [
      {
        path: "camera.live",
        bitmap: { close: vi.fn() } as unknown as ImageBitmap,
      },
    ],
    onSubmission,
  );

  await scene.flush?.();
  await update;

  expect(fake.requests).toContain("media-frames");
  expect(onSubmission).toHaveBeenCalledWith({
    frameSubmitted: true,
    renderSubmitCallMs: 2.5,
  });
  scene.dispose();
});

it("queues first scene admission behind unfinished installation font preload", async () => {
  const { target, delivery, pack } = setup();
  fake.heldTypes.add("preload-fonts");
  const warm = prewarmVisionSession(target, vi.fn(), async function* () {
    yield [new Uint8Array([4, 5, 6])];
  });
  const scene = mountVisionScene(
    target,
    delivery,
    {},
    vi.fn(),
    vi.fn(),
    pack,
    true,
  );
  await vi.waitFor(() => expect(fake.held).toHaveLength(1));
  expect(fake.requests).toEqual(["init-empty", "preload-fonts"]);
  fake.held.shift()!.deliver();
  await warm;
  (await scene).dispose();
  expect(fake.created).toBe(1);
});

it("aborts an empty engine preload when its host disconnects", async () => {
  const { target } = setup();
  fake.heldTypes.add("init-empty");
  const warm = prewarmVisionSession(target, vi.fn(), async function* () {});
  const rejected = expect(warm).rejects.toThrow(/disconnected/i);
  await vi.waitFor(() => expect(fake.held).toHaveLength(1));
  disconnectVisionSession(target);
  await rejected;
  expect(fake.terminated).toBe(1);
  expect(target.children).toHaveLength(0);
});

it("rejects a queued mount after terminal disconnect and permits an explicit reopen", async () => {
  const { target, delivery, pack } = setup();
  const queued = mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    pack,
    true,
  );

  disconnectVisionSession(target);

  await expect(queued).rejects.toMatchObject({ name: "AbortError" });
  expect(fake.created).toBe(0);
  expect(target.childElementCount).toBe(0);

  const reopened = await mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    pack,
    true,
  );
  expect(fake.created).toBe(1);
  expect(target.firstElementChild).not.toBeNull();
  reopened.dispose();
  disconnectVisionSession(target);
  expect(fake.terminated).toBe(1);
});

it("rejects initialization waiters and ignores presenter callbacks after host retirement", async () => {
  const { target, delivery, pack } = setup();
  fake.heldTypes.add("load");
  const loading = mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    pack,
    true,
  );

  await vi.waitFor(() =>
    expect(fake.held.some(({ type }) => type === "load")).toBe(true),
  );
  expect(fake.created).toBe(1);
  disconnectVisionSession(target);

  await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  expect(fake.terminated).toBe(1);
  expect(target.childElementCount).toBe(0);
  fake.held[0]!.deliver();
  await Promise.resolve();
  expect(fake.terminated).toBe(1);
  expect(target.childElementCount).toBe(0);
});

it("retires a queued old lifetime while fonts are pending and leaves an explicit reopen current", async () => {
  const { target, delivery, pack } = setup();
  const fontGate = deferred<void>();
  let fontReads = 0;
  const heldFonts = async function* () {
    fontReads++;
    await fontGate.promise;
    yield [];
  };
  const oldMount = mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    { ...pack, installationFonts: heldFonts },
    true,
  );
  await vi.waitFor(() => expect(fontReads).toBe(1));
  const oldQueued = mountVisionScene(
    target,
    { ...delivery, sceneVersion: "old-queued" },
    {},
    () => {},
    () => {},
    pack,
    true,
  );

  disconnectVisionSession(target);
  await expect(oldMount).rejects.toMatchObject({ name: "AbortError" });
  await expect(oldQueued).rejects.toMatchObject({ name: "AbortError" });
  expect(fake.created).toBe(1);
  expect(target.childElementCount).toBe(0);

  const reopened = await mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    pack,
    true,
  );
  const currentLayer = target.firstElementChild;
  expect(fake.created).toBe(2);
  fontGate.resolve();
  await Promise.resolve();
  expect(target.firstElementChild).toBe(currentLayer);
  expect(fake.terminated).toBe(1);

  reopened.dispose();
  disconnectVisionSession(target);
  expect(fake.terminated).toBe(2);
});

it("keeps one presenter alive across scene switches and scene-handle disposal", async () => {
  const { target, delivery, pack } = setup();
  const first = await mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    pack,
    true,
  );
  first.activate();
  const layer = target.firstElementChild as HTMLElement;
  const pixels = layer.lastElementChild;

  fake.heldTypes.add("load");
  const loading = mountVisionScene(
    target,
    { ...delivery, sceneVersion: "v2" },
    {},
    () => {},
    () => {},
    { ...pack, sceneVersion: "v2" },
    true,
  );
  await vi.waitFor(() =>
    expect(fake.held.some(({ type }) => type === "load")).toBe(true),
  );
  expect(layer.style.opacity).toBe("1");
  expect(target.firstElementChild).toBe(layer);
  expect(layer.lastElementChild).toBe(pixels);
  fake.held.find(({ type }) => type === "load")!.deliver();

  const second = await loading;
  second.activate();
  first.dispose();
  expect(layer.style.opacity).toBe("1");
  expect(target.firstElementChild).toBe(layer);
  expect(fake.created).toBe(1);
  expect(fake.terminated).toBe(0);

  second.dispose();
  expect(fake.terminated).toBe(0);
  disconnectVisionSession(target);
  expect(fake.terminated).toBe(1);
});

it("keeps the first rejected scene load hidden when no accepted frame exists", async () => {
  const { target, delivery, pack } = setup();
  fake.failLoads = 1;

  await expect(
    mountVisionScene(target, delivery, {}, vi.fn(), vi.fn(), pack, true),
  ).rejects.toThrow("Vision load: Malformed Repeat key.");

  const layer = target.querySelector<HTMLElement>("[data-solar-vision-scene]");
  expect(layer).not.toBeNull();
  expect(layer?.style.opacity).toBe("0");
  expect(fake.requests).toContain("clear-scene");
});

it("retains the last accepted frame through a rejected replacement and permits a valid reload", async () => {
  const { target, delivery, pack } = setup();
  const first = await mountVisionScene(
    target,
    delivery,
    {},
    vi.fn(),
    vi.fn(),
    pack,
    true,
  );
  first.activate();
  const layer = target.querySelector<HTMLElement>("[data-solar-vision-scene]");
  const frontCanvas = layer?.lastElementChild;
  expect(layer?.style.opacity).toBe("1");
  fake.failLoads = 1;

  await expect(
    mountVisionScene(
      target,
      { ...delivery, sceneVersion: "v2" },
      {},
      vi.fn(),
      vi.fn(),
      { ...pack, sceneVersion: "v2" },
      true,
    ),
  ).rejects.toThrow("Vision load: Malformed Repeat key.");

  expect(fake.requests).toContain("clear-scene");
  expect(target.querySelector("[data-solar-vision-scene]")).toBe(layer);
  expect(layer?.style.opacity).toBe("1");
  expect(layer?.lastElementChild).toBe(frontCanvas);

  const recovered = await mountVisionScene(
    target,
    { ...delivery, sceneVersion: "v2" },
    {},
    vi.fn(),
    vi.fn(),
    { ...pack, sceneVersion: "v2" },
    true,
  );
  recovered.activate();

  expect(fake.created).toBe(1);
  expect(fake.requests.filter((type) => type === "load")).toHaveLength(3);
  expect(target.querySelector("[data-solar-vision-scene]")).toBe(layer);
  expect(layer?.style.opacity).toBe("1");
  expect(layer?.lastElementChild).toBe(frontCanvas);
  first.dispose();
  recovered.dispose();
});

it("ignores a retired presenter callback after termination fails and the target reopens", async () => {
  const { target, delivery, pack } = setup();
  const first = await mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    pack,
    true,
  );
  const oldListener = fake.listeners[0]!;
  fake.failTerminate = true;
  expect(() => disconnectVisionSession(target)).toThrow(
    "presenter termination failed",
  );
  fake.failTerminate = false;

  const reopened = await mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    pack,
    true,
  );
  const currentLayer = target.firstElementChild;
  oldListener({ data: { type: "error", seq: 1 } });
  expect(target.firstElementChild).toBe(currentLayer);

  const switched = await mountVisionScene(
    target,
    { ...delivery, sceneVersion: "v2" },
    {},
    () => {},
    () => {},
    { ...pack, sceneVersion: "v2" },
    true,
  );
  expect(fake.created).toBe(2);
  expect(target.firstElementChild).toBe(currentLayer);
  expect(fake.terminated).toBe(1);

  first.dispose();
  reopened.dispose();
  switched.dispose();
  disconnectVisionSession(target);
  expect(fake.terminated).toBe(2);
});

function captureSource(path: string): VisionLiveMediaSource {
  return {
    path,
    type: "capture",
    source_kind: "media.webcam",
    device_ref: "native-camera",
    width: 320,
    height: 180,
  };
}
const peerSource: VisionLiveMediaSource = {
  path: "live/peer",
  type: "peer",
  slot_ref: "peer-slot",
  width: 320,
  height: 180,
};
function emitPresenter(message: VisionPresenterMessage): void {
  const listener = fake.listeners.at(-1);
  if (!listener) throw new Error("missing active presenter listener");
  listener({ data: message });
}

it("delegates native captures only after their matching frame and keeps peer raster inputs", async () => {
  const { target, delivery, pack } = setup();
  // The presenter is mocked; media ownership is checked without a WASM upload engine.
  vi.spyOn(VisionMediaBridge.prototype, "upload").mockImplementation(() => {});
  fake.composition = compositionFrame();
  const resolveCaptureDevice = vi.fn(async () => ({
    deviceId: "must-not-open",
  }));
  const unsubscribePeer = vi.fn();
  const subscribePeerStream = vi.fn(() => unsubscribePeer);
  const controller = new LiveMediaController({
    liveAudio: false,
    resolveCaptureDevice,
    peers: {
      resolvePeerStream: () => null,
      subscribePeerStream,
      dispose: vi.fn(),
    },
    onError: vi.fn(),
    getScene: () => null,
  });
  const onMedia = vi.fn((sources: readonly VisionLiveMediaSource[]) =>
    controller.update(sources),
  );
  const scene = await mountVisionScene(
    target,
    delivery,
    {},
    onMedia,
    vi.fn(),
    { ...pack, nativeComposition: true },
    true,
  );
  emitPresenter({
    type: "patch-applied",
    mediaSources: [captureSource("live/camera"), peerSource],
  });
  expect(onMedia).not.toHaveBeenCalled();
  expect(scene.mediaSources).toEqual([]);
  await scene.applyPatch({ opacity: 0.75 });
  expect(scene.mediaSources).toEqual([peerSource]);
  expect(onMedia).toHaveBeenLastCalledWith([peerSource]);

  const resized = compositionFrame();
  resized.pixelRevision = "5";
  resized.captures[0]!.liveMediaPath = "live/resized-camera";
  fake.composition = resized;
  const calls = onMedia.mock.calls.length;
  emitPresenter({
    type: "patch-applied",
    mediaSources: [captureSource("live/resized-camera"), peerSource],
  });
  expect(onMedia).toHaveBeenCalledTimes(calls);
  await scene.applyPatch({ opacity: 0.5 });
  expect(scene.mediaSources).toEqual([peerSource]);
  expect(onMedia.mock.calls.flatMap(([sources]) => sources)).not.toContainEqual(
    expect.objectContaining({ type: "capture" }),
  );
  emitPresenter({ type: "patch-applied", mediaSources: [] });
  expect(scene.mediaSources).toEqual([peerSource]);
  await scene.applyPatch({ opacity: 0.25 });
  expect(scene.mediaSources).toEqual([]);
  expect(onMedia).toHaveBeenLastCalledWith([]);
  expect(resolveCaptureDevice).not.toHaveBeenCalled();
  expect(subscribePeerStream).toHaveBeenCalledTimes(1);
  expect(unsubscribePeer).toHaveBeenCalledTimes(1);
  controller.dispose();
});

it("retains accepted native media when the next receipt is rejected", async () => {
  const { target, delivery, pack } = setup();
  // The presenter is mocked; media ownership is checked without a WASM upload engine.
  vi.spyOn(VisionMediaBridge.prototype, "upload").mockImplementation(() => {});
  fake.composition = compositionFrame();
  const onMedia = vi.fn();
  const scene = await mountVisionScene(
    target,
    delivery,
    {},
    onMedia,
    vi.fn(),
    { ...pack, nativeComposition: true },
    true,
  );
  emitPresenter({ type: "patch-applied", mediaSources: [peerSource] });
  await scene.applyPatch({ opacity: 0.75 });
  onMedia.mockClear();
  emitPresenter({
    type: "patch-applied",
    mediaSources: [
      captureSource("live/resized-camera"),
      { ...peerSource, path: "live/new-peer" },
    ],
  });
  fake.composition = { ...compositionFrame(), sceneVersion: "stale" };
  await expect(scene.applyPatch({ opacity: 0.5 })).rejects.toThrow(
    "VISION_NATIVE_COMPOSITION_FRAME_INVALID",
  );
  expect(onMedia).not.toHaveBeenCalled();
  expect(scene.mediaSources).toEqual([peerSource]);
});

it("keeps immediate canonical media updates including physical captures", async () => {
  const { target, delivery, pack } = setup();
  const onMedia = vi.fn();
  const scene = await mountVisionScene(
    target,
    delivery,
    {},
    onMedia,
    vi.fn(),
    pack,
    true,
  );
  const sources = [captureSource("live/camera"), peerSource];
  emitPresenter({ type: "patch-applied", mediaSources: sources });
  expect(onMedia).toHaveBeenLastCalledWith(sources);
  expect(scene.mediaSources).toEqual(sources);
});
