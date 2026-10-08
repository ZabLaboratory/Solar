import { readNativeAuthoringSource } from "../scenes/local-authoring";
import type { MountOptions } from "../types";
import {
  NativeSceneAssets,
  type LSMLDocument,
} from "../scenes/native-document";
import { mountVisionScene, type VisionSceneHandle } from "./vision-presenter";

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

  async prepare(
    document: LSMLDocument,
    check: () => void,
    signal: AbortSignal,
    activeAssets: NativeSceneAssets | null,
  ): Promise<{ scene: VisionSceneHandle; assets: NativeSceneAssets }> {
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
    const [renderPackage, hostFonts] = await Promise.all([
      assets
        .renderPackage(
          document,
          signal,
          this.options.nativeComposition,
          true,
          true,
        )
        .then((result) => {
          this.measure("package", started, { sceneId: document.scene_id });
          return result;
        }),
      Promise.resolve(this.options.fontAssetsProvider?.(signal)).then(
        (result) => {
          this.measure("fonts", started, { sceneId: document.scene_id });
          return result;
        },
      ),
    ]);
    check();
    started = performance.now();
    let scene: VisionSceneHandle | null = null;
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
    try {
      check();
      await scene.flush?.();
      this.measure("vision", started, { sceneId: document.scene_id });
      check();
      return { scene, assets };
    } catch (error) {
      scene.dispose();
      throw error;
    }
  }
}
