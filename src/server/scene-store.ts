import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { SceneSourceStore } from "../scenes/cache";

/** Content-pinned source capsules only. The caller owns synchronization/eviction. */
export class FileSceneSourceStore implements SceneSourceStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new TypeError("Invalid scene cache key.");
    return resolve(this.root, `${key}.scene`);
  }
  async read(key: string): Promise<Uint8Array | null> {
    const path = this.path(key);
    try {
      if ((await stat(path)).size > 132 * 1024 * 1024)
        throw new Error("Scene cache capsule is too large.");
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async write(key: string, value: Uint8Array): Promise<void> {
    const path = this.path(key);
    if (value.byteLength > 132 * 1024 * 1024)
      throw new Error("Scene cache capsule is too large.");
    await mkdir(this.root, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, value, { flag: "wx" });
      // Publish once: immutable keys must never overwrite an accepted capsule.
      // Atomic link also avoids Windows concurrent rename-overwrite failures.
      try {
        await link(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readFile(path);
        if (!existing.equals(Buffer.from(value)))
          throw new Error("SOURCE_CACHE_KEY_CONFLICT");
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
