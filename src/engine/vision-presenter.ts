import { VISION_COMPLETED_REQUESTS } from "./vision-contracts";
import { loadHostFonts, visionFontResponse } from "./vision-font-assets";
import type {
  VisionLiveMediaSource,
  VisionMediaSubmitReceipt,
  VisionPresenterMessage,
  VisionSceneHandle,
  VisionRenderPackage,
} from "./vision-contracts";
export type {
  VisionLiveMediaSource,
  VisionMediaSubmitReceipt,
  VisionPresenterMessage,
  VisionSceneHandle,
  VisionRenderPackage,
} from "./vision-contracts";
import { VerifiedFont } from "../scenes/verified-font";
import type { SceneRenderDelivery } from "../scenes/types";
import { visionImageValue, visionTextPatch } from "../scenes/native-document";
import { CanvasPresentation } from "./canvas-presentation";
import { VisionFrames } from "./vision-frames";
import { VisionMediaBridge, VisionMediaSources } from "./vision-media-bridge";
import {
  acceptVisionCompositionFrame,
  type VisionCompositionFrame,
} from "./vision-composition-frame";

interface PresenterEvent {
  data: VisionPresenterMessage;
}

interface VisionPresenter {
  addEventListener(
    type: "message",
    listener: (event: PresenterEvent) => void,
  ): void;
  postMessage(request: Record<string, unknown>): void;
  terminate(): void;
  flush(): Promise<void>;
}

type PresenterModule = {
  createMainThreadPresenter: (
    canvas: HTMLCanvasElement,
    dependencies: Record<string, unknown>,
  ) => VisionPresenter;
};

interface PersistentVisionSession {
  layer: HTMLDivElement;
  canvas: HTMLCanvasElement;
  presentation: CanvasPresentation;
  presenter: VisionPresenter | null;
  bridge: VisionMediaBridge;
  lifetime: PersistentVisionLifetime;
  sequence: number;
  owner: object;
  closed: boolean;
  engineReady: boolean;
  fontsReady: boolean;
  nativeComposition?: boolean;
  admittedFonts: Set<string>;
  onMessage: (event: PresenterEvent) => void;
  retire: (error: Error) => void;
}

interface PersistentVisionLifetime {
  closed: boolean;
  signal: AbortSignal;
  close(error: Error): void;
}

const visionSessions = new WeakMap<HTMLElement, PersistentVisionSession>();
const sceneLoads = new WeakMap<HTMLElement, Promise<void>>();
const visionLifetimes = new WeakMap<HTMLElement, PersistentVisionLifetime>();

/** Read the cap from Vision's already initialized, session-owned WebGL2 context. */
export function visionMaxTextureSize(target: HTMLElement): number {
  const session = visionSessions.get(target);
  if (!session || session.closed || !session.presenter || !session.fontsReady)
    throw new Error("NATIVE_COMPOSITION_VISION_SESSION_UNAVAILABLE");
  // The presenter initializes this exact canvas as WebGL2 before the session is
  // marked ready. getContext therefore returns the owned context; this does not
  // create an auxiliary canvas or GPU context.
  const context = session.canvas.getContext("webgl2");
  if (!context || context.isContextLost())
    throw new Error("NATIVE_COMPOSITION_WEBGL2_CONTEXT_UNAVAILABLE");
  const limit = context.getParameter(context.MAX_TEXTURE_SIZE);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("NATIVE_COMPOSITION_TEXTURE_LIMIT_UNAVAILABLE");
  return limit;
}

function disconnectedError(): Error {
  const error = new Error("Vision host session disconnected.");
  error.name = "AbortError";
  return error;
}

function lifetimeFor(target: HTMLElement): PersistentVisionLifetime {
  const current = visionLifetimes.get(target);
  if (current && !current.closed) return current;

  const controller = new AbortController();
  const lifetime: PersistentVisionLifetime = {
    closed: false,
    signal: controller.signal,
    close(error) {
      if (lifetime.closed) return;
      lifetime.closed = true;
      controller.abort(error);
    },
  };
  visionLifetimes.set(target, lifetime);
  return lifetime;
}

function isCurrentLifetime(
  target: HTMLElement,
  lifetime: PersistentVisionLifetime,
): boolean {
  return !lifetime.closed && visionLifetimes.get(target) === lifetime;
}

function assertCurrentLifetime(
  target: HTMLElement,
  lifetime: PersistentVisionLifetime,
): void {
  if (!isCurrentLifetime(target, lifetime)) throw disconnectedError();
}

function awaitLifetime<T>(
  target: HTMLElement,
  lifetime: PersistentVisionLifetime | null,
  pending: Promise<T>,
): Promise<T> {
  if (!lifetime) return pending;
  if (!isCurrentLifetime(target, lifetime)) {
    void pending.catch(() => {});
    return Promise.reject(disconnectedError());
  }
  return new Promise<T>((resolve, reject) => {
    let context: {
      target: HTMLElement;
      lifetime: PersistentVisionLifetime;
    } | null = { target, lifetime };
    let signal: AbortSignal | null = lifetime.signal;
    let resolveResult: ((value: T) => void) | null = resolve;
    let rejectResult: ((reason?: unknown) => void) | null = reject;
    let onAbort: (() => void) | null = null;
    const cleanup = (): void => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      signal = null;
      onAbort = null;
      context = null;
    };
    const finish = (succeeded: boolean, value: unknown): void => {
      if (!context) return;
      const resolveCurrent = resolveResult;
      const rejectCurrent = rejectResult;
      resolveResult = null;
      rejectResult = null;
      cleanup();
      if (succeeded) resolveCurrent?.(value as T);
      else rejectCurrent?.(value);
    };
    onAbort = () => finish(false, signal?.reason ?? disconnectedError());
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        const active = context;
        if (!active) return;
        try {
          assertCurrentLifetime(active.target, active.lifetime);
          finish(true, value);
        } catch (error) {
          finish(false, error);
        }
      },
      (error: unknown) => finish(false, error),
    );
    if (signal.aborted) onAbort();
  });
}

function createSessionPresenter(
  module: PresenterModule,
  canvas: HTMLCanvasElement,
  bridge: VisionMediaBridge,
): VisionPresenter {
  return module.createMainThreadPresenter(canvas, {
    loadWasm: async () =>
      bridge.module(
        await import(
          /* @vite-ignore */ new URL(
            "vision/pkg/lumencast_vision_web.js",
            document.baseURI,
          ).href
        ),
      ),
  });
}
function listenToSession(session: PersistentVisionSession): void {
  session.presenter!.addEventListener("message", (event) =>
    session.onMessage(event),
  );
}

/** End the host session; a scene switch must never call this. */
export function disconnectVisionSession(target: HTMLElement): void {
  delete target.dataset.solarEngineReady;
  visionLifetimes.get(target)?.close(disconnectedError());
  const session = visionSessions.get(target);
  if (!session) return;
  visionSessions.delete(target);
  session.retire(disconnectedError());
}

/** Mount one revision-pinned LSMLZ scene into Vision and wait for its first frame. */
export async function mountVisionScene(
  target: HTMLElement,
  delivery: SceneRenderDelivery,
  initialState: Record<string, unknown>,
  onMediaSources: (sources: readonly VisionLiveMediaSource[]) => void,
  onError: (error: unknown) => void,
  renderPackage?: VisionRenderPackage,
  persistent = false,
): Promise<VisionSceneHandle> {
  if (!persistent) {
    const scene = await mountVisionSceneNow(
      target,
      delivery,
      initialState,
      onMediaSources,
      onError,
      renderPackage,
    );
    if (!scene) throw new Error("Vision scene was not loaded.");
    return scene;
  }
  const lifetime = lifetimeFor(target);
  const preceding = sceneLoads.get(target) ?? Promise.resolve();
  const pending = preceding.then(() => {
    assertCurrentLifetime(target, lifetime);
    return mountVisionSceneNow(
      target,
      delivery,
      initialState,
      onMediaSources,
      onError,
      renderPackage,
      true,
      lifetime,
    );
  });
  const load = awaitLifetime(target, lifetime, pending);
  sceneLoads.set(
    target,
    load.then(
      () => {},
      () => {},
    ),
  );
  const scene = await load;
  if (!scene) throw new Error("Vision scene was not loaded.");
  return scene;
}

/** Start an empty persistent engine without retaining or displaying a scene. */
export async function prewarmVisionSession(
  target: HTMLElement,
  onError: (error: unknown) => void,
  installationFonts?: () => AsyncIterable<Uint8Array[]>,
): Promise<void> {
  const lifetime = lifetimeFor(target);
  const preceding = sceneLoads.get(target) ?? Promise.resolve();
  const load = awaitLifetime(
    target,
    lifetime,
    preceding.then(() => {
      assertCurrentLifetime(target, lifetime);
      const session = visionSessions.get(target);
      if (
        session?.lifetime === lifetime &&
        !session.closed &&
        session.fontsReady
      )
        return;
      return mountVisionSceneNow(
        target,
        null,
        {},
        () => {},
        onError,
        undefined,
        true,
        lifetime,
        installationFonts,
      ).then(() => {});
    }),
  );
  sceneLoads.set(
    target,
    load.then(
      () => {},
      () => {},
    ),
  );
  await load;
  assertCurrentLifetime(target, lifetime);
  target.dataset.solarEngineReady = "true";
}

/** Mount one revision-pinned LSMLZ scene into Vision and wait for its first frame. */
async function mountVisionSceneNow(
  target: HTMLElement,
  delivery: SceneRenderDelivery | null,
  initialState: Record<string, unknown>,
  onMediaSources: (sources: readonly VisionLiveMediaSource[]) => void,
  onError: (error: unknown) => void,
  renderPackage?: VisionRenderPackage,
  persistent = false,
  lifetime: PersistentVisionLifetime | null = null,
  installationFonts?: () => AsyncIterable<Uint8Array[]>,
): Promise<VisionSceneHandle | null> {
  if (renderPackage?.nativeComposition && !persistent)
    throw new Error("VISION_NATIVE_COMPOSITION_REQUIRES_PERSISTENT_ENGINE");
  if (persistent) {
    if (!lifetime) throw new Error("Persistent Vision lifetime is missing.");
    assertCurrentLifetime(target, lifetime);
  }
  if (
    (!delivery && !persistent) ||
    (delivery && delivery.format !== "lsmlz" && !renderPackage)
  ) {
    throw new Error("Vision scene delivery must be an LSMLZ archive.");
  }

  const currentSession = persistent ? visionSessions.get(target) : undefined;
  const existing =
    currentSession?.lifetime === lifetime && !currentSession.closed
      ? currentSession
      : undefined;
  const owner = {};
  const layer = existing?.layer ?? document.createElement("div");
  if (delivery) layer.dataset.solarVisionScene = delivery.sceneVersion;
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    // The persistent front surface already contains the active frame.
    // Structural/effect loads must not hide it while awaiting the next frame.
    ...(!existing ? { opacity: "0" } : {}),
    pointerEvents: "none",
  });
  if (getComputedStyle(target).position === "static") {
    target.style.position = "relative";
  }

  const canvas = existing?.canvas ?? document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    display: "block",
    width: "100%",
    height: "100%",
    opacity: "0",
    position: "absolute",
    inset: "0",
  });
  const presentation = existing?.presentation ?? new CanvasPresentation(canvas);
  if (canvas.parentElement !== layer) layer.append(canvas);
  if (presentation.canvas.parentElement !== layer)
    layer.append(presentation.canvas);
  if (layer.parentElement !== target) target.append(layer);

  let presenter: VisionPresenter | null = existing?.presenter ?? null;
  let sequence = 0;
  let disposed = false;
  let width =
    renderPackage?.surface?.width ?? Math.max(1, target.clientWidth || 1920);
  let height =
    renderPackage?.surface?.height ?? Math.max(1, target.clientHeight || 1080);
  if (renderPackage?.surface)
    Object.assign(layer.style, { width: `${width}px`, height: `${height}px` });
  const mediaSources = new VisionMediaSources(
    renderPackage?.nativeComposition === true,
    onMediaSources,
  );
  let resizeObserver: ResizeObserver | null = null;
  let removeWindowResize: (() => void) | null = null;
  let termination: Promise<void> | null = null;
  const mediaBridge = existing?.bridge ?? new VisionMediaBridge();
  let frameQueue: VisionFrames | null = null;
  const waiters = new Map<
    number,
    {
      resolve: (message: VisionPresenterMessage) => void;
      reject: (error: Error) => void;
      started?: number;
      stage?: string;
    }
  >();
  const session: PersistentVisionSession | null = persistent
    ? (existing ?? {
        layer,
        canvas,
        presentation,
        presenter: null,
        bridge: mediaBridge,
        lifetime: lifetime!,
        sequence: 0,
        owner,
        closed: false,
        engineReady: false,
        fontsReady: false,
        admittedFonts: new Set<string>(),
        onMessage: () => {},
        retire: () => {},
      })
    : null;
  if (session) {
    session.owner = owner;
    session.retire = (error) => {
      if (session.closed) return;
      session.closed = true;
      session.onMessage = () => {};
      try {
        frameQueue?.close();
      } catch {
        // Host teardown must still release the renderer and pending callers.
      }
      resizeObserver?.disconnect();
      removeWindowResize?.();
      const retiringPresenter = session.presenter ?? presenter;
      session.presenter = null;
      presenter = null;
      try {
        retiringPresenter?.terminate();
      } finally {
        layer.remove();
        for (const waiter of waiters.values()) waiter.reject(error);
        waiters.clear();
      }
    };
    visionSessions.set(target, session);
  }

  const presentError = (message: VisionPresenterMessage): Error => {
    const error = new Error(
      `Vision ${message.phase ?? "presenter"}: ${message.message ?? "render failed"}`,
    );
    Object.assign(error, { phase: message.phase });
    return error;
  };
  let compositionFrame: VisionCompositionFrame | null = null;
  const onMessage = (event: PresenterEvent): void => {
    if (
      disposed ||
      session?.closed ||
      (lifetime && !isCurrentLifetime(target, lifetime))
    )
      return;
    const message = event.data;
    if (message.mediaSources)
      mediaSources.update(message.mediaSources, message.type === "error");
    if (message.type === "error") {
      const error = presentError(message);
      let rejectedRequest = false;
      if (message.seq !== undefined) {
        const waiter = waiters.get(message.seq);
        if (waiter) {
          waiters.delete(message.seq);
          waiter.reject(error);
          rejectedRequest = true;
        }
      }
      if (!rejectedRequest) onError(error);
      return;
    }
    if (message.type === "frame-submitted") {
      try {
        let acceptedComposition: VisionCompositionFrame | null = null;
        if (renderPackage?.nativeComposition) {
          acceptedComposition = acceptVisionCompositionFrame(
            message.composition,
            {
              sceneId: delivery!.sceneId,
              sceneVersion: renderPackage.sceneVersion,
              width,
              height,
            },
            compositionFrame,
          );
          if (
            canvas.width !== acceptedComposition.canvasSize[0] ||
            canvas.height !== acceptedComposition.canvasSize[1]
          )
            throw new Error("VISION_NATIVE_COMPOSITION_CANVAS_MISMATCH");
        }
        presentation.submit();
        if (acceptedComposition)
          Object.assign(layer.style, {
            width: `${canvas.width}px`,
            height: `${canvas.height}px`,
          });
        compositionFrame = acceptedComposition;
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        const waiter =
          message.seq === undefined ? null : waiters.get(message.seq);
        if (message.seq !== undefined) waiters.delete(message.seq);
        if (waiter) waiter.reject(failure);
        else onError(failure);
        return;
      }
      mediaSources.accept(compositionFrame);
    }
    if (
      !VISION_COMPLETED_REQUESTS.has(message.type) ||
      message.seq === undefined
    )
      return;
    const waiter = waiters.get(message.seq);
    if (waiter) {
      waiters.delete(message.seq);
      if (waiter.started !== undefined) {
        if (performance.getEntriesByName("solar:vision-stage").length >= 64)
          performance.clearMeasures("solar:vision-stage");
        performance.measure("solar:vision-stage", {
          start: waiter.started,
          detail: { stage: waiter.stage, sceneId: delivery?.sceneId },
        });
      }
      waiter.resolve(message);
    }
  };

  const requestFrame = (
    request: Record<string, unknown>,
  ): Promise<VisionPresenterMessage> => {
    if (
      !presenter ||
      disposed ||
      (lifetime && !isCurrentLifetime(target, lifetime)) ||
      (session && (session.closed || session.owner !== owner))
    )
      return Promise.reject(new Error("Vision scene is disconnected."));
    const seq = session ? ++session.sequence : ++sequence;
    let timeout!: ReturnType<typeof setTimeout>;
    const response = new Promise<VisionPresenterMessage>((resolve, reject) => {
      const measured = ["init-empty", "preload-fonts", "load"].includes(
        String(request.type),
      );
      waiters.set(seq, {
        resolve,
        reject,
        ...(measured
          ? { started: performance.now(), stage: String(request.type) }
          : {}),
      });
      presenter!.postMessage({ ...request, seq });
      if (request.type === "init-empty")
        timeout = setTimeout(() => {
          const error = new Error("VISION_EMPTY_ENGINE_INIT_TIMEOUT");
          reject(error);
          onError(error);
        }, 30_000);
    });
    if (request.type === "init-empty")
      return response.finally(() => clearTimeout(timeout));
    return response;
  };

  try {
    const presenterUrl = new URL(
      "vision/ui/mainpresenter.mjs",
      document.baseURI,
    );
    const presenterModule = (await awaitLifetime(
      target,
      lifetime,
      import(/* @vite-ignore */ presenterUrl.href),
    )) as PresenterModule;
    if (!presenter)
      presenter = persistent
        ? createSessionPresenter(presenterModule, canvas, mediaBridge)
        : presenterModule.createMainThreadPresenter(canvas, {
            fetch: async (
              input: RequestInfo | URL,
              init?: RequestInit,
            ): Promise<Response> => {
              if (String(input) === "/scene") {
                return new Response(
                  new Uint8Array(renderPackage?.data ?? delivery!.data),
                  {
                    status: 200,
                    headers: { "content-type": "application/zip" },
                  },
                );
              }
              const fontResponse = await visionFontResponse(
                String(input),
                renderPackage?.hostFonts ?? [],
              );
              if (fontResponse) return fontResponse;
              return fetch(input, init);
            },
            loadWasm: async () =>
              mediaBridge.module(
                await import(
                  /* @vite-ignore */ new URL(
                    "vision/pkg/lumencast_vision_web.js",
                    document.baseURI,
                  ).href
                ),
              ),
          });
    if (session?.closed) {
      presenter.terminate();
      throw new Error("Vision host session disconnected.");
    }
    if (session) {
      session.onMessage = onMessage;
      if (!session.presenter) {
        session.presenter = presenter;
        listenToSession(session);
      }
    } else presenter.addEventListener("message", onMessage);

    if (!existing) {
      const initialized = await requestFrame({
        type: persistent ? "init-empty" : "init",
        canvas,
        width,
        height,
        sentAt: performance.timeOrigin + performance.now(),
      });
      if (session) {
        if (initialized.type !== "engine-ready")
          throw new Error("VISION_EMPTY_ENGINE_NOT_READY");
        session.engineReady = true;
      }
    }
    const admitFonts = async (
      fonts: Array<Uint8Array | VerifiedFont>,
    ): Promise<void> => {
      if (!session) return;
      // Native WebCrypto avoids WASM SHA compression on every switch. Only
      // digests acknowledged by Rust belong to this engine's font bank.
      const entries = await awaitLifetime(
        target,
        lifetime,
        Promise.all(
          fonts.map((font) =>
            VerifiedFont.isVerified(font) ? font : VerifiedFont.admit(font),
          ),
        ),
      );
      const pending = new Map(
        entries
          .filter((entry) => !session.admittedFonts.has(entry.digest))
          .map((entry) => [entry.digest, entry]),
      );
      if (!pending.size) return;
      let batch = new Map<string, Uint8Array>();
      let batchBytes = 0;
      const submit = async (): Promise<void> => {
        if (!batch.size) return;
        await requestFrame({
          type: "preload-fonts",
          fonts: [...batch.values()],
        });
        for (const digest of batch.keys()) session.admittedFonts.add(digest);
        batch = new Map();
        batchBytes = 0;
      };
      for (const [digest, font] of pending) {
        const bytes = font.copy();
        if (bytes.length > 64 * 1024 * 1024)
          throw new Error("Font preload exceeds byte limit.");
        if (batch.size === 64 || batchBytes + bytes.length > 64 * 1024 * 1024)
          await submit();
        batch.set(digest, bytes);
        batchBytes += bytes.length;
      }
      await submit();
    };
    if (session && !session.fontsReady) {
      const catalog = renderPackage?.installationFonts ?? installationFonts;
      if (catalog) {
        const iterator = catalog()[Symbol.asyncIterator]();
        try {
          while (true) {
            const step = await awaitLifetime(
              target,
              lifetime,
              Promise.resolve(iterator.next()),
            );
            if (step.done) break;
            await admitFonts(step.value);
          }
        } finally {
          if (lifetime?.closed && iterator.return) {
            void Promise.resolve(iterator.return()).catch(() => {});
          }
        }
      } else {
        await admitFonts(
          await awaitLifetime(target, lifetime, loadHostFonts()),
        );
      }
      session.fontsReady = true;
    }
    if (!delivery) return null;
    if (persistent) {
      await admitFonts(renderPackage?.hostFonts ?? []);
      for (const digest of renderPackage?.requiredFontDigests ?? [])
        if (!session?.admittedFonts.has(digest))
          throw new Error(`SOLAR_AUTHORING_FONT_NOT_ADMITTED: ${digest}`);
      if (renderPackage?.nativeComposition || session?.nativeComposition) {
        const enabled = renderPackage?.nativeComposition === true;
        const mode = await requestFrame({
          type: "native-composition-mode",
          enabled,
        });
        if (
          mode.type !== "native-composition-mode-set" ||
          mode.enabled !== enabled
        )
          throw new Error("VISION_NATIVE_COMPOSITION_MODE_REFUSED");
        if (session) session.nativeComposition = enabled;
      }
      await requestFrame({
        type: "load",
        ...(renderPackage?.assets ? { assets: renderPackage.assets } : {}),
        packageBytes: new Uint8Array(renderPackage?.data ?? delivery.data),
        ...(renderPackage?.instances?.length
          ? { instances: renderPackage.instances }
          : {}),
        fonts: [],
        sentAt: performance.timeOrigin + performance.now(),
      });
    }
    const filterState = renderPackage?.lsmlDefaults
      ? (state: Record<string, unknown>) =>
          Object.fromEntries(
            Object.entries(state).filter(
              ([path]) => !path.startsWith("__cam."),
            ),
          )
      : visibleState;
    const projectState = (
      state: Record<string, unknown>,
    ): Record<string, unknown> => {
      const result = visionTextPatch(
        filterState(state),
        renderPackage?.textBindings ?? {},
      );
      for (const [path, aliases] of Object.entries(
        renderPackage?.geometryBindings ?? {},
      )) {
        if (Object.hasOwn(state, path)) {
          const value = state[path];
          if (
            !Array.isArray(value) ||
            value.length !== 2 ||
            value.some((v) => typeof v !== "number" || !Number.isFinite(v))
          )
            throw new Error(`Invalid editable position: ${path}`);
          result[aliases[0]] = value[0];
          result[aliases[1]] = value[1];
        }
      }
      for (const [alias, path] of Object.entries(
        renderPackage?.animationBindings ?? {},
      )) {
        if (Object.hasOwn(state, path)) result[alias] = state[path];
      }
      for (const [path, alias] of Object.entries(
        renderPackage?.imageBindings ?? {},
      )) {
        if (Object.hasOwn(state, path)) {
          const value = state[path];
          result[alias] = visionImageValue(
            value,
            renderPackage?.imageAssets ?? {},
          );
        }
      }
      return result;
    };
    const snapshot = projectState(initialState);
    if (Object.keys(snapshot).length > 0) {
      await requestFrame({
        type: "patch",
        patchJson: JSON.stringify(snapshot),
      });
    }
    if (disposed || session?.closed)
      throw new Error("Vision scene was disconnected during initialization.");
    frameQueue = new VisionFrames(async (frame) => {
      await presenter!.flush();
      if (disposed) throw new Error("Vision scene is disconnected.");
      if (Object.keys(frame.patch).length > 0) {
        // Upload camera pixels before the state patch's one real GPU render.
        mediaBridge.upload(frame.frames);
        const acknowledgement = await requestFrame({
          type: "patch",
          patchJson: JSON.stringify(frame.patch),
          ...(frame.images ? { images: frame.images } : {}),
        });
        return mediaSubmitReceipt(acknowledgement);
      } else if (frame.frames.length > 0) {
        const acknowledgement = await requestFrame({
          type: "media-frames",
          frames: frame.frames,
        });
        return mediaSubmitReceipt(acknowledgement);
      }
      return null;
    });
    const updateSize = (nextWidth: number, nextHeight: number): void => {
      const boundedWidth = Math.round(nextWidth);
      const boundedHeight = Math.round(nextHeight);
      if (
        boundedWidth < 1 ||
        boundedHeight < 1 ||
        (boundedWidth === width && boundedHeight === height)
      )
        return;
      width = boundedWidth;
      height = boundedHeight;
      void requestFrame({ type: "resize", width, height }).catch(onError);
    };
    if (renderPackage?.surface) {
      // Pulsar samples fixed pixel bands; a stale browser viewport must not stretch them.
    } else if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries.at(-1);
        if (entry)
          updateSize(entry.contentRect.width, entry.contentRect.height);
      });
      resizeObserver.observe(target);
    } else {
      const onWindowResize = (): void =>
        updateSize(target.clientWidth, target.clientHeight);
      window.addEventListener("resize", onWindowResize);
      removeWindowResize = () =>
        window.removeEventListener("resize", onWindowResize);
    }
    if (!renderPackage?.surface)
      updateSize(target.clientWidth, target.clientHeight);
    const handle: VisionSceneHandle = {
      sceneId: delivery.sceneId,
      sceneVersion: renderPackage?.sceneVersion ?? delivery.sceneVersion,
      get compositionFrame() {
        return disposed ||
          (session && (session.closed || session.owner !== owner))
          ? null
          : compositionFrame;
      },
      get mediaSources() {
        return mediaSources.current;
      },
      canApplyPatch: (patch) =>
        Boolean(renderPackage?.resolveImages) ||
        Object.keys(renderPackage?.imageBindings ?? {}).every((path) => {
          const value = patch[path];
          return (
            !Object.hasOwn(patch, path) ||
            visionImageValue(value, renderPackage?.imageAssets ?? {}) ===
              renderPackage?.imageValues?.[path]
          );
        }),
      applyPatch: async (patch) => {
        const filtered = projectState(patch);
        const images = await renderPackage?.resolveImages?.(patch);
        try {
          for (const [path, value] of Object.entries(images?.values ?? {}))
            filtered[renderPackage!.imageBindings![path]!] = value;
          if (Object.keys(filtered).length > 0) {
            await frameQueue!.addPatch(filtered, images?.assets);
          }
        } finally {
          images?.release?.();
        }
      },
      resize: async (nextWidth, nextHeight) => {
        const boundedWidth = Math.max(1, Math.round(nextWidth));
        const boundedHeight = Math.max(1, Math.round(nextHeight));
        if (boundedWidth === width && boundedHeight === height) return;
        width = boundedWidth;
        height = boundedHeight;
        await frameQueue!.flush();
        await requestFrame({ type: "resize", width, height });
      },
      activate: () => {
        if (
          !disposed &&
          (!session ||
            (!session.closed &&
              session.owner === owner &&
              (!lifetime || isCurrentLifetime(target, lifetime))))
        )
          layer.style.opacity = "1";
      },
      deactivate: () => {
        if (
          !disposed &&
          (!session ||
            (!session.closed &&
              session.owner === owner &&
              (!lifetime || isCurrentLifetime(target, lifetime))))
        )
          layer.style.opacity = "0";
      },
      updateMedia: (frames, onSubmission) => {
        if (frames.length === 0) return Promise.resolve();
        return frameQueue!.addMedia(frames, (receipt) => {
          if (receipt) onSubmission?.(receipt);
          else
            onSubmission?.({ frameSubmitted: false, renderSubmitCallMs: null });
        });
      },
      clearMedia: (paths) => {
        // A reused media controller can retire paths from the previous scene.
        // Only textures owned by this accepted scene can be cleared in its engine.
        const current = mediaSources.filterOwned(paths);
        if (current.length === 0) return Promise.resolve();
        return frameQueue!
          .flush()
          .then(() => requestFrame({ type: "media-clear", paths: current }))
          .then(() => undefined);
      },
      flush: () =>
        termination ?? frameQueue!.flush().then(() => presenter?.flush()),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        frameQueue?.close();
        resizeObserver?.disconnect();
        removeWindowResize?.();
        if (!session) {
          presenter?.terminate();
          layer.remove();
        } else if (
          !session.closed &&
          session.owner === owner &&
          (!lifetime || isCurrentLifetime(target, lifetime))
        ) {
          layer.style.opacity = "0";
          const seq = ++session.sequence;
          presenter?.postMessage({ type: "clear-scene", seq });
          session.onMessage = () => {};
        }
        termination = presenter?.flush() ?? Promise.resolve();
        presenter = null;
        for (const waiter of waiters.values())
          waiter.reject(new Error("Vision scene disconnected."));
        waiters.clear();
      },
    };
    if (lifetime) assertCurrentLifetime(target, lifetime);
    return handle;
  } catch (error) {
    resizeObserver?.disconnect();
    removeWindowResize?.();
    if (!session) {
      presenter?.terminate();
      layer.remove();
    } else if (
      session.closed ||
      (lifetime && !isCurrentLifetime(target, lifetime))
    ) {
      session.retire(disconnectedError());
    } else if (!session.engineReady) {
      if (visionSessions.get(target) === session) visionSessions.delete(target);
      session.retire(error instanceof Error ? error : new Error(String(error)));
    } else {
      session.onMessage = () => {};
      presenter?.postMessage({ type: "clear-scene", seq: ++session.sequence });
      // Keep the layer's previous visibility: its front canvas is the last
      // accepted frame. New and prewarmed layers already start hidden.
    }
    throw error;
  }
}

export function activateVisionScene(
  scene: VisionSceneHandle,
  previous?: VisionSceneHandle,
  retainPrevious = false,
): void {
  scene.activate();
  if (previous && previous !== scene) {
    if (retainPrevious) previous.deactivate?.();
    else previous.dispose();
  }
}

export function visibleState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(state).filter(([path]) => !path.startsWith("__")),
  );
}

function mediaSubmitReceipt(
  message: VisionPresenterMessage,
): VisionMediaSubmitReceipt {
  const elapsed = message.timing?.gpuSubmitCallMs;
  return {
    frameSubmitted: message.type === "frame-submitted",
    renderSubmitCallMs:
      typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0
        ? elapsed
        : null,
  };
}
