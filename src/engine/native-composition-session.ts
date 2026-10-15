import { NativeCompositionPublisher } from "./native-composition-publisher";
import {
  nativeCompositionRequiresRebuild,
  type NativeCompositionProjection,
} from "../scenes/native-composition";
import type { LSMLDocument } from "../scenes/native-document";
import type { MountOptions } from "../types";
import type { NativeSceneFrames } from "./native-scene-frames";

/** Owns publication and active-plan bookkeeping for one physical Solar host. */
export class NativeCompositionSession {
  private publisher: NativeCompositionPublisher | null = null;
  private activeProjection: NativeCompositionProjection | null = null;

  constructor(private readonly options: MountOptions) {}

  get currentProjection(): NativeCompositionProjection | null {
    return this.activeProjection;
  }

  start(authToken: string): void {
    const config = this.options.nativeCompositionLSDP;
    if (!config || this.publisher) return;
    this.publisher = new NativeCompositionPublisher(
      {
        ...config,
        authToken,
        source: {
          resource: this.options.nativeLSDP.resource,
          ...(this.options.nativeLSDP.selector
            ? { selector: this.options.nativeLSDP.selector }
            : {}),
        },
      },
      (error) => this.reportError(error),
    );
  }

  project(
    document: LSMLDocument,
    frames: NativeSceneFrames,
  ): NativeCompositionProjection | null {
    return this.publisher ? frames.projectComposition(document) : null;
  }

  use(projection: NativeCompositionProjection | null): void {
    this.activeProjection = projection;
  }

  requiresRebuild(patch: Record<string, unknown>): boolean {
    return nativeCompositionRequiresRebuild(this.activeProjection, patch);
  }

  publish(
    projection: NativeCompositionProjection | null,
    document: LSMLDocument,
    stateHash: unknown,
  ): void {
    const publisher = this.publisher;
    if (!publisher) return;
    if (typeof stateHash !== "string") {
      this.reportError(
        new Error("Composition publication requires an exact state hash."),
      );
      return;
    }
    void publisher
      .publish(projection, document, stateHash)
      .catch((error) => this.reportError(error));
  }

  accept(
    projection: NativeCompositionProjection | null,
    document: LSMLDocument,
    stateHash: unknown,
  ): void {
    this.use(projection);
    this.publish(projection, document, stateHash);
  }

  acceptDocument(
    document: LSMLDocument,
    frames: NativeSceneFrames,
    stateHash: unknown,
  ): void {
    this.accept(this.project(document, frames), document, stateHash);
  }

  clear(): void {
    this.activeProjection = null;
    const publisher = this.publisher;
    if (!publisher) return;
    void publisher.clear().catch((error) => this.reportError(error));
  }

  retire(): void {
    this.activeProjection = null;
    const publisher = this.publisher;
    this.publisher = null;
    if (publisher)
      void publisher.retire().catch((error) => this.reportError(error));
  }

  private reportError(error: unknown): void {
    this.options.onError?.({
      code: "NATIVE_COMPOSITION_FAILED",
      message: `Native composition: ${error instanceof Error ? error.message : String(error)}`,
      recoverable: true,
    });
  }
}
