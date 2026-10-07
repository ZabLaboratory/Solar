import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSceneSourceStore } from "../../src/server/scene-store";

describe("application-owned file scene store", () => {
  it("publishes whole capsules atomically and leaves no staging files", async () => {
    const base = join(tmpdir(), "codex-zab", "solar-scene-cache");
    await mkdir(base, { recursive: true });
    const directory = await mkdtemp(join(base, "unit-"));
    try {
      const store = new FileSceneSourceStore(directory);
      const key = "a".repeat(64);
      expect(await store.read(key)).toBeNull();
      const one = new Uint8Array(8192).fill(1);
      const two = new Uint8Array(8192).fill(2);
      await Promise.all([store.write(key, one), store.write(key, one)]);
      await expect(store.write(key, two)).rejects.toThrow("SOURCE_CACHE_KEY_CONFLICT");
      const result = await store.read(key);
      expect(result?.byteLength).toBe(8192);
      expect(new Set(result)).toEqual(new Set([result![0]]));
      expect(await readdir(directory)).toEqual([`${key}.scene`]);
      await expect(store.read("../escape")).rejects.toThrow(
        "Invalid scene cache key",
      );
      await expect(store.write("../escape", one)).rejects.toThrow(
        "Invalid scene cache key",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
