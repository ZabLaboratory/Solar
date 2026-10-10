import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createCanvasSceneSourceProvider,
  type CanvasSceneSourceOptions,
} from "../scenes/canvas";
import { sceneSourceKey } from "../scenes/cache";
import {
  synchronizeSceneSources,
  type SceneCacheSync,
} from "../scenes/startup";
import { FileSceneSourceStore } from "./scene-store";

/** Disk source library. No Vision instance, graph or live mutation is retained. */
export class SceneSourceLibrary {
  private readonly root: string;
  private readonly store: FileSceneSourceStore;
  private versions = new Map<string, string>();
  private syncing: Promise<SceneCacheSync> | null = null;
  constructor(root: string, gateway: string, account: string) {
    if (!account) throw new Error("SOURCE_CACHE_ACCOUNT_REQUIRED");
    const namespace = createHash("sha256")
      .update(JSON.stringify([new URL(gateway).href, account]))
      .digest("hex");
    this.root = resolve(root, namespace);
    this.store = new FileSceneSourceStore(this.root);
  }
  /** A saved index is informational; each launch must re-authorize the catalogue. */
  synchronize(
    options: CanvasSceneSourceOptions,
    signal: AbortSignal,
  ): Promise<SceneCacheSync> {
    if (this.syncing) return this.syncing;
    this.syncing = this.sync(options, signal).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }
  private async sync(
    options: CanvasSceneSourceOptions,
    signal: AbortSignal,
  ): Promise<SceneCacheSync> {
    const next = new Map<string, string>();
    const report = await synchronizeSceneSources(
      options,
      createCanvasSceneSourceProvider({ ...options, store: this.store }),
      this.store,
      signal,
      Number.MAX_SAFE_INTEGER,
      { onSource: (id, version) => next.set(id, version) },
    );
    signal.throwIfAborted();
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `${randomUUID()}.index.tmp`);
    try {
      await writeFile(
        temporary,
        JSON.stringify({
          schema: "solar.scene-library.v1",
          scenes: Object.fromEntries(next),
        }),
        { flag: "wx" },
      );
      signal.throwIfAborted();
      await rename(temporary, join(this.root, "index.json"));
    } finally {
      await rm(temporary, { force: true });
    }
    signal.throwIfAborted();
    this.versions = next;
    const retained = new Set(
      [...next].map(
        ([id, version]) => `${sceneSourceKey(id, version, "lsmlz")}.scene`,
      ),
    );
    for (const name of await readdir(this.root)) {
      signal.throwIfAborted();
      if (/^[a-f0-9]{64}\.scene$/.test(name) && !retained.has(name))
        await rm(join(this.root, name), { force: true });
    }
    return report;
  }
  /** Only current, authorized, published revisions are exposed to the browser. */
  async read(sceneId: string, version: string): Promise<Uint8Array | null> {
    if (this.versions.get(sceneId) !== version) return null;
    return this.store.read(sceneSourceKey(sceneId, version, "lsmlz"));
  }
  revoke(): void {
    this.versions.clear();
  }
}
