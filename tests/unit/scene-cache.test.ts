import { describe, expect, it, vi } from "vitest";
import { canonicalize } from "@lumencast/canonical";
import { strToU8, zipSync, unzipSync } from "fflate";
import {
  createCachedSceneSourceProvider,
  decodeSceneSource,
  encodeSceneSource,
} from "../../src/scenes/cache";
import type { SceneSourceStore } from "../../src/scenes/cache";

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
const hash = (bytes: Uint8Array) => `sha256:${bytesToHex(sha256(bytes))}`;
import { cacheSource as source } from "../helpers/cache-source";
function storage(): SceneSourceStore & { records: Map<string, Uint8Array> } {
  const records = new Map<string, Uint8Array>();
  return {
    records,
    async read(key) {
      return records.get(key) ?? null;
    },
    async write(key, bytes) {
      records.set(key, bytes);
    },
  };
}
describe("immutable source cache", () => {
  it.each(["lsml", "lsmlz"] as const)(
    "loads %s offline with assets and Blue closure and isolates caller mutations",
    async (format) => {
      const published = await source(format);
      const get = vi.fn(async () => published);
      const store = storage();
      const provider = createCachedSceneSourceProvider({ get }, store);
      const first = await provider.get(published.sceneId, { format });
      first.data.fill(0);
      first.blueManifest.binding_closure = [];
      get.mockRejectedValue(new Error("offline"));
      const loaded = await provider.get(published.sceneId, {
        format,
        sceneVersion: published.sceneVersion,
      });
      expect(loaded.data).toEqual(published.data);
      expect(loaded.blueManifest.binding_closure).toHaveLength(1);
      expect(get).toHaveBeenCalledOnce();
      await expect(provider.get(published.sceneId, { format })).rejects.toThrow(
        "offline",
      );
    },
  );
  it("refuses source mutations even with a recomputed byte digest", async () => {
    const delivery = await source("lsml");
    const document = JSON.parse(new TextDecoder().decode(delivery.data));
    document.defaults.title = "live mutation";
    delivery.data = strToU8(canonicalize(document));
    delivery.sourceDigest = hash(delivery.data);
    expect(() => encodeSceneSource(delivery)).toThrow(
      "SOURCE_INTEGRITY_FAILED",
    );
  });
  it("refuses altered closure, missing closure and corrupt assets without network fallback", async () => {
    const published = await source();
    const store = storage();
    const get = vi.fn(async () => published);
    const provider = createCachedSceneSourceProvider({ get }, store);
    await provider.get(published.sceneId);
    const [key, bytes] = [...store.records][0]!;
    const files = unzipSync(bytes);
    files.source![0] = 0;
    store.records.set(key, zipSync(files));
    await expect(
      provider.get(published.sceneId, { sceneVersion: published.sceneVersion }),
    ).rejects.toThrow("SOURCE_INTEGRITY_FAILED");
    expect(get).toHaveBeenCalledOnce();
    const invalid = await source();
    invalid.blueManifest.binding_closure = [];
    expect(() => encodeSceneSource(invalid)).toThrow("SOURCE_INTEGRITY_FAILED");
    invalid.blueManifest.readiness.offline_ready = false;
    expect(() => encodeSceneSource(invalid)).toThrow("SOURCE_INTEGRITY_FAILED");
    const plain = await source("lsml");
    plain.assets.values().next().value!.fill(0);
    expect(() => encodeSceneSource(plain)).toThrow("SOURCE_INTEGRITY_FAILED");
  });
  it("rejects wrong pinned identity and cancellation before publication", async () => {
    const published = await source();
    const store = storage();
    const aborted = new AbortController();
    const provider = createCachedSceneSourceProvider(
      {
        async get() {
          aborted.abort();
          return published;
        },
      },
      store,
    );
    await expect(
      provider.get(published.sceneId, { signal: aborted.signal }),
    ).rejects.toThrow();
    expect(store.records.size).toBe(0);
    expect(decodeSceneSource(encodeSceneSource(published)).sceneVersion).toBe(
      published.sceneVersion,
    );
    await expect(provider.get("another-id")).rejects.toThrow(
      "SOURCE_INTEGRITY_FAILED",
    );
  });
});
