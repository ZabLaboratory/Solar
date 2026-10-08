import { CAPTURE_VISUAL_KINDS } from "@lumencast/protocol";
import type { PeerSources } from "../sources/peers";
import type { ResolveCaptureDevice, SolarError } from "../types";
import type { VisionLiveMediaSource, VisionSceneHandle } from "./vision-presenter";

const CAPTURE_KINDS = new Set<string>(CAPTURE_VISUAL_KINDS);

interface LocalStreamEntry {
  refs: number;
  stream: Promise<MediaStream>;
}

export class CaptureStreamPool {
  private readonly entries = new Map<string, LocalStreamEntry>();

  async acquire(key: string, create: () => Promise<MediaStream>): Promise<{
    stream: MediaStream;
    release: () => void;
  }> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { refs: 0, stream: create() };
      this.entries.set(key, entry);
      void entry.stream.catch(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      });
    }
    entry.refs += 1;
    let released = false;
    try {
      const stream = await entry.stream;
      return {
        stream,
        release: () => {
          if (released) return;
          released = true;
          entry!.refs -= 1;
          if (entry!.refs === 0 && this.entries.get(key) === entry) {
            this.entries.delete(key);
            for (const track of stream.getTracks()) track.stop();
          }
        },
      };
    } catch (error) {
      if (!released) {
        released = true;
        entry.refs -= 1;
      }
      throw error;
    }
  }
}

interface MediaSession {
  source: VisionLiveMediaSource;
  signature: string;
  video: HTMLVideoElement;
  frameCanvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  releaseCapture?: () => void;
  unsubscribePeer?: () => void;
  videoFrameRequest?: number;
  fallbackFrameRequest?: number;
  ready: boolean;
  dirty: boolean;
  disposed: boolean;
}

export interface LiveMediaOptions {
  liveAudio: boolean;
  resolveCaptureDevice: ResolveCaptureDevice;
  peers: PeerSources;
  capturePool?: CaptureStreamPool;
  onError: (error: SolarError) => void;
  getScene: () => VisionSceneHandle | null;
}

/** Resolves host-owned camera/peer streams and uploads only changed video frames to Vision. */
export class LiveMediaController {
  private readonly sessions = new Map<string, MediaSession>();
  private readonly capturePool: CaptureStreamPool;
  private disposed = false;
  private framePump: number | null = null;
  private uploadPending = false;
  private paused = false;
  private uploadCompletion: Promise<void> | null = null;

  constructor(private readonly options: LiveMediaOptions) {
    this.capturePool = options.capturePool ?? new CaptureStreamPool();
  }

  /** A new Vision layer needs the current frames even when its sources are unchanged. */
  refresh(): void {
    if (this.disposed) return;
    for (const session of this.sessions.values()) {
      if (session.ready) session.dirty = true;
    }
    this.schedulePump();
  }

  /** Keep tracks alive while another Vision canvas acquires the GPU context. */
  async pause(): Promise<void> {
    this.paused = true;
    if (this.framePump !== null) cancelAnimationFrame(this.framePump);
    this.framePump = null;
    await this.uploadCompletion;
  }

  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    this.refresh();
  }

  update(sources: readonly VisionLiveMediaSource[]): void {
    if (this.disposed) return;
    const next = new Map(sources.map((source) => [source.path, source]));
    for (const [path, session] of this.sessions) {
      const source = next.get(path);
      if (!source || signature(source) !== session.signature) {
        this.disposeSession(session);
        this.sessions.delete(path);
        this.clearTextures([path]);
      }
    }
    for (const source of sources) {
      const current = this.sessions.get(source.path);
      if (current) {
        current.source = source;
        continue;
      }
      const session = this.createSession(source);
      this.sessions.set(source.path, session);
      if (source.type === "peer") this.connectPeer(session);
      else void this.connectCapture(session);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.framePump !== null) cancelAnimationFrame(this.framePump);
    this.framePump = null;
    for (const session of this.sessions.values()) this.disposeSession(session);
    this.sessions.clear();
  }

  private createSession(source: VisionLiveMediaSource): MediaSession {
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = source.type !== "peer" || !this.options.liveAudio;
    video.setAttribute("aria-hidden", "true");
    Object.assign(video.style, {
      position: "fixed",
      left: "-4px",
      top: "-4px",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
    });
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = boundedDimension(source.width);
    frameCanvas.height = boundedDimension(source.height);
    const context = frameCanvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Solar could not allocate a camera frame surface.");
    document.body.append(video);
    const session: MediaSession = {
      source,
      signature: signature(source),
      video,
      frameCanvas,
      context,
      ready: false,
      dirty: false,
      disposed: false,
    };
    video.addEventListener("loadeddata", () => this.markReady(session), { once: true });
    video.addEventListener("error", () => this.clear(session), { once: true });
    return session;
  }

  private connectPeer(session: MediaSession): void {
    const slot = session.source.slot_ref;
    if (!slot) {
      this.clear(session);
      return;
    }
    session.unsubscribePeer = this.options.peers.subscribePeerStream(slot, (stream) => {
      if (session.disposed) return;
      this.attachStream(session, stream, false);
    });
    const current = this.options.peers.resolvePeerStream(slot);
    if (current) this.attachStream(session, current, false);
  }

  private async connectCapture(session: MediaSession): Promise<void> {
    const sourceKind = session.source.source_kind ?? "";
    if (!CAPTURE_KINDS.has(sourceKind)) {
      this.clear(session);
      return;
    }
    try {
      const resolved = await this.options.resolveCaptureDevice(
        session.source.device_ref ?? "",
        sourceKind,
      );
      if (session.disposed) return;
      if (!resolved || (!resolved.deviceId && !resolved.captureSourceId)) {
        this.clear(session);
        return;
      }
      const key = `${sourceKind}\u0000${resolved.deviceId ?? resolved.captureSourceId}`;
      const acquired = await this.capturePool.acquire(key, async () => {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices?.getUserMedia) throw new Error("getUserMedia is unavailable in this host.");
        if (resolved.captureSourceId) {
          const constraints = {
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: resolved.captureSourceId,
              },
            },
          } as unknown as MediaStreamConstraints;
          return mediaDevices.getUserMedia(constraints);
        }
        return mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: resolved.deviceId } },
        });
      });
      if (session.disposed) {
        acquired.release();
        return;
      }
      session.releaseCapture = acquired.release;
      this.attachStream(session, acquired.stream, true);
    } catch (error) {
      if (session.disposed) return;
      this.options.onError({
        code: "CAMERA_CAPTURE_FAILED",
        message: error instanceof Error ? error.message : "Camera capture failed.",
        recoverable: true,
      });
      this.clear(session);
    }
  }

  private attachStream(session: MediaSession, stream: MediaStream | null, local: boolean): void {
    if (!stream) {
      session.ready = false;
      session.video.srcObject = null;
      this.clear(session);
      return;
    }
    session.video.muted = local || !this.options.liveAudio;
    session.video.srcObject = stream;
    void session.video.play().then(
      () => this.markReady(session),
      (error: unknown) => {
        if (!session.disposed) {
          this.options.onError({
            code: "CAMERA_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "Live video could not start.",
            recoverable: true,
          });
        }
      },
    );
  }

  private markReady(session: MediaSession): void {
    if (session.disposed || session.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    session.ready = true;
    session.dirty = true;
    this.watchVideo(session);
    this.schedulePump();
  }

  private watchVideo(session: MediaSession): void {
    if (session.disposed || !session.ready) return;
    const video = session.video;
    const candidate = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (candidate.requestVideoFrameCallback) {
      const requestNext = (): void => {
        session.videoFrameRequest = candidate.requestVideoFrameCallback!(() => {
          if (session.disposed) return;
          session.dirty = true;
          this.schedulePump();
          requestNext();
        });
      };
      requestNext();
    } else {
      const requestNext = (): void => {
        session.fallbackFrameRequest = requestAnimationFrame(() => {
          session.fallbackFrameRequest = undefined;
          if (session.disposed) return;
          session.dirty = true;
          this.schedulePump();
          requestNext();
        });
      };
      requestNext();
    }
  }

  private schedulePump(): void {
    if (this.disposed || this.paused || this.framePump !== null || this.uploadPending) return;
    this.framePump = requestAnimationFrame(() => {
      this.framePump = null;
      const upload = this.uploadFrames();
      this.uploadCompletion = upload;
      const finished = (): void => { if (this.uploadCompletion === upload) this.uploadCompletion = null; };
      void upload.then(finished, finished);
    });
  }

  private async uploadFrames(): Promise<void> {
    const scene = this.options.getScene();
    if (!scene || this.disposed || this.uploadPending) return;
    const dirty = [...this.sessions.values()].filter(
      (session) => session.ready && session.dirty && !session.disposed,
    );
    if (dirty.length === 0) return;
    this.uploadPending = true;
    const frames: Array<{ path: string; bitmap: ImageBitmap }> = [];
    try {
      for (const session of dirty) {
        session.dirty = false;
        drawVideo(session);
        frames.push({ path: session.source.path, bitmap: await createImageBitmap(session.frameCanvas) });
      }
      await scene.updateMedia(frames);
    } catch (error) {
      for (const frame of frames) frame.bitmap.close();
      if (!this.disposed) {
        this.options.onError({
          code: "CAMERA_CAPTURE_FAILED",
          message: error instanceof Error ? error.message : "Live camera frame upload failed.",
          recoverable: true,
        });
      }
    } finally {
      this.uploadPending = false;
      if ([...this.sessions.values()].some((session) => session.dirty)) this.schedulePump();
    }
  }

  private clear(session: MediaSession): void {
    this.clearTextures([session.source.path]);
  }

  private clearTextures(paths: string[]): void {
    const scene = this.options.getScene();
    if (!scene) return;
    void scene.clearMedia(paths).catch((error: unknown) => {
      if (this.disposed) return;
      this.options.onError({
        code: "CAMERA_CAPTURE_FAILED",
        message: error instanceof Error ? error.message : "Vision could not clear a live camera texture.",
        recoverable: true,
      });
    });
  }

  private disposeSession(session: MediaSession): void {
    if (session.disposed) return;
    session.disposed = true;
    if (session.videoFrameRequest !== undefined) {
      const candidate = session.video as HTMLVideoElement & {
        cancelVideoFrameCallback?: (handle: number) => void;
      };
      candidate.cancelVideoFrameCallback?.(session.videoFrameRequest);
    }
    if (session.fallbackFrameRequest !== undefined) {
      cancelAnimationFrame(session.fallbackFrameRequest);
    }
    session.unsubscribePeer?.();
    session.releaseCapture?.();
    session.video.pause();
    session.video.srcObject = null;
    session.video.remove();
  }
}

function signature(source: VisionLiveMediaSource): string {
  return [source.type, source.source_kind, source.device_ref, source.slot_ref, source.width, source.height, source.fit].join("\u0000");
}

function boundedDimension(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
    throw new Error("Vision returned an invalid live-media texture size.");
  }
  return value;
}

function drawVideo(session: MediaSession): void {
  const { video, context, source } = session;
  const width = session.frameCanvas.width;
  const height = session.frameCanvas.height;
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  context.clearRect(0, 0, width, height);
  if (!sw || !sh) return;
  if (source.fit === "fill") {
    context.drawImage(video, 0, 0, width, height);
    return;
  }
  const scale = source.fit === "contain"
    ? Math.min(width / sw, height / sh)
    : Math.max(width / sw, height / sh);
  const drawWidth = sw * scale;
  const drawHeight = sh * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;
  context.drawImage(video, dx, dy, drawWidth, drawHeight);
}
