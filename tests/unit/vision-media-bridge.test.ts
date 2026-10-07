import { describe, expect, it, vi } from "vitest";
import { VisionMediaBridge } from "../../src/engine/vision-media-bridge";

describe("real Vision engine media bridge", () => {
  it("keeps the engine and factory arguments intact and uploads through its real public API", async () => {
    const engine = { update_live_image: vi.fn() };
    const Engine = {
      create_html_canvas_with_fonts: vi.fn(async () => engine),
      unrelated: "preserved",
    };
    const bridge = new VisionMediaBridge();
    const wasm = bridge.module({ VisionGpuEngine: Engine, default: "init" });
    const wrapped = wasm.VisionGpuEngine as typeof Engine;
    const image = {} as ImageBitmap;
    expect(await wrapped.create_html_canvas_with_fonts()).toBe(engine);
    expect(Engine.create_html_canvas_with_fonts).toHaveBeenCalledOnce();
    expect(wrapped.unrelated).toBe("preserved");
    expect(wasm.default).toBe("init");
    bridge.upload([{ path: "live", bitmap: image }]);
    expect(engine.update_live_image).toHaveBeenCalledWith("live", image);
  });

  it("does not bypass missing engine media capabilities", async () => {
    const bridge = new VisionMediaBridge();
    expect(() => bridge.upload([])).toThrow("disconnected");
    const module = bridge.module({
      VisionGpuEngine: { create_html_canvas: async () => ({}) },
    });
    const Engine = module.VisionGpuEngine as {
      create_html_canvas: () => Promise<unknown>;
    };
    await expect(Engine.create_html_canvas()).rejects.toThrow("unavailable");
  });
});
