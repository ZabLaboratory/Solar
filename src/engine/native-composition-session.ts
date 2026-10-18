import {
  NativeCompositionPublisher,
  type NativeCompositionPeerFactory,
  type NativeCompositionPublishResult,
} from "./native-composition-publisher";
import { type NativeCompositionProjection } from "../scenes/native-composition";
import type { LSMLDocument } from "../scenes/native-document";
import type { MountOptions } from "../types";
import type { NativeSceneFrames } from "./native-scene-frames";
import type { VisionSceneHandle } from "./vision-contracts";

interface AcceptedPublication {
  projection: NativeCompositionProjection | null;
  document: LSMLDocument;
  stateHash: string;
}

/** Owns publication and active-plan bookkeeping for one physical Solar host. */
export class NativeCompositionSession {
  private publisher: NativeCompositionPublisher | null = null;
  private activeProjection: NativeCompositionProjection | null = null;
  private acceptedPublication: AcceptedPublication | null = null;
  private hasAcceptedState = false;
  private hasStarted = false;
  private recoveringPublisher: NativeCompositionPublisher | null = null;

  constructor(
    private readonly options: MountOptions,
    private readonly onDisconnected: (error: unknown) => void = () => {},
    private readonly onRecovered: () => void = () => {},
    private readonly createPeer?: NativeCompositionPeerFactory,
  ) {}

  get currentProjection(): NativeCompositionProjection | null {
    return this.activeProjection;
  }

  start(authToken: string): void {
    const config = this.options.nativeCompositionLSDP;
    if (!config || this.publisher) return;
    const recovering = this.hasStarted;
    this.hasStarted = true;
    const publisher = new NativeCompositionPublisher(
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
      this.createPeer,
      (error) => {
        if (this.publisher !== publisher) return;
        this.publisher = null;
        if (this.recoveringPublisher === publisher)
          this.recoveringPublisher = null;
        try {
          publisher.discard();
        } finally {
          this.onDisconnected(error);
        }
      },
    );
    this.publisher = publisher;
    this.recoveringPublisher = recovering ? publisher : null;
    if (this.hasAcceptedState) {
      const accepted = this.acceptedPublication;
      if (accepted) this.publishTo(publisher, accepted);
      else this.clearOn(publisher);
    }
  }

  project(
    scene: VisionSceneHandle,
    frames: NativeSceneFrames,
  ): NativeCompositionProjection | null {
    return this.options.nativeCompositionLSDP
      ? frames.projectComposition(scene)
      : null;
  }

  use(projection: NativeCompositionProjection | null): void {
    this.activeProjection = projection;
  }

  publish(
    projection: NativeCompositionProjection | null,
    document: LSMLDocument,
    stateHash: unknown,
  ): void {
    if (typeof stateHash !== "string") {
      this.reportError(
        new Error("Composition publication requires an exact state hash."),
      );
      return;
    }
    const accepted = { projection, document, stateHash };
    this.hasAcceptedState = true;
    this.acceptedPublication = accepted;
    const publisher = this.publisher;
    if (publisher) this.publishTo(publisher, accepted);
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
    scene: VisionSceneHandle,
    frames: NativeSceneFrames,
    stateHash: unknown,
  ): void {
    if (!this.options.nativeCompositionLSDP) {
      this.accept(null, document, stateHash);
      return;
    }
    if (scene.sceneId !== document.scene_id)
      throw new Error("NATIVE_COMPOSITION_SCENE_IDENTITY_MISMATCH");
    this.accept(this.project(scene, frames), document, stateHash);
  }

  clear(): void {
    this.activeProjection = null;
    this.hasAcceptedState = true;
    this.acceptedPublication = null;
    const publisher = this.publisher;
    if (!publisher) return;
    this.clearOn(publisher);
  }

  retire(): void {
    this.activeProjection = null;
    this.hasAcceptedState = false;
    this.acceptedPublication = null;
    const publisher = this.publisher;
    this.publisher = null;
    this.recoveringPublisher = null;
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

  private publishTo(
    publisher: NativeCompositionPublisher,
    accepted: AcceptedPublication,
  ): void {
    void publisher
      .publish(accepted.projection, accepted.document, accepted.stateHash)
      .then((result) => this.completeRecovery(publisher, result))
      .catch((error) => this.reportError(error));
  }

  private clearOn(publisher: NativeCompositionPublisher): void {
    void publisher
      .clear()
      .then((result) => this.completeRecovery(publisher, result))
      .catch((error) => this.reportError(error));
  }

  private completeRecovery(
    publisher: NativeCompositionPublisher,
    result: NativeCompositionPublishResult,
  ): void {
    if (
      result !== "completed" ||
      this.publisher !== publisher ||
      this.recoveringPublisher !== publisher
    )
      return;
    this.recoveringPublisher = null;
    this.onRecovered();
  }
}
