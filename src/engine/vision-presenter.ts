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
  "media-applied",
  "media-cleared",
  "resize-unchanged",
]);

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
  sceneVersion: string;
  /** Native defaults include LSML-owned __lit bindings. Camera control stays separate. */
  lsmlDefaults?: boolean;
  textBindings?: Record<string, string>;
  imageBindings?: Record<string, string>;
  imageAssets?: Record<string, string>;
  imageValues?: Record<string, unknown>;
  animationBindings?: Record<string, string>;
  geometryBindings?: string[];
}

/** Mount one revision-pinned LSMLZ scene into Vision and wait for its first frame. */
export async function mountVisionScene(
  target: HTMLElement,
  delivery: SceneRenderDelivery,
  initialState: Record<string, unknown>,
  onMediaSources: (sources: readonly VisionLiveMediaSource[]) => void,
  onError: (error: unknown) => void,
  renderPackage?: VisionRenderPackage,
): Promise<VisionSceneHandle> {
  if (delivery.format !== "lsmlz" && !renderPackage) {
    throw new Error("Vision scene delivery must be an LSMLZ archive.");
  }

  const layer = document.createElement("div");
  layer.dataset.solarVisionScene = delivery.sceneVersion;
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  if (getComputedStyle(target).position === "static") {
    target.style.position = "relative";
  }

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    display: "block",
    width: "100%",
    height: "100%",
    opacity: "0",
    position: "absolute",
    inset: "0",
  });
  const presentation = new CanvasPresentation(canvas);
  layer.append(canvas, presentation.canvas);
  target.append(layer);

  let presenter: VisionPresenter | null = null;
  let sequence = 0;
  let disposed = false;
  let width = Math.max(1, target.clientWidth || 1920);
  let height = Math.max(1, target.clientHeight || 1080);
  let mediaSources: readonly VisionLiveMediaSource[] = [];
  let resizeObserver: ResizeObserver | null = null;
  let removeWindowResize: (() => void) | null = null;
  let termination: Promise<void> | null = null;
  const mediaBridge = new VisionMediaBridge();
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
    if (!presenter || disposed)
      return Promise.reject(new Error("Vision scene is disconnected."));
    const seq = ++sequence;
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
    presenter = presenterModule.createMainThreadPresenter(canvas, {
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
        if (String(input) === "/fonts") return Response.json([]);
        if (String(input).startsWith("/fonts/"))
          return new Response(null, { status: 404 });
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
    presenter.addEventListener("message", onMessage);

    await requestFrame({
      type: "init",
      canvas,
      width,
      height,
      sentAt: performance.timeOrigin + performance.now(),
    });
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
    if (typeof ResizeObserver === "function") {
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
    updateSize(target.clientWidth, target.clientHeight);
    return {
      sceneId: delivery.sceneId,
      sceneVersion: renderPackage?.sceneVersion ?? delivery.sceneVersion,
      get mediaSources() {
        return mediaSources;
      },
      canApplyPatch: (patch) =>
        !(renderPackage?.geometryBindings ?? []).some((path) =>
          Object.hasOwn(patch, path),
        ) &&
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
        if (Object.keys(filtered).length > 0) {
          await frameQueue!.addPatch(filtered);
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
        if (!disposed) layer.style.opacity = "1";
      },
      deactivate: () => {
        if (!disposed) layer.style.opacity = "0";
      },
      updateMedia: (frames) => {
        if (frames.length === 0) return Promise.resolve();
        return frameQueue!.addMedia(frames);
      },
      clearMedia: (paths) => {
        if (paths.length === 0) return Promise.resolve();
        return frameQueue!
          .flush()
          .then(() => requestFrame({ type: "media-clear", paths }));
      },
      flush: () =>
        termination ?? frameQueue!.flush().then(() => presenter?.flush()),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        frameQueue?.close();
        resizeObserver?.disconnect();
        removeWindowResize?.();
        presenter?.terminate();
        termination = presenter?.flush() ?? Promise.resolve();
        presenter = null;
        layer.remove();
        for (const waiter of waiters.values())
          waiter.reject(new Error("Vision scene disconnected."));
        waiters.clear();
      },
    };
  } catch (error) {
    resizeObserver?.disconnect();
    removeWindowResize?.();
    presenter?.terminate();
    layer.remove();
    throw error;
  }
}

export function activateVisionScene(
  scene: VisionSceneHandle,
  previous?: VisionSceneHandle,
): void {
  scene.activate();
  if (previous && previous !== scene) {
    previous.dispose();
  }
}

export function visibleState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(state).filter(([path]) => !path.startsWith("__")),
  );
}
