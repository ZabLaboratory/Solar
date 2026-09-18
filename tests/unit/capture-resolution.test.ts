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
const DEFAULT_SCREEN_GLOBAL = "__ZAB_CAPTURE_DEFAULT_SCREEN__";

function baseOptions(overrides: Partial<MountOptions> = {}): MountOptions {
  return {
    target: document.createElement("div"),
    orionUrl: "ws://127.0.0.1:4007/orion/api/v1/show/stream",
    token: "fake-token",
    mode: "broadcast",
    ...overrides,
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
  delete (globalThis as Record<string, unknown>)[DEFAULT_SCREEN_GLOBAL];
  delete (globalThis as Record<string, unknown>)
    .__ZAB_CAPTURE_RESOLVE_DEFAULT_SCREEN__;
  mountRuntime.mockClear();
});

describe("Solar's default capture-device resolver", () => {
  it("awaits a deferred default only for an unbound screen, never a camera/window or an explicit mapping", async () => {
    const deferred = vi.fn(async () => ({ captureSourceId: "screen:lazy:0" }));
    (
      globalThis as Record<string, unknown>
    ).__ZAB_CAPTURE_RESOLVE_DEFAULT_SCREEN__ = deferred;
    (globalThis as Record<string, unknown>)[CAPTURE_GLOBAL] = {
      pinned: { captureSourceId: "screen:pinned:0" },
    };
    const mount = await loadMount();
    mount(baseOptions());
    expect(deferred).not.toHaveBeenCalled();
    expect(await resolver()("camera", "media.camera")).toBeNull();
    expect(await resolver()("window", "media.window")).toBeNull();
    expect(await resolver()("pinned", "media.screen")).toEqual({
      captureSourceId: "screen:pinned:0",
    });
    expect(deferred).not.toHaveBeenCalled();
    expect(await resolver()("default", "media.screen")).toEqual({
      captureSourceId: "screen:lazy:0",
    });
    expect(deferred).toHaveBeenCalledTimes(1);
  });
  it("keeps the broadcast CEF on a placeholder so native Pulsar owns the camera", async () => {
    const hostResolver = vi.fn(async () => ({ deviceId: "host-camera" }));
    const mount = await loadMount();
    mount(baseOptions({ resolveCaptureDevice: hostResolver }));

    expect(await resolver()("camera", "media.camera")).toBeNull();
    expect(hostResolver).not.toHaveBeenCalled();
  });

  it("retains host camera acquisition for control/editor mounts", async () => {
    const hostResolver = vi.fn(async () => ({ deviceId: "host-camera" }));
    const mount = await loadMount();
    mount(baseOptions({ mode: "control", resolveCaptureDevice: hostResolver }));

    expect(await resolver()("camera", "media.camera")).toEqual({
      deviceId: "host-camera",
    });
    expect(hostResolver).toHaveBeenCalledWith("camera", "media.camera");
  });

  it("allows only Prism's marked diagnostic window to inspect broadcast captures", async () => {
    const hostResolver = vi.fn(async () => ({ deviceId: "diagnostic-camera" }));
    const mount = await loadMount();
    mount(
      baseOptions({
        resolveCaptureDevice: hostResolver,
        captureInBrowser: true,
      }),
    );

    expect(await resolver()("camera", "media.camera")).toEqual({
      deviceId: "diagnostic-camera",
    });
    expect(hostResolver).toHaveBeenCalledWith("camera", "media.camera");
  });

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
    mount(baseOptions({ mode: "control" }));
    const resolve = resolver();

    expect(await resolve("camera", "media.camera")).toEqual({
      deviceId: "local-camera",
    });
    expect(await resolve("missing", "media.microphone")).toBeNull();
    expect(await resolve("unlabeled", "media.camera")).toBeNull();
    expect(await resolve("unknown", "media.camera")).toBeNull();
    expect(await resolve("screen", "media.screen")).toEqual({
      captureSourceId: "desktop-screen",
    });
    expect(await resolve("screen", "media.window")).toEqual({
      captureSourceId: "desktop-screen",
    });
    expect(await resolve("screen", "media.app")).toEqual({
      captureSourceId: "desktop-screen",
    });
    expect(await resolve("missing", "media.camera")).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ video: true });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(enumerateDevices).toHaveBeenCalledTimes(1);
  });

  it("uses Prism's machine-local default screen mapping for an unbound screen ref", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
        enumerateDevices: vi.fn(async () => []),
      },
    });
    (globalThis as Record<string, unknown>)[DEFAULT_SCREEN_GLOBAL] = {
      captureSourceId: "screen:0:0",
    };

    const mount = await loadMount();
    mount(baseOptions());

    expect(await resolver()("screen-ref", "media.screen")).toEqual({
      captureSourceId: "screen:0:0",
    });
  });

  it("returns a placeholder when enumerateDevices is unavailable", async () => {
    vi.stubGlobal("navigator", { mediaDevices: {} });
    (globalThis as Record<string, unknown>)[CAPTURE_GLOBAL] = {
      camera: { label: "Local camera" },
    };
    const mount = await loadMount();
    mount(baseOptions({ mode: "control" }));

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
    mount(baseOptions({ mode: "control" }));

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
