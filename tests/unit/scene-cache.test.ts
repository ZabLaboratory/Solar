import { describe, expect, it, vi } from "vitest";
import { canonicalize } from "@lumencast/canonical";
import { strToU8, zipSync, unzipSync } from "fflate";
import {
  createCachedSceneSourceProvider,
  decodeSceneSource,
  encodeSceneSource,
  verifySceneSource,
} from "../../src/scenes/cache";
import type { SceneSourceStore } from "../../src/scenes/cache";

import { sha1 } from "@noble/hashes/sha1";
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

function duplicateFirstZipEntry(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let offset = bytes.byteLength - 22;
    offset >= bytes.byteLength - 65_557;
    offset--
  ) {
    if (offset < 0) break;
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP end record not found");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  const recordNameLength = view.getUint16(centralOffset + 28, true);
  const recordExtraLength = view.getUint16(centralOffset + 30, true);
  const recordCommentLength = view.getUint16(centralOffset + 32, true);
  const recordLength =
    46 + recordNameLength + recordExtraLength + recordCommentLength;
  const centralEnd = centralOffset + centralSize;
  const result = new Uint8Array(bytes.byteLength + recordLength);
  result.set(bytes.subarray(0, centralEnd));
  result.set(
    bytes.subarray(centralOffset, centralOffset + recordLength),
    centralEnd,
  );
  result.set(bytes.subarray(centralEnd), centralEnd + recordLength);
  const updated = new DataView(result.buffer);
  const shiftedEnd = end + recordLength;
  updated.setUint16(shiftedEnd + 8, count + 1, true);
  updated.setUint16(shiftedEnd + 10, count + 1, true);
  updated.setUint32(shiftedEnd + 12, centralSize + recordLength, true);
  return result;
}

function corruptFirstZipPayload(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes);
  const view = new DataView(result.buffer);
  let end = -1;
  for (
    let offset = result.byteLength - 22;
    offset >= result.byteLength - 65_557;
    offset--
  ) {
    if (offset < 0) break;
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP end record not found");
  const centralOffset = view.getUint32(end + 16, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const payloadOffset = localOffset + 30 + nameLength + extraLength;
  result[payloadOffset] = result[payloadOffset]! ^ 0xff;
  return result;
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
  it("keeps LSMLZ and LSML cache requests in separate format lanes", async () => {
    const root = await source("lsmlz");
    const child = await source("lsml");
    const requests: Array<{ sceneId: string; format: string }> = [];
    const upstream = {
      async get(sceneId: string, request: { format?: "lsml" | "lsmlz" } = {}) {
        requests.push({ sceneId, format: request.format ?? "lsmlz" });
        return request.format === "lsml" ? child : root;
      },
    };
    const store = storage();
    const provider = createCachedSceneSourceProvider(upstream, store);

    expect(
      (await provider.get(root.sceneId, { format: "lsmlz" })).format,
    ).toBe("lsmlz");
    expect(
      (
        await provider.get(child.sceneId, {
          sceneVersion: child.sceneVersion,
          format: "lsml",
        })
      ).format,
    ).toBe("lsml");
    expect(requests).toEqual([
      { sceneId: root.sceneId, format: "lsmlz" },
      { sceneId: root.sceneId, format: "lsml" },
    ]);
    expect(store.records.size).toBe(2);
  });
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

  it("accepts safe named and legacy SHA-1 package paths while checking recognized hashes", async () => {
    const published = await source("lsmlz");
    const files = unzipSync(published.data);
    const namedBytes = strToU8("named package image");
    const legacyBytes = strToU8("legacy sha1 package font");
    const legacyPath = `assets/${bytesToHex(sha1(legacyBytes))}.woff2`;
    files["assets/legacy/child-image.png"] = namedBytes;
    files[legacyPath] = legacyBytes;
    published.data = zipSync(files, { level: 0 });
    expect(
      verifySceneSource(published, { requireOfflineReady: false })
        .expandedBytes,
    ).toBeGreaterThan(namedBytes.byteLength + legacyBytes.byteLength);
    expect(decodeSceneSource(encodeSceneSource(published)).data).toEqual(
      published.data,
    );

    const invalid = await source("lsml");
    invalid.assets = new Map([
      ...invalid.assets,
      [`assets/${"0".repeat(40)}.woff2`, legacyBytes],
      [`assets/${"0".repeat(64)}.png`, namedBytes],
    ]);
    expect(() =>
      verifySceneSource(invalid, { requireOfflineReady: false }),
    ).toThrow("SOURCE_INTEGRITY_FAILED");
  });

  it("rejects corrupt, duplicate, and traversal archive entries before delivery", async () => {
    const published = await source("lsmlz");
    const files = unzipSync(published.data);
    const corrupt = {
      ...published,
      data: corruptFirstZipPayload(published.data),
    };
    expect(() =>
      verifySceneSource(corrupt, { requireOfflineReady: false }),
    ).toThrow("SOURCE_INTEGRITY_FAILED");

    const duplicate = {
      ...published,
      data: duplicateFirstZipEntry(published.data),
    };
    expect(() =>
      verifySceneSource(duplicate, { requireOfflineReady: false }),
    ).toThrow("SOURCE_INTEGRITY_FAILED");

    const caseDuplicate = {
      ...published,
      data: zipSync({
        "scene.lsml": files["scene.lsml"]!,
        "SCENE.LSML": files["scene.lsml"]!,
      }),
    };
    expect(() =>
      verifySceneSource(caseDuplicate, { requireOfflineReady: false }),
    ).toThrow("SOURCE_INTEGRITY_FAILED");

    const traversal = {
      ...published,
      data: zipSync({
        "scene.lsml": files["scene.lsml"]!,
        "../escape.bin": strToU8("x"),
      }),
    };
    expect(() =>
      verifySceneSource(traversal, { requireOfflineReady: false }),
    ).toThrow("SOURCE_INTEGRITY_FAILED");

    const longPath = {
      ...published,
      data: zipSync({
        "scene.lsml": files["scene.lsml"]!,
        [`assets/${"a".repeat(1020)}.png`]: strToU8("x"),
      }),
    };
    expect(() =>
      verifySceneSource(longPath, { requireOfflineReady: false }),
    ).toThrow("SOURCE_INTEGRITY_FAILED");
  });

  it("checks named LSML asset transport digests on cache reads without changing source identity", async () => {
    const published = await source("lsml");
    const namedBytes = strToU8("named standalone child asset");
    published.assets = new Map([
      ...published.assets,
      ["assets/legacy/child-image.png", namedBytes],
    ]);
    const encoded = encodeSceneSource(published);
    expect(decodeSceneSource(encoded)).toMatchObject({
      sceneId: published.sceneId,
      sceneVersion: published.sceneVersion,
      sourceDigest: published.sourceDigest,
      format: "lsml",
    });

    const capsule = unzipSync(encoded);
    capsule["assets/legacy/child-image.png"]![0] =
      capsule["assets/legacy/child-image.png"]![0]! ^ 0xff;
    expect(() => decodeSceneSource(zipSync(capsule, { level: 0 }))).toThrow(
      "SOURCE_INTEGRITY_FAILED",
    );
  });
});
