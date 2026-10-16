import { afterEach, expect, it, vi } from "vitest";
import {
  mountVisionScene,
  disconnectVisionSession,
  prewarmVisionSession,
  visionMaxTextureSize,
} from "../../src/engine/vision-presenter";
import { nativeManifest } from "../helpers/native-source";

const fake = vi.hoisted(() => ({
  heldTypes: new Set<string>(),
  held: [] as Array<{ type: string; deliver: () => void }>,
  listeners: [] as Array<
    | ((event: {
        data: {
          type: string;
          seq: number;
          timing?: Record<string, unknown>;
          phase?: string;
          message?: string;
        };
      }) => void)
    | null
  >,
  created: 0,
  terminated: 0,
  failTerminate: false,
  failLoads: 0,
  requests: [] as string[],
}));

vi.mock("http://localhost:3000/vision/ui/mainpresenter.mjs", () => ({
  createMainThreadPresenter: (canvas: HTMLCanvasElement) => {
    fake.created++;
    let listener:
      | ((event: {
          data: {
            type: string;
            seq: number;
            timing?: Record<string, unknown>;
            phase?: string;
            message?: string;
          };
        }) => void)
      | null = null;
    return {
      addEventListener: (_type: string, next: typeof listener) => {
        listener = next;
        fake.listeners.push(next);
      },
      postMessage: (request: Record<string, unknown>) => {
        canvas.width = 1920;
        canvas.height = 1080;
        const type = String(request.type);
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
                    type === "init-empty" ? "engine-ready" : "frame-submitted",
                  seq: request.seq as number,
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
