import { VerifiedFont } from "../scenes/verified-font";
import type { SceneRenderDelivery } from "../scenes/types";
import { visionImageValue, visionTextPatch } from "../scenes/native-document";
import { CanvasPresentation } from "./canvas-presentation";
import { VisionFrames } from "./vision-frames";
import { VisionMediaBridge } from "./vision-media-bridge";

export interface VisionLiveMediaSource {
  path: string;
  type: "capture" | "peer";
  source_kind?: string;
  device_ref?: string;
  slot_ref?: string;
  fit?: "cover" | "contain" | "fill" | string;
  width: number;
  height: number;
}

export interface VisionPresenterMessage {
  type: string;
  seq?: number;
  message?: string;
  phase?: string;
  mediaSources?: VisionLiveMediaSource[];
}

const COMPLETED_REQUESTS = new Set([
  "frame-submitted",
  "engine-ready",
  "fonts-ready",
  "scene-cleared",
  "media-applied",
  "media-cleared",
  "resize-unchanged",
]);

// Published LSML may name the shared editor families without embedding them.
// Admit the licensed host faces once, alongside any scene-owned font assets.
const hostFonts = [
  "geist-latin.woff2",
  "geist-mono-latin.woff2",
  "figtree-variable.ttf",
  "alex-brush-400.woff2",
  "ibm-plex-mono-400.woff2",
  "ibm-plex-mono-500.woff2",
  "ibm-plex-mono-600.woff2",
  "space-grotesk-400.woff2",
  "space-grotesk-500.woff2",
  "space-grotesk-600.woff2",
  "space-grotesk-700.woff2",
];
let hostFontBytes: Promise<Uint8Array[]> | null = null;
function loadHostFonts(): Promise<Uint8Array[]> {
  hostFontBytes ??= Promise.all(
    hostFonts.map(async (path) => {
      const response = await fetch(new URL(`fonts/${path}`, document.baseURI));
      if (!response.ok) throw new Error(`Solar host font unavailable: ${path}`);
      return new Uint8Array(await response.arrayBuffer());
    }),
  ).catch((error) => {
    hostFontBytes = null;
    throw error;
  });
  return hostFontBytes;
}

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

export interface VisionSceneHandle {
  readonly sceneId: string;
  readonly sceneVersion: string;
  readonly mediaSources: readonly VisionLiveMediaSource[];
  applyPatch(patch: Record<string, unknown>): Promise<void>;
  canApplyPatch?(patch: Record<string, unknown>): boolean;
  resize(width: number, height: number): Promise<void>;
  activate(): void;
  deactivate?(): void;
  updateMedia(
    frames: Array<{ path: string; bitmap: ImageBitmap }>,
  ): Promise<void>;
  clearMedia(paths: string[]): Promise<void>;
  dispose(): void;
  /** Drain queued GPU work, including teardown after disposal. */
  flush?(): Promise<void>;
}

type PresenterModule = {
  createMainThreadPresenter: (
    canvas: HTMLCanvasElement,
    dependencies: Record<string, unknown>,
  ) => VisionPresenter;
};

export interface VisionRenderPackage {
  data: Uint8Array;
  assets?: Array<{ path: string; bytes: Uint8Array }>;
  sceneVersion: string;
  /** Native defaults include LSML-owned __lit bindings. Camera control stays separate. */
  lsmlDefaults?: boolean;
  textBindings?: Record<string, string>;
  imageBindings?: Record<string, string>;
  imageAssets?: Record<string, string>;
  imageValues?: Record<string, unknown>;
  animationBindings?: Record<string, string>;
  geometryBindings?: Record<string, [string, string]>;
  hostFonts?: Array<Uint8Array | VerifiedFont>;
  requiredFontDigests?: readonly string[];
  surface?: { width: number; height: number };
  installationFonts?: () => AsyncIterable<Uint8Array[]>;
  resolveImages?: (patch: Record<string, unknown>) => Promise<{
    values: Record<string, unknown>;
    assets: Array<{ path: string; bytes: Uint8Array }>;
  }>;
}

interface PersistentVisionSession {
  layer: HTMLDivElement;
  canvas: HTMLCanvasElement;
  presentation: CanvasPresentation;
  presenter: VisionPresenter | null;
  bridge: VisionMediaBridge;
  sequence: number;
  owner: object;
  closed: boolean;
  fontsReady: boolean;
  admittedFonts: Set<string>;
  onMessage: (event: PresenterEvent) => void;
}
const visionSessions = new WeakMap<HTMLElement, PersistentVisionSession>();
const sceneLoads = new WeakMap<HTMLElement, Promise<void>>();

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
  const session = visionSessions.get(target);
  if (!session) return;
  visionSessions.delete(target);
  session.closed = true;
  session.presenter?.terminate();
  session.layer.remove();
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
  if (!persistent)
    return mountVisionSceneNow(
      target,
      delivery,
      initialState,
      onMediaSources,
      onError,
      renderPackage,
    );
  const preceding = sceneLoads.get(target) ?? Promise.resolve();
  const load = preceding.then(() =>
    mountVisionSceneNow(
      target,
      delivery,
      initialState,
      onMediaSources,
      onError,
      renderPackage,
      true,
    ),
  );
  sceneLoads.set(
    target,
    load.then(
      () => {},
      () => {},
    ),
  );
  return load;
}

/** Mount one revision-pinned LSMLZ scene into Vision and wait for its first frame. */
async function mountVisionSceneNow(
  target: HTMLElement,
  delivery: SceneRenderDelivery,
  initialState: Record<string, unknown>,
  onMediaSources: (sources: readonly VisionLiveMediaSource[]) => void,
  onError: (error: unknown) => void,
  renderPackage?: VisionRenderPackage,
  persistent = false,
): Promise<VisionSceneHandle> {
  if (delivery.format !== "lsmlz" && !renderPackage) {
    throw new Error("Vision scene delivery must be an LSMLZ archive.");
  }

  const existing = persistent ? visionSessions.get(target) : undefined;
  const owner = {};
  const layer = existing?.layer ?? document.createElement("div");
  layer.dataset.solarVisionScene = delivery.sceneVersion;
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
  let mediaSources: readonly VisionLiveMediaSource[] = [];
  let resizeObserver: ResizeObserver | null = null;
  let removeWindowResize: (() => void) | null = null;
  let termination: Promise<void> | null = null;
  const mediaBridge = existing?.bridge ?? new VisionMediaBridge();
  const session: PersistentVisionSession | null = persistent
    ? (existing ?? {
        layer,
        canvas,
        presentation,
        presenter: null,
        bridge: mediaBridge,
        sequence: 0,
        owner,
        closed: false,
        fontsReady: false,
        admittedFonts: new Set<string>(),
        onMessage: () => {},
      })
    : null;
  if (session) {
    session.owner = owner;
    visionSessions.set(target, session);
  }
  let frameQueue: VisionFrames | null = null;
  const waiters = new Map<
    number,
    {
      resolve: () => void;
      reject: (error: Error) => void;
    }
  >();

  const presentError = (message: VisionPresenterMessage): Error => {
    const error = new Error(
      `Vision ${message.phase ?? "presenter"}: ${message.message ?? "render failed"}`,
    );
    Object.assign(error, { phase: message.phase });
    return error;
  };
  const onMessage = (event: PresenterEvent): void => {
    if (disposed) return;
    const message = event.data;
    if (message.mediaSources) {
      mediaSources = message.mediaSources;
      onMediaSources(mediaSources);
    }
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
        presentation.submit();
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
    }
    if (!COMPLETED_REQUESTS.has(message.type) || message.seq === undefined)
      return;
    const waiter = waiters.get(message.seq);
    if (waiter) {
      waiters.delete(message.seq);
      waiter.resolve();
    }
  };

  const requestFrame = (request: Record<string, unknown>): Promise<void> => {
    if (
      !presenter ||
      disposed ||
      (session && (session.closed || session.owner !== owner))
    )
      return Promise.reject(new Error("Vision scene is disconnected."));
    const seq = session ? ++session.sequence : ++sequence;
    return new Promise<void>((resolve, reject) => {
      waiters.set(seq, { resolve, reject });
      presenter!.postMessage({ ...request, seq });
    });
  };

  try {
    const presenterUrl = new URL(
      "vision/ui/mainpresenter.mjs",
      document.baseURI,
    );
    const presenterModule = (await import(
      /* @vite-ignore */ presenterUrl.href
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
                  new Uint8Array(renderPackage?.data ?? delivery.data),
                  {
                    status: 200,
                    headers: { "content-type": "application/zip" },
                  },
                );
              }
              if (String(input) === "/fonts")
                return Response.json(
                  [...hostFonts, ...(renderPackage?.hostFonts ?? [])].map(
                    (_, i) => `/fonts/${i}`,
                  ),
                );
              if (String(input).startsWith("/fonts/")) {
                const index = Number(String(input).slice(7));
                const bytes = Number.isInteger(index)
                  ? [
                      ...(await loadHostFonts()),
                      ...(renderPackage?.hostFonts ?? []).map((font) =>
                        VerifiedFont.isVerified(font) ? font.copy() : font,
                      ),
                    ][index]
                  : undefined;
                return bytes
                  ? new Response(new Uint8Array(bytes))
                  : new Response(null, { status: 404 });
              }
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

    if (!existing)
      await requestFrame({
        type: persistent ? "init-empty" : "init",
        canvas,
        width,
        height,
        sentAt: performance.timeOrigin + performance.now(),
      });
    const admitFonts = async (
      fonts: Array<Uint8Array | VerifiedFont>,
    ): Promise<void> => {
      if (!session) return;
      // Native WebCrypto avoids WASM SHA compression on every switch. Only
      // digests acknowledged by Rust belong to this engine's font bank.
      const entries = await Promise.all(
        fonts.map((font) =>
          VerifiedFont.isVerified(font) ? font : VerifiedFont.admit(font),
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
      if (renderPackage?.installationFonts) {
        for await (const fonts of renderPackage.installationFonts())
          await admitFonts(fonts);
      } else await admitFonts(await loadHostFonts());
      session.fontsReady = true;
    }
    if (persistent) {
      await admitFonts(renderPackage?.hostFonts ?? []);
      for (const digest of renderPackage?.requiredFontDigests ?? [])
        if (!session?.admittedFonts.has(digest))
          throw new Error(`SOLAR_AUTHORING_FONT_NOT_ADMITTED: ${digest}`);
      await requestFrame({
        type: "load",
        ...(renderPackage?.assets ? { assets: renderPackage.assets } : {}),
        packageBytes: new Uint8Array(renderPackage?.data ?? delivery.data),
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
    if (disposed)
      throw new Error("Vision scene was disconnected during initialization.");
    frameQueue = new VisionFrames(async (frame) => {
      await presenter!.flush();
      if (disposed) throw new Error("Vision scene is disconnected.");
      if (Object.keys(frame.patch).length > 0) {
        // Upload camera pixels before the state patch's one real GPU render.
        mediaBridge.upload(frame.frames);
        await requestFrame({
          type: "patch",
          patchJson: JSON.stringify(frame.patch),
          ...(frame.images ? { images: frame.images } : {}),
        });
      } else if (frame.frames.length > 0) {
        await requestFrame({ type: "media-frames", frames: frame.frames });
      }
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
    return {
      sceneId: delivery.sceneId,
      sceneVersion: renderPackage?.sceneVersion ?? delivery.sceneVersion,
      get mediaSources() {
        return mediaSources;
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
        for (const [path, value] of Object.entries(images?.values ?? {}))
          filtered[renderPackage!.imageBindings![path]!] = value;
        if (Object.keys(filtered).length > 0) {
          await frameQueue!.addPatch(filtered, images?.assets);
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
        if (!disposed && (!session || session.owner === owner))
          layer.style.opacity = "1";
      },
      deactivate: () => {
        if (!disposed && (!session || session.owner === owner))
          layer.style.opacity = "0";
      },
      updateMedia: (frames) => {
        if (frames.length === 0) return Promise.resolve();
        return frameQueue!.addMedia(frames);
      },
      clearMedia: (paths) => {
        // A reused media controller can retire paths from the previous scene.
        // Only textures owned by this accepted scene can be cleared in its engine.
        const owned = new Set(mediaSources.map((source) => source.path));
        const current = paths.filter((path) => owned.has(path));
        if (current.length === 0) return Promise.resolve();
        return frameQueue!
          .flush()
          .then(() => requestFrame({ type: "media-clear", paths: current }));
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
        } else if (session.owner === owner) {
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
  } catch (error) {
    resizeObserver?.disconnect();
    removeWindowResize?.();
    if (!session) {
      presenter?.terminate();
      layer.remove();
    } else {
      session.onMessage = () => {};
      presenter?.postMessage({ type: "clear-scene", seq: ++session.sequence });
      layer.style.opacity = "0";
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
