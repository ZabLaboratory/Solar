import { describe, expect, it, vi } from "vitest";
import { createCaptureResolver } from "../../src/sources/capture";

describe("Vision capture resolution", () => {
  it("forwards a logical camera reference to the embedding host", async () => {
    const hostResolver = vi.fn(async () => ({ deviceId: "camera-7" }));
    const resolve = createCaptureResolver({ resolveCaptureDevice: hostResolver });

    await expect(resolve("camera-ref", "media.webcam")).resolves.toEqual({
      deviceId: "camera-7",
    });
    expect(hostResolver).toHaveBeenCalledWith("camera-ref", "media.webcam");
  });

  it("resolves the pinned default screen only when no explicit source exists", async () => {
    const hostResolver = vi.fn(async () => null);
    const resolve = createCaptureResolver({ resolveCaptureDevice: hostResolver });
    (globalThis as Record<string, unknown>).__ZAB_CAPTURE_DEFAULT_SCREEN__ = {
      captureSourceId: "screen:main",
    };
    const defaultResolver = createCaptureResolver({});

    await expect(resolve("window-ref", "media.window")).resolves.toBeNull();
    await expect(defaultResolver("screen-ref", "media.screen")).resolves.toEqual({
      captureSourceId: "screen:main",
    });
    expect(hostResolver).toHaveBeenCalledWith("window-ref", "media.window");
  });
});
