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
