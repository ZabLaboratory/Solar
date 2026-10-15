import { afterEach, describe, expect, it, vi } from "vitest";
import { bundleAddress, canonicalize } from "@lumencast/canonical";
import { sha1 } from "@noble/hashes/sha1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { strToU8, zipSync } from "fflate";
import { acquireInstanceSources } from "../../src/scenes/instances";
import { verifySceneSource } from "../../src/scenes/cache";
import type {
  SceneSourceDelivery,
  SceneSourceRequest,
} from "../../src/scenes/types";
import { nativeManifest } from "../helpers/native-source";
import { NativeSceneFrames } from "../../src/engine/native-scene-frames";
import { requireLSML } from "../../src/scenes/native-document";
import { mountVisionScene } from "../../src/engine/vision-presenter";
import { NativeSceneAssets } from "../../src/scenes/native-document";
import { prepareInstanceImages } from "../../src/scenes/instance-images";

vi.mock("../../src/engine/vision-presenter", () => ({
  mountVisionScene: vi.fn(async () => ({
    dispose: vi.fn(),
    flush: vi.fn(async () => {}),
  })),
}));

afterEach(() => vi.unstubAllGlobals());

const hash = (bytes: Uint8Array) => `sha256:${bytesToHex(sha256(bytes))}`;
const rootVersion = `sha256:${"a".repeat(64)}`;
const root = (layout: unknown) => ({
  scene_id: "root",
  scene_version: rootVersion,
  layout,
});
const ref = (source: SceneSourceDelivery) => ({
  kind: "instance",
  scene_id: source.sceneId,
  scene_version: source.sceneVersion,
});
const signal = () => new AbortController().signal;

async function source(
  sceneId: string,
  layout: unknown = { kind: "frame", children: [] },
  format: "lsml" | "lsmlz" = "lsml",
  assets: ReadonlyMap<string, Uint8Array> = new Map(),
  documentFields: Record<string, unknown> = {},
): Promise<SceneSourceDelivery> {
  const document = {
    lsml: "1.1",
    scene_id: sceneId,
    scene_version: "",
    layout,
    ...documentFields,
  };
  document.scene_version = await bundleAddress(document);
  const bytes = strToU8(canonicalize(document));
  const blueManifest = nativeManifest(sceneId, document.scene_version);
  const { manifest_digest: _digest, ...unsigned } = blueManifest;
  blueManifest.manifest_digest = hash(strToU8(canonicalize(unsigned)));
  const entries = Object.fromEntries(assets);
  return {
    sceneId,
    sceneVersion: document.scene_version,
    revision: 1,
    sourceDigest: hash(bytes),
    format,
    data:
      format === "lsmlz" ? zipSync({ "scene.lsml": bytes, ...entries }) : bytes,
    assets: format === "lsml" ? assets : new Map(),
    blueManifest,
  };
}

function provider(sources: SceneSourceDelivery[]) {
  return {
    get: vi.fn(async (id: string, request?: SceneSourceRequest) => {
      const found = sources.find(
        (value) =>
          value.sceneId === id &&
          value.sceneVersion === request?.sceneVersion &&
          value.format === request?.format,
      );
      if (!found) throw new Error("Unavailable exact source");
      return found;
    }),
  };
}

describe("active exact-version instance acquisition", () => {
  it("localizes child HTTP images through the active image owner and keeps a bound child image mutable", async () => {
    vi.mocked(mountVisionScene).mockClear();
    const originalImage = Uint8Array.from([11, 22, 33]);
    const initialImage = Uint8Array.from([44, 55, 66]);
    const nextImage = Uint8Array.from([77, 88, 99]);
    const imageResponses = new Map([
      ["https://images.example/static.png", originalImage],
      ["https://images.example/initial.png", initialImage],
      ["https://images.example/next.png", nextImage],
    ]);
    const fetchImage = vi.fn(async (input: RequestInfo | URL) => {
      const bytes = imageResponses.get(String(input));
      if (!bytes) return new Response("missing", { status: 404 });
      return new Response(bytes, {
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchImage);

    const child = await source(
      "remote-child",
      {
        kind: "frame",
        children: [
          {
            kind: "image",
            id: "static-remote",
            src: "https://images.example/static.png",
            size: { w: 12, h: 12 },
          },
          {
            kind: "image",
            id: "mutable-remote",
            bind: { src: "__params.logo" },
            size: { w: 12, h: 12 },
          },
        ],
      },
      "lsml",
      new Map(),
      { assets: { allowedHosts: ["images.example"] } },
    );
    const rootImageUrl = "https://images.example/initial.png";
    const parent = await source(
      "remote-parent",
      {
        kind: "frame",
        size: { w: 64, h: 48 },
        children: [
          {
            ...ref(child),
            id: "remote-child-instance",
            bindParams: { logo: "game.logo" },
          },
        ],
      },
      "lsmlz",
      new Map(),
      {
        defaults: { "game.logo": rootImageUrl },
        assets: { allowedHosts: ["images.example"] },
      },
    );
    const immutableChildBytes = child.data.slice();
    const immutableParentBytes = parent.data.slice();
    const store = provider([parent, child]);
    const controller = new AbortController();
    const frames = new NativeSceneFrames(
      {
        target: document.createElement("div"),
        nativeLSDP: { url: "ws://localhost:1", resource: "scene" },
        sceneSourceProvider: store,
        token: "",
        mode: "control",
      },
      () => {},
      () => {},
      () => controller.signal,
      () => {},
    );
    const parentDocument = requireLSML(
      verifySceneSource(parent, { requireOfflineReady: false }).document,
    );

    await frames.prepare(parentDocument, () => {}, controller.signal, null);

    expect(fetchImage).toHaveBeenCalledTimes(2);
    const renderPackage = vi.mocked(mountVisionScene).mock.calls.at(-1)?.[5];
    expect(renderPackage?.instances).toHaveLength(1);
    const runtimeInstance = renderPackage!.instances![0]!;
    expect(runtimeInstance.sceneVersion).not.toBe(child.sceneVersion);
    const runtimeChild = JSON.parse(
      new TextDecoder().decode(runtimeInstance.packageBytes),
    );
    const staticPath = runtimeChild.layout.children[0].src as string;
    expect(staticPath).toMatch(/^assets\/solar-[a-f0-9]{64}\.png$/);
    expect(runtimeChild.scene_version).toBe(runtimeInstance.sceneVersion);
    expect(runtimeInstance.assets).toContainEqual({
      path: staticPath,
      bytes: originalImage,
    });

    const rootVariant = JSON.parse(
      new TextDecoder().decode(renderPackage!.data),
    );
    const mutablePath = renderPackage!.imageBindings?.["game.logo"];
    expect(mutablePath).toBeTruthy();
    expect(rootVariant.defaults[mutablePath!]).toMatch(
      /^assets\/solar-[a-f0-9]{64}\.png$/,
    );
    expect(rootVariant.layout.children[0].scene_version).toBe(
      runtimeInstance.sceneVersion,
    );
    expect(rootVariant.layout.children[0].bindParams.logo).toBe(mutablePath);
    expect(renderPackage!.assets).toContainEqual({
      path: rootVariant.defaults[mutablePath!],
      bytes: initialImage,
    });

    const staged = await renderPackage!.resolveImages!({
      "game.logo": "https://images.example/next.png",
    });
    expect(staged.values["game.logo"]).toMatch(
      /^assets\/solar-[a-f0-9]{64}\.png$/,
    );
    expect(staged.assets).toContainEqual({
      path: staged.values["game.logo"],
      bytes: nextImage,
    });
    staged.release?.();

    expect(child.data).toEqual(immutableChildBytes);
    expect(parent.data).toEqual(immutableParentBytes);
    const originalChildLayout = requireLSML(
      verifySceneSource(child, { requireOfflineReady: false }).document,
    ).layout as { children: Array<{ src: unknown }> };
    expect(
      originalChildLayout.children[0]?.src,
    ).toBe("https://images.example/static.png");
    vi.unstubAllGlobals();
  });

  it("retries a child HTTP image after 404 without retaining the failed URL", async () => {
    const child = await source(
      "retry-child",
      { kind: "image", src: "https://images.example/retry.png" },
      "lsml",
      new Map(),
      { assets: { allowedHosts: ["images.example"] } },
    );
    const parent = await source("retry-parent", {
      kind: "frame",
      children: [ref(child)],
    });
    const parentDocument = verifySceneSource(parent, {
      requireOfflineReady: false,
    }).document as ReturnType<typeof requireLSML>;
    const fetchImage = vi.fn(async () => {
      if (fetchImage.mock.calls.length === 1)
        return new Response("not found", { status: 404 });
      return new Response(Uint8Array.from([7, 8, 9]), {
        headers: { "content-type": "image/png" },
      });
    });
    const assets = new NativeSceneAssets(
      parent,
      fetchImage as unknown as typeof fetch,
    );
    const prepare = () =>
      assets.renderPackage(
        parentDocument,
        undefined,
        undefined,
        true,
        true,
        Promise.resolve([child]),
      );
    await expect(prepare()).rejects.toThrow("fetch failed (404)");
    const recovered = await prepare();
    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(recovered.instances).toHaveLength(1);
    recovered.release?.();
  });

  it("waits for sibling image leases before releasing after one child image fails", async () => {
    const failedChild = await source("failed-image-child", {
      kind: "image",
      src: "https://images.example/failed.png",
    });
    const delayedChild = await source("delayed-image-child", {
      kind: "image",
      src: "https://images.example/delayed.png",
    });
    const parent = await source("parallel-image-parent", {
      kind: "frame",
      children: [ref(failedChild), ref(delayedChild)],
    });
    const rootDocument = requireLSML(
      verifySceneSource(parent, { requireOfflineReady: false }).document,
    );
    let markDelayedStarted!: () => void;
    const delayedStarted = new Promise<void>((resolve) => {
      markDelayedStarted = resolve;
    });
    let markBothStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      markBothStarted = resolve;
    });
    let startedCount = 0;
    let resolveDelayed!: (image: {
      path: string;
      bytes: Uint8Array;
      release: () => void;
    }) => void;
    let released = 0;
    const resolveImage = vi.fn(async (value: unknown) => {
      startedCount++;
      if (startedCount === 2) markBothStarted();
      if (value === "https://images.example/failed.png")
        throw new Error("HTTP 404");
      markDelayedStarted();
      return await new Promise<{
        path: string;
        bytes: Uint8Array;
        release: () => void;
      }>((resolve) => {
        resolveDelayed = resolve;
      });
    });
    const preparing = prepareInstanceImages(
      rootDocument,
      [failedChild, delayedChild],
      {},
      Object.create(null) as Record<string, string>,
      Object.create(null) as Record<string, string>,
      resolveImage,
      signal(),
    );
    let settled = false;
    void preparing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await Promise.all([bothStarted, delayedStarted]);
    for (let turn = 0; turn < 12 && !settled; turn++)
      await Promise.resolve();
    expect(settled).toBe(false);
    resolveDelayed({
      path: "assets/solar-delayed.png",
      bytes: Uint8Array.from([1, 2, 3]),
      release: () => {
        released++;
      },
    });
    await expect(preparing).rejects.toThrow("HTTP 404");
    expect(released).toBe(1);
  });

  it("passes verified dependencies through real scene preparation and refuses missing children before Vision load", async () => {
    vi.mocked(mountVisionScene).mockClear();
    const legacyFont = strToU8("legacy sha1 child font");
    const legacyFontPath = `assets/${bytesToHex(sha1(legacyFont))}.woff2`;
    const namedImage = strToU8("named child image");
    const namedImagePath = "assets/instances/named-child-image.png";
    const child = await source(
      "child",
      {
        kind: "frame",
        children: [
          { kind: "image", src: legacyFontPath },
          { kind: "image", src: namedImagePath },
        ],
      },
      "lsml",
      new Map([
        [legacyFontPath, legacyFont],
        [namedImagePath, namedImage],
      ]),
    );
    const parent = await source(
      "parent",
      {
        kind: "frame",
        size: { w: 1920, h: 1080 },
        children: [ref(child)],
      },
      "lsmlz",
    );
    const store = provider([parent, child]);
    const controller = new AbortController();
    const frames = new NativeSceneFrames(
      {
        target: document.createElement("div"),
        nativeLSDP: { url: "ws://localhost:1", resource: "scene" },
        sceneSourceProvider: store,
        token: "",
        mode: "control",
      },
      () => {},
      () => {},
      () => controller.signal,
      () => {},
    );
    const documentSource = requireLSML(
      verifySceneSource(parent, { requireOfflineReady: false }).document,
    );
    await frames.prepare(documentSource, () => {}, controller.signal, null);
    expect(mountVisionScene).toHaveBeenCalledOnce();
    expect(vi.mocked(mountVisionScene).mock.calls[0]?.[5]?.instances).toEqual([
      {
        sceneId: child.sceneId,
        sceneVersion: child.sceneVersion,
        packageBytes: child.data,
        assets: [
          { path: legacyFontPath, bytes: legacyFont },
          { path: namedImagePath, bytes: namedImage },
        ],
      },
    ]);
    expect(store.get).toHaveBeenNthCalledWith(
      1,
      "parent",
      expect.objectContaining({
        format: "lsmlz",
        sceneVersion: parent.sceneVersion,
      }),
    );
    expect(store.get).toHaveBeenNthCalledWith(
      2,
      "child",
      expect.objectContaining({
        format: "lsml",
        sceneVersion: child.sceneVersion,
      }),
    );
    vi.mocked(mountVisionScene).mockClear();
    store.get.mockImplementation(async (id) => {
      if (id === parent.sceneId) return parent;
      throw new Error("Child unavailable");
    });
    await expect(
      frames.prepare(documentSource, () => {}, controller.signal, null),
    ).rejects.toMatchObject({ code: "BUNDLE_FETCH_FAILED" });
    expect(mountVisionScene).not.toHaveBeenCalled();
  });

  it("loads nested dependencies once per call, preserving original packages and exact pins", async () => {
    const leaf = await source("leaf", undefined, "lsml");
    const parent = await source("parent", {
      kind: "frame",
      children: [ref(leaf)],
    });
    const input = root({
      kind: "frame",
      children: [ref(parent), ref(parent), ref(leaf)],
    });
    const before = structuredClone(input);
    const store = provider([leaf, parent]);
    expect(await acquireInstanceSources(input, store, signal())).toEqual([
      parent,
      leaf,
    ]);
    expect(store.get).toHaveBeenCalledTimes(2);
    expect(store.get).toHaveBeenCalledWith(
      "leaf",
      expect.objectContaining({
        sceneVersion: leaf.sceneVersion,
        format: "lsml",
      }),
    );
    expect(input).toEqual(before);
    // A new active acquisition does not reuse an inactive/global dependency map.
    await acquireInstanceSources(input, store, signal());
    expect(store.get).toHaveBeenCalledTimes(4);
  });

  it("keeps two revisions of the same child scene distinct", async () => {
    const first = await source("child");
    const second = await source("child", {
      kind: "frame",
      size: { w: 50, h: 50 },
      children: [],
    });
    const store = provider([first, second]);
    expect(
      await acquireInstanceSources(
        root({ kind: "frame", children: [ref(first), ref(second)] }),
        store,
        signal(),
      ),
    ).toEqual([first, second]);
    expect(store.get).toHaveBeenCalledTimes(2);
  });

  it("does not interpret metadata/params as child layouts and includes repeat templates", async () => {
    const child = await source("child");
    const store = provider([child]);
    const layout = {
      kind: "frame",
      metadata: { forged: ref(child) },
      children: [],
    };
    expect(await acquireInstanceSources(root(layout), store, signal())).toEqual(
      [],
    );
    expect(store.get).not.toHaveBeenCalled();
    await acquireInstanceSources(
      root({ kind: "repeat", template: ref(child) }),
      store,
      signal(),
    );
    expect(store.get).toHaveBeenCalledOnce();
  });

  it("rejects a source different from the requested exact version", async () => {
    const child = await source("child");
    const store = {
      get: vi.fn(async () => ({ ...child, sceneVersion: rootVersion })),
    };
    await expect(
      acquireInstanceSources(root(ref(child)), store, signal()),
    ).rejects.toMatchObject({ code: "INSTANCE_SOURCE_INVALID" });
  });

  it("rejects corrupt source bytes rather than trusting descriptor metadata", async () => {
    const child = await source("child", undefined, "lsml");
    const broken = { ...child, data: strToU8("{}") };
    await expect(
      acquireInstanceSources(root(ref(child)), provider([broken]), signal()),
    ).rejects.toMatchObject({ code: "INSTANCE_SOURCE_INVALID" });
  });

  it("rejects a cycle back to the active scene before fetching its mutable alias", async () => {
    const child = await source("child", {
      kind: "instance",
      scene_id: "root",
      scene_version: rootVersion,
    });
    const store = provider([child]);
    await expect(
      acquireInstanceSources(root(ref(child)), store, signal()),
    ).rejects.toMatchObject({ code: "INSTANCE_CYCLE" });
    expect(store.get).toHaveBeenCalledOnce();
  });

  it("enforces depth on shared dependencies even when they were admitted shallowly first", async () => {
    const sources = [await source("leaf")];
    for (let index = 1; index <= 8; index++)
      sources.push(await source(`level-${index}`, ref(sources.at(-1)!)));
    const store = provider(sources);
    // Admit the leaf first, then examine the deep branch.
    const input = root({
      kind: "frame",
      children: [ref(sources[0]!), ref(sources.at(-1)!)],
    });
    await expect(
      acquireInstanceSources(input, store, signal()),
    ).rejects.toMatchObject({ code: "INSTANCE_RESOURCE_LIMIT" });
    expect(store.get).toHaveBeenCalledTimes(9);
  });

  it("rejects more than 256 distinct sources before acquiring the excess package", async () => {
    const sources = await Promise.all(
      Array.from({ length: 257 }, (_, index) => source(`child-${index}`)),
    );
    const store = provider(sources);
    await expect(
      acquireInstanceSources(
        root({ kind: "frame", children: sources.map(ref) }),
        store,
        signal(),
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_RESOURCE_LIMIT" });
    expect(store.get).toHaveBeenCalledTimes(256);
  });

  it("bounds total traversal across repeated shared packages, not just each layout individually", async () => {
    const child = await source("shared", {
      kind: "frame",
      children: Array(5000).fill({ kind: "shape", geometry: "rect" }),
    });
    const store = provider([child]);
    await expect(
      acquireInstanceSources(
        root({ kind: "frame", children: Array(21).fill(ref(child)) }),
        store,
        signal(),
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_RESOURCE_LIMIT" });
    expect(store.get).toHaveBeenCalledOnce();
  });

  it("bounds hostile broad layout traversal before starting network requests", async () => {
    const child = await source("child");
    const store = provider([child]);
    await expect(
      acquireInstanceSources(
        root({ kind: "frame", children: Array(100_001).fill(ref(child)) }),
        store,
        signal(),
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_RESOURCE_LIMIT" });
    expect(store.get).not.toHaveBeenCalled();
  });

  it("reports missing exact packages as BUNDLE_FETCH_FAILED without retrying another version", async () => {
    const child = await source("child");
    const store = provider([]);
    await expect(
      acquireInstanceSources(root(ref(child)), store, signal()),
    ).rejects.toMatchObject({ code: "BUNDLE_FETCH_FAILED" });
    expect(store.get).toHaveBeenCalledOnce();
  });

  it("preserves cancellation before acquisition and during a provider request", async () => {
    const child = await source("child");
    const controller = new AbortController();
    const reason = new Error("Cancelled by active owner");
    const store = {
      get: vi.fn(async () => {
        controller.abort(reason);
        throw reason;
      }),
    };
    await expect(
      acquireInstanceSources(root(ref(child)), store, controller.signal),
    ).rejects.toBe(reason);
    expect(store.get).toHaveBeenCalledOnce();
    store.get.mockClear();
    await expect(
      acquireInstanceSources(root(ref(child)), store, controller.signal),
    ).rejects.toBe(reason);
    expect(store.get).not.toHaveBeenCalled();
  });

  it("verifies online source integrity while preserving the cache's stricter offline contract", async () => {
    const child = await source("child");
    expect(() => verifySceneSource(child)).toThrow("SOURCE_INTEGRITY_FAILED");
    expect(
      verifySceneSource(child, { requireOfflineReady: false }).document
        .scene_version,
    ).toBe(child.sceneVersion);
    await expect(
      acquireInstanceSources(root(ref(child)), provider([child]), signal()),
    ).resolves.toEqual([child]);
  });
});
