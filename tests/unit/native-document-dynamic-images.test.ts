import { describe, expect, it, vi } from "vitest";
import { strToU8 } from "fflate";
import { NativeSceneAssets } from "../../src/scenes/native-document";
import type { SceneSourceDelivery } from "../../src/scenes/types";
import { nativeManifest } from "../helpers/native-source";

const version = `sha256:${"1".repeat(64)}`;
const document = {
  lsml: "1.1",
  scene_id: "native-scene",
  scene_version: version,
  layout: { type: "frame", children: [] },
  defaults: { "__lit.text.title": "before", "a/b~c": [1, 2] },
};
describe("dynamic image lifetime", () => {
  it("does not exhaust URL admission when one bound image changes 512 times", async () => {
    const scene = {
      ...document,
      assets: { allowedHosts: ["images.example"] },
      defaults: { logo: "" },
      layout: { kind: "image", bind: { src: "logo" } },
    };
    const origin: SceneSourceDelivery = {
      sceneId: scene.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(scene.scene_id, version),
    };
    const source = new Uint8Array(origin.data);
    // Repeated bytes isolate Solar's historical URL limit from Vision's
    // separate historical content/texture limit. No browser decode is involved.
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImage = vi.fn(
      async () =>
        new Response(bytes, {
          headers: { "content-type": "image/png" },
        }),
    );
    const assets = new NativeSceneAssets(origin, fetchImage as typeof fetch);
    const rendered = await assets.renderPackage(scene);
    for (let i = 0; i < 512; i++) {
      const patch = await assets.prepareImagePatch(
        { logo: `https://images.example/avatar-${i}.png` },
        rendered.imageBindings,
        scene,
      );
      expect(patch.assets).toHaveLength(1);
      expect(patch.assets[0]!.bytes).toEqual(bytes);
      patch.release();
    }
    expect(fetchImage).toHaveBeenCalledTimes(512);
    const cache = assets as unknown as {
      remote: Map<string, unknown>;
      dynamicImages: Map<string, unknown>;
      dynamicImageBytes: number;
      files: Record<string, Uint8Array>;
    };
    expect(cache.remote.size).toBeLessThanOrEqual(128);
    expect(cache.dynamicImages.size).toBe(1);
    expect(cache.dynamicImageBytes).toBe(bytes.byteLength);
    expect(Object.keys(cache.files)).toEqual([
      "assets/__solar-empty-image.png",
    ]);
    expect(origin.data).toEqual(source);
    expect(scene.defaults.logo).toBe("");
  });

  it("pins deduplicated concurrent images until every coalesced patch is submitted", async () => {
    const scene = {
      ...document,
      assets: { allowedHosts: ["images.example"] },
      defaults: { first: "", second: "" },
      layout: {
        kind: "stack",
        children: [
          { kind: "image", bind: { src: "first" } },
          { kind: "image", bind: { src: "second" } },
        ],
      },
    };
    const origin: SceneSourceDelivery = {
      sceneId: scene.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(scene.scene_id, version),
    };
    const image = new Uint8Array([7, 8, 9]);
    const fetchImage = vi.fn(
      async () =>
        new Response(image, { headers: { "content-type": "image/png" } }),
    );
    const assets = new NativeSceneAssets(origin, fetchImage as typeof fetch);
    const rendered = await assets.renderPackage(scene);
    const patch = await assets.prepareImagePatch(
      {
        first: "https://images.example/shared.png",
        second: "https://images.example/shared.png",
      },
      rendered.imageBindings,
      scene,
    );
    expect(fetchImage).toHaveBeenCalledOnce();
    expect(patch.values.first).toBe(patch.values.second);
    expect(patch.assets).toHaveLength(1);
    const cache = assets as unknown as {
      dynamicImages: Map<string, { references: number }>;
    };
    expect([...cache.dynamicImages.values()][0]!.references).toBe(2);
    patch.release();
    expect([...cache.dynamicImages.values()][0]!.references).toBe(0);
  });

  it("admits a sixteen-image batch by actual bytes while a ninth request replaces one completed fetch", async () => {
    const names = Array.from({ length: 16 }, (_, index) => `image${index}`);
    const scene = {
      ...document,
      assets: { allowedHosts: ["images.example"] },
      defaults: Object.fromEntries(names.map((name) => [name, ""])),
      layout: {
        kind: "stack",
        children: names.map((name) => ({
          kind: "image",
          bind: { src: name },
        })),
      },
    };
    const origin: SceneSourceDelivery = {
      sceneId: scene.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(scene.scene_id, version),
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const pending = new Map<number, (response: Response) => void>();
    const fetchImage = vi.fn((url: RequestInfo | URL) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const index = Number(String(url).match(/image(\d+)/)?.[1] ?? 0);
      return new Promise<Response>((resolve) => {
        pending.set(index, (response) => {
          inFlight--;
          resolve(response);
        });
      });
    });
    const assets = new NativeSceneAssets(origin, fetchImage as typeof fetch);
    const rendered = await assets.renderPackage(scene);
    const preparing = assets.prepareImagePatch(
      Object.fromEntries(
        names.map((name, index) => [
          name,
          `https://images.example/image${index}.png`,
        ]),
      ),
      rendered.imageBindings,
      scene,
    );
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(8));
    const responseFor = (index: number) =>
      new Response(new Uint8Array([index + 1]), {
        headers: { "content-type": "image/png" },
      });
    pending.get(0)!(responseFor(0));
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(9));
    const cache = assets as unknown as {
      dynamicImageBytes: number;
      pendingImageAssets: number;
      pendingImageBytes: number;
    };
    expect(cache.pendingImageAssets).toBe(8);
    expect(cache.pendingImageBytes).toBe(0);
    expect(cache.dynamicImageBytes).toBe(1);
    for (let index = 1; index < names.length; index++) {
      await vi.waitFor(() => expect(pending.has(index)).toBe(true));
      pending.get(index)!(responseFor(index));
    }
    const patch = await preparing;
    expect(fetchImage).toHaveBeenCalledTimes(16);
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(patch.assets).toHaveLength(16);
    expect(cache.pendingImageAssets).toBe(0);
    expect(cache.pendingImageBytes).toBe(0);
    patch.release();
  });

  it("cancels an oversized response stream and releases its pending slot and bytes", async () => {
    const scene = {
      ...document,
      assets: { allowedHosts: ["images.example"] },
      defaults: { logo: "" },
      layout: { kind: "image", bind: { src: "logo" } },
    };
    const origin: SceneSourceDelivery = {
      sceneId: scene.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(scene.scene_id, version),
    };
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImage = vi.fn(
      async () =>
        new Response(body, {
          headers: { "content-type": "image/png" },
        }),
    );
    const assets = new NativeSceneAssets(origin, fetchImage as typeof fetch);
    const rendered = await assets.renderPackage(scene);
    await expect(
      assets.prepareImagePatch(
        { logo: "https://images.example/too-large.png" },
        rendered.imageBindings,
        scene,
      ),
    ).rejects.toThrow("accepted byte limits");
    await vi.waitFor(() => expect(cancelled).toBe(true));
    const cache = assets as unknown as {
      activeImageRequestCount: number;
      dynamicImages: Map<string, unknown>;
      pendingImageAssets: number;
      pendingImageBytes: number;
    };
    expect(cache.activeImageRequestCount).toBe(0);
    expect(cache.dynamicImages.size).toBe(0);
    expect(cache.pendingImageAssets).toBe(0);
    expect(cache.pendingImageBytes).toBe(0);
  });

  it("clears partial stream admission when the request is aborted mid-body", async () => {
    const scene = {
      ...document,
      assets: { allowedHosts: ["images.example"] },
      defaults: { logo: "" },
      layout: { kind: "image", bind: { src: "logo" } },
    };
    const origin: SceneSourceDelivery = {
      sceneId: scene.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(scene.scene_id, version),
    };
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    const controller = new AbortController();
    const fetchImage = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener(
          "abort",
          () => bodyController.error(signal.reason),
          { once: true },
        );
        return new Response(body, {
          headers: { "content-type": "image/png" },
        });
      },
    );
    const assets = new NativeSceneAssets(origin, fetchImage as typeof fetch);
    const rendered = await assets.renderPackage(scene);
    const preparing = assets.prepareImagePatch(
      { logo: "https://images.example/aborted.png" },
      rendered.imageBindings,
      scene,
      controller.signal,
    );
    const cache = assets as unknown as {
      activeImageRequestCount: number;
      pendingImageAssets: number;
      pendingImageBytes: number;
    };
    await vi.waitFor(() => expect(cache.pendingImageBytes).toBe(3));
    controller.abort(new DOMException("Request aborted", "AbortError"));
    await expect(preparing).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImage).toHaveBeenCalledWith(
      "https://images.example/aborted.png",
      { credentials: "omit", signal: controller.signal },
    );
    expect(cache.activeImageRequestCount).toBe(0);
    expect(cache.pendingImageAssets).toBe(0);
    expect(cache.pendingImageBytes).toBe(0);
  });

  it("rejects an over-budget staged image while all cached images are pinned, then reclaims one after release", async () => {
    const scene = {
      ...document,
      assets: { allowedHosts: ["images.example"] },
      defaults: { logo: "" },
      layout: { kind: "image", bind: { src: "logo" } },
    };
    const origin: SceneSourceDelivery = {
      sceneId: scene.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(scene.scene_id, version),
    };
    const fetchImage = vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          new Uint8Array([Number(String(url).match(/image-(\d+)/)?.[1] ?? 0)]),
          {
            headers: { "content-type": "image/png" },
          },
        ),
    );
    const assets = new NativeSceneAssets(origin, fetchImage as typeof fetch);
    const rendered = await assets.renderPackage(scene);
    const pinned = [];
    for (let index = 0; index < 128; index++)
      pinned.push(
        await assets.prepareImagePatch(
          { logo: `https://images.example/image-${index}.png` },
          rendered.imageBindings,
          scene,
        ),
      );
    await expect(
      assets.prepareImagePatch(
        { logo: "https://images.example/image-128.png" },
        rendered.imageBindings,
        scene,
      ),
    ).rejects.toThrow("active/pending limit");
    expect(fetchImage).toHaveBeenCalledTimes(128);
    pinned[0]!.release();
    const reclaimed = await assets.prepareImagePatch(
      { logo: "https://images.example/image-128.png" },
      rendered.imageBindings,
      scene,
    );
    expect(reclaimed.assets).toHaveLength(1);
    reclaimed.release();
    pinned.slice(1).forEach((patch) => patch.release());
    const cache = assets as unknown as {
      dynamicImages: Map<string, unknown>;
      pendingImageAssets: number;
      dynamicImageBytes: number;
    };
    expect(cache.dynamicImages.size).toBe(128);
    expect(cache.pendingImageAssets).toBe(0);
    expect(cache.dynamicImageBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it("keeps concurrent reservations intact when a second request is rejected under pin pressure", async () => {
    const scene = {
      ...document,
      assets: { allowedHosts: ["images.example"] },
      defaults: { logo: "" },
      layout: { kind: "image", bind: { src: "logo" } },
    };
    const origin: SceneSourceDelivery = {
      sceneId: scene.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(scene.scene_id, version),
    };
    let resolvePending!: (response: Response) => void;
    let pendingStarted!: () => void;
    const started = new Promise<void>((resolve) => (pendingStarted = resolve));
    const fetchImage = vi.fn((url: RequestInfo | URL) => {
      const value = String(url);
      if (value.endsWith("pending.png")) {
        pendingStarted();
        return new Promise<Response>((resolve) => (resolvePending = resolve));
      }
      const index = Number(value.match(/image-(\d+)/)?.[1] ?? 0);
      return Promise.resolve(
        new Response(new Uint8Array([index + 1]), {
          headers: { "content-type": "image/png" },
        }),
      );
    });
    const assets = new NativeSceneAssets(origin, fetchImage as typeof fetch);
    const rendered = await assets.renderPackage(scene);
    const pinned = [];
    for (let index = 0; index < 127; index++)
      pinned.push(
        await assets.prepareImagePatch(
          { logo: `https://images.example/image-${index}.png` },
          rendered.imageBindings,
          scene,
        ),
      );
    const admitted = assets.prepareImagePatch(
      { logo: "https://images.example/pending.png" },
      rendered.imageBindings,
      scene,
    );
    await started;
    const rejected = assets.prepareImagePatch(
      { logo: "https://images.example/too-late.png" },
      rendered.imageBindings,
      scene,
    );
    await expect(rejected).rejects.toThrow("active/pending limit");
    const cache = assets as unknown as {
      pendingImageAssets: number;
      pendingImageBytes: number;
    };
    expect(cache.pendingImageAssets).toBe(1);
    expect(cache.pendingImageBytes).toBe(0);
    resolvePending(
      new Response(new Uint8Array([250]), {
        headers: { "content-type": "image/png" },
      }),
    );
    const completed = await admitted;
    completed.release();
    pinned.forEach((patch) => patch.release());
    expect(cache.pendingImageAssets).toBe(0);
    expect(cache.pendingImageBytes).toBe(0);
  });
});
