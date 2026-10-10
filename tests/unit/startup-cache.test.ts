import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import {
  BrowserSceneSourceStore,
  sceneCacheNamespace,
} from "../../src/scenes/browser-store";
import {
  createStartupSceneSourceProvider,
  synchronizeSceneSources,
} from "../../src/scenes/startup";
import { cacheSource } from "../helpers/cache-source";
import { sceneSourceKey } from "../../src/scenes/cache";
import { SceneSourceError } from "../../src/scenes/types";

it("counts editable and unpublished entries without fabricating published sources", async () => {
  const get = vi.fn(async () => {
    throw new SceneSourceError("SOURCE_NOT_PUBLISHED");
  });
  const write = vi.fn(async () => {});
  const result = await synchronizeSceneSources(
    {
      apiUrl: "https://canvas/api/v1",
      fetch: async () =>
        Response.json({
          items: [
            { id: "editable", scene_type: "editable" },
            { id: "draft", scene_type: "standard" },
          ],
          next_offset: null,
        }),
    },
    { get },
    { read: async () => null, write },
    new AbortController().signal,
  );
  expect(result).toEqual({
    discovered: 2,
    cached: 0,
    skipped: 2,
    failures: [],
    truncated: false,
  });
  expect(get).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
});

it("isolates credentials, supports concurrent immutable writes and survives reopening", async () => {
  const factory = new IDBFactory();
  const a = sceneCacheNamespace("https://canvas/api/v1", "account-a");
  const b = sceneCacheNamespace("https://canvas/api/v1", "account-b");
  const store = new BrowserSceneSourceStore(a, { factory });
  const peer = new BrowserSceneSourceStore(a, { factory });
  const other = new BrowserSceneSourceStore(b, { factory });
  const key = "a".repeat(64),
    bytes = new Uint8Array([1, 2, 3]);
  await Promise.all([store.write(key, bytes), peer.write(key, bytes)]);
  await expect(other.read(key)).resolves.toBeNull();
  await expect(store.write(key, new Uint8Array([3, 2, 1]))).rejects.toThrow(
    "SOURCE_CACHE_KEY_CONFLICT",
  );
  await store.close();
  expect(await store.read(key)).toEqual(bytes);
  await Promise.all([store.close(), peer.close(), other.close()]);
});

it("evicts by access within quota and rejects oversized writes atomically", async () => {
  const store = new BrowserSceneSourceStore("a".repeat(64), {
    factory: new IDBFactory(),
    maxBytes: 6,
    maxEntries: 2,
  });
  const a = "a".repeat(64),
    b = "b".repeat(64),
    c = "c".repeat(64);
  vi.spyOn(Date, "now").mockReturnValue(1);
  await store.write(a, new Uint8Array(3));
  vi.mocked(Date.now).mockReturnValue(2);
  await store.write(b, new Uint8Array(3));
  vi.mocked(Date.now).mockReturnValue(3);
  await store.read(a);
  vi.mocked(Date.now).mockReturnValue(4);
  await store.write(c, new Uint8Array(3));
  expect(await store.read(b)).toBeNull();
  await expect(store.write(a, new Uint8Array(7))).rejects.toThrow(
    "SOURCE_CACHE_QUOTA",
  );
  expect(await store.read(a)).toHaveLength(3);
  await store.close();
  vi.restoreAllMocks();
});

it("startup sync uses the actual paginated Canvas schema, retains closure/assets and then reads offline", async () => {
  const delivery = await cacheSource();
  const store = new BrowserSceneSourceStore("b".repeat(64), {
    factory: new IDBFactory(),
  });
  const get = vi.fn(async () => delivery);
  const fetcher = vi.fn(
    async (url: URL | RequestInfo, options?: RequestInit) => {
      expect(String(url)).toContain(
        "/api/v1/scenes?mine=false&limit=50&offset=0",
      );
      expect(options?.headers).toEqual({
        Authorization: "Bearer account-token",
      });
      return new Response(
        JSON.stringify({
          items: [{ id: delivery.sceneId }],
          next_offset: null,
        }),
      );
    },
  );
  expect(
    await synchronizeSceneSources(
      {
        apiUrl: "https://canvas/api/v1",
        token: "account-token",
        fetch: fetcher,
      },
      { get },
      store,
      new AbortController().signal,
    ),
  ).toEqual({
    discovered: 1,
    cached: 1,
    skipped: 0,
    failures: [],
    truncated: false,
  });
  get.mockRejectedValue(new Error("offline"));
  const loaded = await createStartupSceneSourceProvider({ get }, store).get(
    delivery.sceneId,
    { sceneVersion: delivery.sceneVersion },
  );
  expect(loaded.blueManifest.binding_closure).toHaveLength(1);
  expect(loaded.data).toEqual(delivery.data);
  expect(get).toHaveBeenCalledOnce();
  await store.close();
});

it("does not silently use corrupt bytes and does not persist incomplete Blue preparation", async () => {
  const delivery = await cacheSource();
  const store = new BrowserSceneSourceStore("c".repeat(64), {
    factory: new IDBFactory(),
  });
  const key = sceneSourceKey(
    delivery.sceneId,
    delivery.sceneVersion,
    delivery.format,
  );
  await store.write(key, new Uint8Array([0]));
  const get = vi.fn(async () => delivery);
  await expect(
    createStartupSceneSourceProvider({ get }, store).get(delivery.sceneId, {
      sceneVersion: delivery.sceneVersion,
    }),
  ).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
  await store.close();
  const write = vi.fn();
  delivery.blueManifest.readiness.offline_ready = false;
  expect(
    await createStartupSceneSourceProvider(
      { get },
      { read: async () => null, write },
    ).get(delivery.sceneId),
  ).toBe(delivery);
  expect(write).not.toHaveBeenCalled();
});

it("bounds malformed pagination, catalog bytes and propagates cancellation", async () => {
  const options = {
    apiUrl: "https://canvas/api/v1",
    fetch: vi.fn(
      async () => new Response(JSON.stringify({ items: [], next_offset: 0 })),
    ),
  };
  const store = { read: async () => null, write: async () => {} },
    provider = { get: vi.fn() };
  await expect(
    synchronizeSceneSources(
      options,
      provider,
      store,
      new AbortController().signal,
    ),
  ).rejects.toThrow("SOURCE_CACHE_CATALOG_INVALID");
  options.fetch.mockImplementation(
    async () => new Response(" ".repeat(512 * 1024 + 1)),
  );
  await expect(
    synchronizeSceneSources(
      options,
      provider,
      store,
      new AbortController().signal,
    ),
  ).rejects.toThrow("SOURCE_CACHE_CATALOG_LIMIT");
  const controller = new AbortController();
  controller.abort();
  await expect(
    synchronizeSceneSources(options, provider, store, controller.signal),
  ).rejects.toThrow();
  expect(provider.get).not.toHaveBeenCalled();
});
