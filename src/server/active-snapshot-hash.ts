import { NativeState } from "../internal/native-state";
import { nativeTreeHash, NativeTreeHasher } from "../internal/native-tree";

/** Reuse verified subtree digests only for the currently read LSML identity. */
export class ActiveSnapshotHash {
  private readonly resources = new Map<
    string,
    { sceneId: string; sceneVersion: string; hasher: NativeTreeHasher }
  >();

  hash(
    target: string,
    state: unknown,
    isScene: boolean,
    alreadyValidatedLSDP = false,
  ): string {
    const document =
      state && typeof state === "object" && !Array.isArray(state)
        ? (state as Record<string, unknown>)
        : null;
    if (
      !isScene ||
      typeof document?.scene_id !== "string" ||
      typeof document.scene_version !== "string"
    ) {
      this.resources.delete(target);
      return nativeTreeHash(state);
    }
    let current = this.resources.get(target);
    if (
      !current ||
      current.sceneId !== document.scene_id ||
      current.sceneVersion !== document.scene_version
    ) {
      current = {
        sceneId: document.scene_id,
        sceneVersion: document.scene_version,
        hasher: new NativeTreeHasher(),
      };
      this.resources.set(target, current);
    }
    // The wire parser has already validated fresh decoded values. Hash without
    // retaining their mutable identities; all other callers use full validation.
    return alreadyValidatedLSDP
      ? current.hasher.hashFreshLSDP(state)
      : NativeState.from(state, current.hasher).stateHash;
  }

  clear(): void {
    this.resources.clear();
  }
}
