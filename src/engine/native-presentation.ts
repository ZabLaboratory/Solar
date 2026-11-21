import jsonPatch from "fast-json-patch";
import type { LSMLDocument } from "../scenes/native-document";
import { animationPatch, type AnimationFrame } from "./animations";
import type { VisionSceneHandle } from "./vision-contracts";

/** Compare semantic JSON values; transport validation owns their portable-JSON admission. */
export function changedPresentationPatch(
  patch: Record<string, unknown>,
  baseline: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) =>
        !Object.hasOwn(baseline, key) ||
        (!Object.is(value, baseline[key]) &&
          jsonPatch.compare({ value: baseline[key] }, { value }).length > 0),
    ),
  );
}

/** The last submitted state, deliberately independent of newer received scalar state. */
export class NativePresentation {
  document: LSMLDocument | null = null;
  hash: string | null = null;
  private scene: VisionSceneHandle | null = null;
  private animation: Record<string, unknown> = {};
  record(
    document: LSMLDocument | null,
    hash: string | null,
    scene: VisionSceneHandle | null,
  ): void {
    if (hash !== this.hash || scene !== this.scene) this.animation = {};
    this.document = document;
    this.hash = hash;
    this.scene = scene;
  }
  async scalar(
    scene: VisionSceneHandle,
    patch: Record<string, unknown>,
    document: LSMLDocument,
    hash: unknown,
    check: () => void,
    publish: () => void,
  ): Promise<void> {
    check();
    if (typeof hash !== "string")
      throw new Error("NATIVE_PRESENTATION_HASH_REQUIRED");
    const effective = changedPresentationPatch(
      patch,
      this.document?.defaults ?? {},
    );
    if (Object.keys(effective).length) {
      await scene.applyPatch(effective);
      this.animation = {};
    }
    check();
    const changed = hash !== this.hash || scene !== this.scene;
    this.record(document, hash, scene);
    if (changed) publish();
  }
  async animate(
    frames: readonly AnimationFrame[],
    scene: VisionSceneHandle,
    isCurrent: () => boolean,
    publish: (document: LSMLDocument, hash: string) => void,
  ): Promise<void> {
    const document = this.document,
      hash = this.hash;
    if (!document || !hash || this.scene !== scene || !isCurrent()) return;
    const patch = animationPatch(document, frames, true);
    if (!Object.keys(changedPresentationPatch(patch, this.animation)).length)
      return;
    await scene.applyPatch(patch);
    if (
      !isCurrent() ||
      this.document !== document ||
      this.hash !== hash ||
      this.scene !== scene
    )
      return;
    this.animation = patch;
    publish(document, hash);
  }
}
