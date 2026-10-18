import type { VisionCompositionFrame } from "./vision-composition-frame";
import type { VisionLiveMediaSource } from "./vision-contracts";

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
            property !== "create_html_canvas_with_fonts" &&
            property !== "create_empty_html_canvas"
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

/** Publish only frame-coherent raster inputs; native paths stay owned by Pulsar. */
export class VisionMediaSources {
  private accepted: readonly VisionLiveMediaSource[] = [];
  private pending: readonly VisionLiveMediaSource[] | null = null;

  constructor(
    private readonly nativeComposition: boolean,
    private readonly onSources: (
      sources: readonly VisionLiveMediaSource[],
    ) => void,
  ) {}

  get current(): readonly VisionLiveMediaSource[] {
    return this.accepted;
  }

  filterOwned(paths: string[]): string[] {
    const owned = new Set(this.accepted.map((source) => source.path));
    return paths.filter((path) => owned.has(path));
  }

  update(sources: readonly VisionLiveMediaSource[], failed = false): void {
    if (this.nativeComposition) {
      if (!failed) this.pending = sources;
    } else this.publish(sources);
  }

  accept(frame: VisionCompositionFrame | null): void {
    if (!frame || !this.pending) return;
    const delegated = new Set(
      frame.captures.map((capture) => capture.liveMediaPath),
    );
    const sources = this.pending;
    this.pending = null;
    this.publish(
      sources.filter(
        (source) => source.type !== "capture" || !delegated.has(source.path),
      ),
    );
  }

  private publish(sources: readonly VisionLiveMediaSource[]): void {
    this.accepted = sources;
    this.onSources(sources);
  }
}
