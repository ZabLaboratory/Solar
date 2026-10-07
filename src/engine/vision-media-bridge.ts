interface MediaEngine {
  update_live_image(path: string, bitmap: ImageBitmap): void;
}
type EngineFactory = (...args: unknown[]) => Promise<MediaEngine>;

/** Capture the real engine through Vision's supported dependency injection point. */
export class VisionMediaBridge {
  private engine: MediaEngine | null = null;

  module(wasm: Record<string, unknown>): Record<string, unknown> {
    const Engine = wasm.VisionGpuEngine as Record<string, unknown>;
    return {
      ...wasm,
      VisionGpuEngine: new Proxy(Engine, {
        get: (target, property) => {
          const method = Reflect.get(target, property);
          if (
            property !== "create_html_canvas" &&
            property !== "create_html_canvas_with_fonts"
          )
            return method;
          return async (...args: unknown[]) => {
            const engine = await (method as EngineFactory).apply(target, args);
            if (typeof engine.update_live_image !== "function")
              throw new Error("Vision live image API is unavailable.");
            this.engine = engine;
            return engine;
          };
        },
      }),
    };
  }

  upload(frames: Array<{ path: string; bitmap: ImageBitmap }>): void {
    if (!this.engine) throw new Error("Vision engine is disconnected.");
    for (const { path, bitmap } of frames)
      this.engine.update_live_image(path, bitmap);
  }
}
