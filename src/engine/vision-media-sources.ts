import type { VisionCompositionFrame } from "./vision-composition-frame";
import type { VisionLiveMediaSource } from "./vision-contracts";

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
