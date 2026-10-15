import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureStreamPool, LiveMediaController } from "../../src/engine/live-media";
import type { PeerSources } from "../../src/sources/peers";
import type { ResolveCaptureDevice } from "../../src/types";
import type { VisionLiveMediaSource, VisionSceneHandle } from "../../src/engine/vision-presenter";

const localCamera: VisionLiveMediaSource = {
  path: "camera.local",
  type: "capture",
  source_kind: "media.webcam",
  device_ref: "camera-ref",
  width: 640,
  height: 360,
  fit: "cover",
};

const remoteCamera: VisionLiveMediaSource = {
  path: "camera.remote",
  type: "peer",
  slot_ref: "caster-slot",
  width: 320,
  height: 180,
  fit: "contain",
};

function makeScene() {
  const scene = {
    sceneId: "scene-a",
    sceneVersion: "sha256:version",
    mediaSources: [],
    applyPatch: vi.fn(async () => undefined),
    activate: vi.fn(),
    updateMedia: vi.fn(async (frames: Array<{ path: string; bitmap: ImageBitmap }>) => {
      frames.forEach(({ bitmap }) => bitmap.close());
    }),
    clearMedia: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
  return scene as unknown as VisionSceneHandle & typeof scene;
}

function peerSources(): PeerSources & {
  publish: (slot: string, stream: MediaStream | null) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, (stream: MediaStream | null) => void>();
  const unsubscribe = vi.fn();
  return {
    resolvePeerStream: vi.fn(() => null),
    subscribePeerStream: vi.fn((slot, listener) => {
      listeners.set(slot, listener);
      return () => {
        unsubscribe();
        listeners.delete(slot);
      };
    }),
    dispose: vi.fn(),
    publish: (slot, stream) => listeners.get(slot)?.(stream),
    unsubscribe,
  };
}

describe("Vision live camera textures", () => {
  const contexts = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
  const getUserMedia = vi.fn<(...args: unknown[]) => Promise<MediaStream>>();
  const stopTrack = vi.fn();
  const closeBitmap = vi.fn();
  let bitmapNumber = 0;
  let frameNumber = 0;

  beforeEach(() => {
    bitmapNumber = 0;
    frameNumber = 0;
    getUserMedia.mockReset();
    stopTrack.mockReset();
    closeBitmap.mockReset();
    contexts.clearRect.mockReset();
    contexts.drawImage.mockReset();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    getUserMedia.mockResolvedValue(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      bitmapNumber += 1;
      return { close: closeBitmap, number: bitmapNumber } as unknown as ImageBitmap;
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const current = ++frameNumber;
      queueMicrotask(() => callback(current));
      return current;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get: () => 1280,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get: () => 720,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn(() => 1),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() { return (this as HTMLMediaElement & { __testStream?: MediaStream }).__testStream ?? null; },
      set(value: MediaStream | null) { (this as HTMLMediaElement & { __testStream?: MediaStream }).__testStream = value ?? undefined; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      ((kind: string) => kind === "2d" ? contexts : null) as never,
    );
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves a local camera and sends fitted video frames into Vision", async () => {
    const scene = makeScene();
    const peers = peerSources();
    const resolveCaptureDevice: ResolveCaptureDevice = vi.fn(async () => ({ deviceId: "device-1" }));
    const controller = new LiveMediaController({
      liveAudio: false,
      resolveCaptureDevice,
      peers,
      onError: vi.fn(),
      getScene: () => scene,
    });

    controller.update([localCamera]);
    await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
    expect(resolveCaptureDevice).toHaveBeenCalledWith("camera-ref", "media.webcam");
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { deviceId: { exact: "device-1" } },
    });
    const uploaded = scene.updateMedia.mock.calls[0]?.[0];
    expect(uploaded?.map((frame) => frame.path)).toEqual(["camera.local"]);
    expect(contexts.drawImage).toHaveBeenCalled();
    expect(closeBitmap).toHaveBeenCalledOnce();

    controller.dispose();
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("keeps one video-frame callback chain when play and loadeddata both report readiness", async () => {
    const callbacks = new Map<number, VideoFrameRequestCallback>();
    let nextHandle = 0;
    const request = vi.fn((callback: VideoFrameRequestCallback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    });
    const cancel = vi.fn((handle: number) => callbacks.delete(handle));
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value: request });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", { configurable: true, value: cancel });
    const scene = makeScene();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => ({ deviceId: "device-1" }),
      peers: peerSources(), onError: vi.fn(), getScene: () => scene,
    });
    controller.update([localCamera]);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    document.querySelector("video")!.dispatchEvent(new Event("loadeddata"));
    expect(request).toHaveBeenCalledOnce();
    const callback = callbacks.get(1)!;
    callbacks.delete(1);
    callback(0, {} as VideoFrameCallbackMetadata);
    expect(callbacks.size).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);
    controller.dispose();
    expect(cancel).toHaveBeenCalledWith(2);
    expect(callbacks.size).toBe(0);
  });

  it("keeps one fallback frame watcher and cancels both watcher and upload at disposal", async () => {
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value: undefined });
    const pending = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pending.set(++next, callback);
      return next;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => pending.delete(handle));
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => ({ deviceId: "device-1" }),
      peers: peerSources(), onError: vi.fn(), getScene: () => makeScene(),
    });
    try {
      controller.update([localCamera]);
      await vi.waitFor(() => expect(pending.size).toBe(1));
      document.querySelector("video")!.dispatchEvent(new Event("loadeddata"));
      expect(pending.size).toBe(1);
    } finally { controller.dispose(); }
    expect(pending.size).toBe(0);
  });

  it("stops a pending watcher when a peer stream disappears and restarts on its return", async () => {
    let callback: VideoFrameRequestCallback | undefined;
    let requestCount = 0;
    const request = vi.fn((next: VideoFrameRequestCallback) => { callback = next; return ++requestCount; });
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value: request });
    const scene = makeScene();
    const peers = peerSources();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => null, peers,
      onError: vi.fn(), getScene: () => scene,
    });
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    controller.update([remoteCamera]);
    peers.publish("caster-slot", stream);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    peers.publish("caster-slot", null);
    callback!(0, {} as VideoFrameCallbackMetadata);
    expect(request).toHaveBeenCalledOnce();
    peers.publish("caster-slot", stream);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    controller.dispose();
  });

  it("does not reupload a stale frame after video error and resumes on new loadeddata", async () => {
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value: undefined });
    const pending = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++next, callback); return next; });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => pending.delete(handle));
    const scene = makeScene();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => ({ deviceId: "device-1" }),
      peers: peerSources(), onError: vi.fn(), getScene: () => scene,
    });
    try {
      controller.update([localCamera]);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      scene.updateMedia.mockClear();
      const video = document.querySelector("video")!;
      video.dispatchEvent(new Event("loadeddata"));
      video.dispatchEvent(new Event("error"));
      for (const [handle, callback] of [...pending]) {
        pending.delete(handle);
        callback(0);
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(scene.updateMedia).not.toHaveBeenCalled();
      expect(pending.size).toBe(0);
      expect(scene.clearMedia).toHaveBeenCalled();
      video.dispatchEvent(new Event("loadeddata"));
      expect(pending.size).toBe(1);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      video.dispatchEvent(new Event("error"));
      expect(scene.clearMedia.mock.calls.length).toBe(2);
    } finally {
      controller.dispose();
    }
  });

  it("discards an in-flight bitmap from before a decode error even if the stream recovers first", async () => {
    let finishOld!: (bitmap: ImageBitmap) => void;
    const oldClose = vi.fn();
    const freshClose = vi.fn();
    vi.mocked(createImageBitmap)
      .mockImplementationOnce(() => new Promise<ImageBitmap>((resolve) => { finishOld = resolve; }))
      .mockResolvedValue({ close: freshClose, number: 222 } as unknown as ImageBitmap);
    const scene = makeScene();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => ({ deviceId: "device-1" }),
      peers: peerSources(), onError: vi.fn(), getScene: () => scene,
    });
    try {
      controller.update([localCamera]);
      await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
      const video = document.querySelector("video")!;
      video.dispatchEvent(new Event("error"));
      video.dispatchEvent(new Event("loadeddata"));
      finishOld({ close: oldClose, number: 111 } as unknown as ImageBitmap);
      await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(freshClose).toHaveBeenCalledOnce());
      expect(scene.updateMedia).toHaveBeenCalledOnce();
      expect((scene.updateMedia.mock.calls[0]?.[0][0]?.bitmap as unknown as { number: number }).number).toBe(222);
      expect(oldClose).toHaveBeenCalledOnce();
    } finally { controller.dispose(); }
  });

  it("ignores play completion from a stream invalidated by a video error", async () => {
    let finishPlay!: () => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishPlay = resolve; }),
    );
    const scene = makeScene();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => ({ deviceId: "device-1" }),
      peers: peerSources(), onError: vi.fn(), getScene: () => scene,
    });
    try {
      controller.update([localCamera]);
      await vi.waitFor(() => expect(finishPlay).toBeDefined());
      document.querySelector("video")!.dispatchEvent(new Event("error"));
      finishPlay();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scene.updateMedia).not.toHaveBeenCalled();
      expect(createImageBitmap).not.toHaveBeenCalled();
      document.querySelector("video")!.dispatchEvent(new Event("loadeddata"));
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
    } finally { controller.dispose(); }
  });

  it("ignores a rejected play promise after its peer stream has been replaced", async () => {
    let rejectOld!: (error: Error) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectOld = reject; }),
    );
    const peers = peerSources();
    const scene = makeScene();
    const onError = vi.fn();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => null,
      peers, onError, getScene: () => scene,
    });
    try {
      controller.update([remoteCamera]);
      peers.publish("caster-slot", { getTracks: () => [] } as unknown as MediaStream);
      peers.publish("caster-slot", { getTracks: () => [] } as unknown as MediaStream);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      rejectOld(new Error("replaced stream"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onError).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it("keeps the capture track while its texture size and fitting change", async () => {
    const scene = makeScene();
    const resolveCaptureDevice = vi.fn(async () => ({ deviceId: "device-1" }));
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice,
      peers: peerSources(), onError: vi.fn(), getScene: () => scene,
    });
    try {
      controller.update([localCamera]);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      const video = document.querySelector("video")!;
      controller.update([{ ...localCamera, width: 800, height: 600, fit: "contain" }]);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledTimes(2));
      expect(document.querySelector("video")).toBe(video);
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(resolveCaptureDevice).toHaveBeenCalledOnce();
      expect(stopTrack).not.toHaveBeenCalled();
      expect(scene.clearMedia).not.toHaveBeenCalled();
      // A 1280x720 stream is contained in the new 800x600 texture.
      expect(contexts.drawImage).toHaveBeenLastCalledWith(
        video,
        0,
        0,
        1280,
        720,
        0,
        75,
        800,
        450,
      );
    } finally { controller.dispose(); }
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("applies contain, cover and fill to a Meet peer bitmap without resubscribing", async () => {
    const scene = makeScene();
    const peers = peerSources();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => null, peers,
      onError: vi.fn(), getScene: () => scene,
    });
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const source = { ...remoteCamera, height: 240 };
    try {
      controller.update([source]);
      peers.publish("caster-slot", stream);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      const video = document.querySelector("video")!;
      expect(contexts.drawImage).toHaveBeenLastCalledWith(
        video,
        0,
        0,
        1280,
        720,
        0,
        30,
        320,
        180,
      );

      controller.update([{ ...source, fit: "cover" }]);
      await vi.waitFor(() =>
        expect(scene.updateMedia).toHaveBeenCalledTimes(2),
      );
      const cover = contexts.drawImage.mock.calls.at(-1)!;
      expect(cover.slice(1, 5)).toEqual([0, 0, 1280, 720]);
      expect(cover[5]).toBeCloseTo(-53.3333, 3);
      expect(cover[6]).toBe(0);
      expect(cover[7]).toBeCloseTo(426.6667, 3);
      expect(cover[8]).toBe(240);

      controller.update([{ ...source, fit: "fill" }]);
      await vi.waitFor(() =>
        expect(scene.updateMedia).toHaveBeenCalledTimes(3),
      );
      expect(contexts.drawImage).toHaveBeenLastCalledWith(
        video,
        0,
        0,
        1280,
        720,
        0,
        0,
        320,
        240,
      );
      expect(document.querySelector("video")).toBe(video);
      expect(peers.subscribePeerStream).toHaveBeenCalledOnce();
      expect(peers.unsubscribe).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it("applies Meet crop, zoom, content box and position updates to the peer bitmap", async () => {
    const scene = makeScene();
    const peers = peerSources();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => null, peers,
      onError: vi.fn(), getScene: () => scene,
    });
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const source: VisionLiveMediaSource = {
      ...remoteCamera,
      size: { w: 640, h: 360 },
      contentBox: { x: 40, y: 20, width: 400, height: 200 },
      sourceCrop: { left: 25, top: 25, right: 25, bottom: 25 },
      sourceZoom: 2,
      objectPosition: { x: 0.75, y: 0.25 },
    };
    try {
      controller.update([source]);
      peers.publish("caster-slot", stream);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      const video = document.querySelector("video")!;
      const framed = contexts.drawImage.mock.calls.at(-1)!;
      expect(framed.slice(1, 5)).toEqual([320, 180, 640, 360]);
      expect(framed[5]).toBeCloseTo(-96.6667, 3);
      expect(framed[6]).toBeCloseTo(-15, 3);
      expect(framed[7]).toBeCloseTo(355.5556, 3);
      expect(framed[8]).toBeCloseTo(200, 3);

      controller.update([
        {
          ...source,
          sourceZoom: 1.5,
          contentBox: { ...source.contentBox!, x: 20 },
        },
      ]);
      await vi.waitFor(() =>
        expect(scene.updateMedia).toHaveBeenCalledTimes(2),
      );
      const moved = contexts.drawImage.mock.calls.at(-1)!;
      expect(moved.slice(1, 5)).toEqual([320, 180, 640, 360]);
      expect(moved[5]).toBeCloseTo(-40, 3);
      expect(moved[6]).toBeCloseTo(-2.5, 3);
      expect(moved[7]).toBeCloseTo(266.6667, 3);
      expect(moved[8]).toBeCloseTo(150, 3);
      expect(peers.subscribePeerStream).toHaveBeenCalledOnce();
      expect(peers.unsubscribe).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it("replaces the capture track when the actual source identity changes", async () => {
    const scene = makeScene();
    const resolveCaptureDevice = vi.fn(async (ref: string) => ({ deviceId: ref }));
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice,
      peers: peerSources(), onError: vi.fn(), getScene: () => scene,
    });
    try {
      controller.update([localCamera]);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      const video = document.querySelector("video")!;
      controller.update([{ ...localCamera, device_ref: "another-camera" }]);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledTimes(2));
      expect(document.querySelector("video")).not.toBe(video);
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(stopTrack).toHaveBeenCalledOnce();
      expect(scene.clearMedia).toHaveBeenCalledOnce();
    } finally { controller.dispose(); }
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });

  it("uploads ready media without waiting for another animation frame", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 99));
    const scene = makeScene();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => ({ deviceId: "device-1" }),
      peers: peerSources(), onError: vi.fn(), getScene: () => scene,
    });
    try {
      controller.update([localCamera]);
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      expect(requestAnimationFrame).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it("invalidates queued uploads at pause and disposal without consuming the resumed pump", async () => {
    const pending: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => pending.push(callback));
    const peers = peerSources();
    const scene = makeScene();
    const controller = new LiveMediaController({
      liveAudio: false, resolveCaptureDevice: async () => null,
      peers, onError: vi.fn(), getScene: () => scene,
    });
    try {
      controller.update([remoteCamera]);
      peers.publish("caster-slot", { getTracks: () => [] } as unknown as MediaStream);
      await vi.waitFor(() => expect(pending.length).toBe(1));
      await controller.pause();
      controller.resume();
      expect(pending.length).toBe(2);
      pending.shift()!();
      expect(createImageBitmap).not.toHaveBeenCalled();
      pending.shift()!();
      await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
      controller.refresh();
      expect(pending.length).toBe(1);
      controller.dispose();
      pending.shift()!();
      expect(scene.updateMedia).toHaveBeenCalledOnce();
    } finally { controller.dispose(); }
  });

  it("shares a camera stream while the next Vision scene is prepared", async () => {
    const pool = new CaptureStreamPool();
    const makeController = (scene: VisionSceneHandle) => new LiveMediaController({
      liveAudio: false,
      resolveCaptureDevice: async () => ({ deviceId: "device-1" }),
      peers: peerSources(),
      capturePool: pool,
      onError: vi.fn(),
      getScene: () => scene,
    });
    const previous = makeScene();
    const next = makeScene();
    const previousController = makeController(previous);
    const nextController = makeController(next);

    previousController.update([localCamera]);
    await vi.waitFor(() => expect(previous.updateMedia).toHaveBeenCalledOnce());
    nextController.update([localCamera]);
    await vi.waitFor(() => expect(next.updateMedia).toHaveBeenCalledOnce());

    expect(getUserMedia).toHaveBeenCalledOnce();
    previousController.dispose();
    expect(stopTrack).not.toHaveBeenCalled();
    nextController.dispose();
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("uploads remote peer frames and clears their Vision texture on slot removal", async () => {
    const scene = makeScene();
    const peers = peerSources();
    const controller = new LiveMediaController({
      liveAudio: false,
      resolveCaptureDevice: async () => null,
      peers,
      onError: vi.fn(),
      getScene: () => scene,
    });

    controller.update([remoteCamera]);
    peers.publish("caster-slot", { getTracks: () => [] } as unknown as MediaStream);
    await vi.waitFor(() => expect(scene.updateMedia).toHaveBeenCalledOnce());
    controller.update([]);
    await vi.waitFor(() => expect(scene.clearMedia).toHaveBeenCalledWith(["camera.remote"]));
    expect(peers.unsubscribe).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
