import { describe, expect, it, vi } from "vitest";
import { bundleAddress, canonicalize } from "@lumencast/canonical";
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

vi.mock("../../src/engine/vision-presenter", () => ({
  mountVisionScene: vi.fn(async () => ({
    dispose: vi.fn(),
    flush: vi.fn(async () => {}),
  })),
}));

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
  format: "lsml" | "lsmlz" = "lsmlz",
): Promise<SceneSourceDelivery> {
  const document = {
    lsml: "1.1",
    scene_id: sceneId,
    scene_version: "",
    layout,
  };
  document.scene_version = await bundleAddress(document);
  const bytes = strToU8(canonicalize(document));
  const blueManifest = nativeManifest(sceneId, document.scene_version);
  const { manifest_digest: _digest, ...unsigned } = blueManifest;
  blueManifest.manifest_digest = hash(strToU8(canonicalize(unsigned)));
  return {
    sceneId,
    sceneVersion: document.scene_version,
    revision: 1,
    sourceDigest: hash(bytes),
    format,
    data: format === "lsmlz" ? zipSync({ "scene.lsml": bytes }) : bytes,
    assets: new Map(),
    blueManifest,
  };
}

function provider(sources: SceneSourceDelivery[]) {
  return {
    get: vi.fn(async (id: string, request?: SceneSourceRequest) => {
      const found = sources.find(
        (value) =>
          value.sceneId === id && value.sceneVersion === request?.sceneVersion,
      );
      if (!found) throw new Error("Unavailable exact source");
      return found;
    }),
  };
}

describe("active exact-version instance acquisition", () => {
  it("passes verified dependencies through real scene preparation and refuses missing children before Vision load", async () => {
    vi.mocked(mountVisionScene).mockClear();
    const child = await source("child");
    const parent = await source("parent", {
      kind: "frame",
      size: { w: 1920, h: 1080 },
      children: [ref(child)],
    });
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
      },
    ]);
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
        format: "lsmlz",
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
