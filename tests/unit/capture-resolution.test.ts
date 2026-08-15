import { afterEach, describe, expect, it, vi } from "vitest";
import type { MountOptions } from "../../src/types";

const { mountRuntime } = vi.hoisted(() => ({
  mountRuntime: vi.fn((..._args: unknown[]) => ({
    disconnect: vi.fn(),
    setToken: vi.fn(),
  })),
}));

vi.mock("@lumencast/runtime", () => {
  return {
    mount: mountRuntime,
    createPeerViewerFromInjection: vi.fn(() => {
      throw new Error("capture resolver test must not create a peer viewer");
    }),
  };
});

const CAPTURE_GLOBAL = "__ZAB_CAPTURE_DEVICES__";

function baseOptions(): MountOptions {
  return {
    target: document.createElement("div"),
    orionUrl: "wss://gate.example/orion/api/v1/show/stream",
    token: "fake-token",
    mode: "broadcast",
  };
}

async function loadMount(): Promise<typeof import("../../src/mount").mount> {
  vi.resetModules();
  return (await import("../../src/mount")).mount;
}

function resolver(): (
  deviceRef: string,
  sourceKind: string,
) => Promise<{ deviceId?: string; captureSourceId?: string } | null> {
  const args = mountRuntime.mock.calls.at(-1);
  if (args === undefined) throw new Error("mount() was not called");
  const options = args[0] as Record<string, unknown>;
  return options.resolveCaptureDevice as (
    deviceRef: string,
    sourceKind: string,
  ) => Promise<{ deviceId?: string; captureSourceId?: string } | null>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>)[CAPTURE_GLOBAL];
  mountRuntime.mockClear();
});

describe("Solar's default capture-device resolver", () => {
  it("warms the origin, maps labels, caches the map, and passes capture IDs through", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    const enumerateDevices = vi.fn(async () => [
      { label: "", deviceId: "hidden" },
      { label: "Local camera", deviceId: "local-camera" },
    ]);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia, enumerateDevices },
    });
    (globalThis as Record<string, unknown>)[CAPTURE_GLOBAL] = {
      camera: { label: "Local camera" },
      missing: { label: "No such camera" },
      unlabeled: {},
      screen: { captureSourceId: "desktop-screen" },
    };

    const mount = await loadMount();
    mount(baseOptions());
    const resolve = resolver();

    expect(await resolve("camera", "media.camera")).toEqual({ deviceId: "local-camera" });
    expect(await resolve("missing", "media.microphone")).toBeNull();
    expect(await resolve("unlabeled", "media.camera")).toBeNull();
    expect(await resolve("unknown", "media.camera")).toBeNull();
    expect(await resolve("screen", "media.screen")).toEqual({ captureSourceId: "desktop-screen" });
    expect(await resolve("screen", "media.window")).toEqual({ captureSourceId: "desktop-screen" });
    expect(await resolve("screen", "media.app")).toEqual({ captureSourceId: "desktop-screen" });
    expect(await resolve("missing", "media.camera")).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ video: true });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(enumerateDevices).toHaveBeenCalledTimes(1);
  });

  it("returns a placeholder when enumerateDevices is unavailable", async () => {
    vi.stubGlobal("navigator", { mediaDevices: {} });
    (globalThis as Record<string, unknown>)[CAPTURE_GLOBAL] = {
      camera: { label: "Local camera" },
    };
    const mount = await loadMount();
    mount(baseOptions());

    expect(await resolver()("camera", "media.camera")).toBeNull();
  });

  it("keeps resolving after a denied warm-up", async () => {
    const enumerateDevices = vi.fn(async () => [
      { label: "Local microphone", deviceId: "local-microphone" },
    ]);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new Error("permission denied");
        }),
        enumerateDevices,
      },
    });
    (globalThis as Record<string, unknown>)[CAPTURE_GLOBAL] = {
      microphone: { label: "Local microphone" },
    };
    const mount = await loadMount();
    mount(baseOptions());

    expect(await resolver()("microphone", "media.microphone")).toEqual({
      deviceId: "local-microphone",
    });
  });

  it("returns a placeholder when enumeration itself fails or navigator is absent", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: undefined,
        enumerateDevices: vi.fn(async () => {
          throw new Error("enumeration failed");
        }),
      },
    });
    (globalThis as Record<string, unknown>)[CAPTURE_GLOBAL] = {
      camera: { label: "Local camera" },
    };
    let mount = await loadMount();
    mount(baseOptions());
    expect(await resolver()("camera", "media.camera")).toBeNull();

    vi.stubGlobal("navigator", undefined);
    mount = await loadMount();
    mount(baseOptions());
    expect(await resolver()("camera", "media.camera")).toBeNull();
  });
});
