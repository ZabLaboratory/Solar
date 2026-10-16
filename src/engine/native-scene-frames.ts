import { readNativeAuthoringSource } from "../scenes/local-authoring";
import { acquireInstanceSources } from "../scenes/instances";
import type { MountOptions } from "../types";
import {
  NativeSceneAssets,
  type LSMLDocument,
} from "../scenes/native-document";
import {
  mountVisionScene,
  visionMaxTextureSize,
  type VisionSceneHandle,
} from "./vision-presenter";
import type { NativeCompositionProjection } from "../scenes/native-composition";
import { prepareNativeComposition } from "../scenes/native-composition";

/** Prepare the active scene; inactive sources and GPU frames are never retained. */
export class NativeSceneFrames {
  constructor(
    private readonly options: MountOptions,
    private readonly onMedia: (scene: VisionSceneHandle) => void,
    private readonly onError: (error: unknown) => void,
    private readonly signal: () => AbortSignal | undefined,
    private readonly measure: (
      stage: string,
      start: number,
      extra?: Record<string, unknown>,
    ) => void,
  ) {}

  retire(scene: VisionSceneHandle): void {
    scene.dispose();
  }

  /** Recompute compositor metadata for a scalar LSML update without loading a scene. */
  projectComposition(
    document: LSMLDocument,
  ): NativeCompositionProjection | null {
    const viewport = this.options.nativeComposition;
    if (!viewport) return null;
    return prepareNativeComposition(
      structuredClone(document),
      viewport,
      visionMaxTextureSize(this.options.target),
    );
  }

  async prepare(
    document: LSMLDocument,
    check: () => void,
    signal: AbortSignal,
    activeAssets: NativeSceneAssets | null,
  ): Promise<{
    scene: VisionSceneHandle;
    assets: NativeSceneAssets;
    composition: NativeCompositionProjection | null;
  }> {
    let started = performance.now();
    let assets = activeAssets;
    if (
      !assets ||
      assets.origin.sceneId !== document.scene_id ||
      assets.origin.sceneVersion !== document.scene_version
    ) {
      const request = {
        format: "lsmlz" as const,
        sceneVersion: document.scene_version,
        signal,
      };
      const local = await readNativeAuthoringSource(document);
      const origin =
        local ??
        (await this.options.sceneSourceProvider.get(
          document.scene_id,
          request,
        ));
      check();
      if (
        origin.sceneId !== document.scene_id ||
        origin.sceneVersion !== document.scene_version
      )
        throw new Error("Native resource source identity mismatch.");
      assets = new NativeSceneAssets(
        origin,
        globalThis.fetch.bind(globalThis),
        this.options.sceneImageAssetsProvider,
        (start) =>
          this.measure("images", start, { sceneId: document.scene_id }),
      );
    }
    this.measure("source", started, { sceneId: document.scene_id });
    started = performance.now();
    const nativeComposition = this.options.nativeComposition
      ? {
          ...this.options.nativeComposition,
          maxTextureSize: visionMaxTextureSize(this.options.target),
        }
      : undefined;
    const instanceSources = acquireInstanceSources(
      document,
      this.options.sceneSourceProvider,
      signal,
    );
    const renderPackagePromise = assets
      .renderPackage(
        document,
        signal,
        nativeComposition,
        true,
        true,
        instanceSources,
      )
      .then((result) => {
        this.measure("package", started, { sceneId: document.scene_id });
        return result;
      });
    const hostFontsPromise = Promise.resolve(
      this.options.fontAssetsProvider?.(signal),
    ).then((result) => {
      this.measure("fonts", started, { sceneId: document.scene_id });
      return result;
    });
    let renderPackage: Awaited<typeof renderPackagePromise>;
    let hostFonts: Awaited<typeof hostFontsPromise>;
    try {
      [renderPackage, hostFonts] = await Promise.all([
        renderPackagePromise,
        hostFontsPromise,
      ]);
    } catch (error) {
      void renderPackagePromise.then(
        (result) => result.release?.(),
        () => {},
      );
      throw error;
    }
    started = performance.now();
    let scene: VisionSceneHandle | null = null;
    try {
      check();
      scene = await mountVisionScene(
        this.options.target,
        assets.origin,
        {},
        () => {
          if (scene) this.onMedia(scene);
        },
        this.onError,
        {
          ...renderPackage,
          hostFonts: [...(renderPackage.hostFonts ?? []), ...(hostFonts ?? [])],
          installationFonts: this.options.installationFonts,
          requiredFontDigests:
            "provenance" in assets.origin ? assets.origin.fontDigests : [],
          resolveImages: (patch) =>
            assets!.prepareImagePatch(
              patch,
              renderPackage.imageBindings,
              document,
              this.signal(),
            ),
        },
        true,
      );
      check();
      await scene.flush?.();
      this.measure("vision", started, { sceneId: document.scene_id });
      check();
      return {
        scene,
        assets,
        composition: renderPackage.surface?.composition ?? null,
      };
    } catch (error) {
      scene?.dispose();
      throw error;
    } finally {
      renderPackage.release?.();
    }
  }
}
