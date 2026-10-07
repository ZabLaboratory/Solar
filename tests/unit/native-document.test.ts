import { describe, expect, it, vi } from "vitest";
import { bundleAddress } from "@lumencast/canonical";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { nativeTreeHash } from "../../src/internal/native-tree";
import { NativeState } from "../../src/internal/native-state";
import { requireLSML } from "../../src/scenes/native-document";
import {
  defaultsPatch,
  NativeSceneAssets,
  visionTextPatch,
  visionImageValue,
} from "../../src/scenes/native-document";
import type { SceneSourceDelivery } from "../../src/scenes/types";
import rawVectors from "../../vendor/lsdp-native-browser/tree-vectors.json?raw";
import { nativeManifest } from "../helpers/native-source";
const vectors = JSON.parse(rawVectors) as Array<{
  name: string;
  value: unknown;
  hash: string;
}>;

const version = `sha256:${"1".repeat(64)}`;
const document = {
  lsml: "1.1",
  scene_id: "native-scene",
  scene_version: version,
  layout: { type: "frame", children: [] },
  defaults: { "__lit.text.title": "before", "a/b~c": [1, 2] },
};

describe("native Merkle hash compatibility", () => {
  it.each(vectors)("matches upstream vector $name", ({ value, hash }) => {
    expect(nativeTreeHash(value)).toBe(hash);
  });
  it("is independent of field insertion order", () => {
    expect(nativeTreeHash({ z: 1, é: true, a: 3 })).toBe(
      nativeTreeHash({ a: 3, z: 1, é: true }),
    );
  });
  it("rejects nonportable numbers before hashing", () => {
    expect(() => nativeTreeHash({ unsafe: 9007199254740992 })).toThrow();
  });
});

describe("native LSML mutation and runtime package", () => {
  it("keeps positional camera authority out of Vision defaults without changing the native document", async () => {
    const scene = {
      ...document,
      defaults: {
        score: 5,
        "__cam.slots.@0": "peer",
        "__cam.viewer": '{"rooms":[]}',
      },
    };
    const delivery: SceneSourceDelivery = {
      sceneId: scene.scene_id,
      sceneVersion: scene.scene_version,
      revision: 1,
      format: "lsml",
      data: strToU8(JSON.stringify(scene)),
      assets: new Map(),
      sourceDigest: "sha256:" + "0".repeat(64),
      blueManifest: nativeManifest(scene.scene_id, scene.scene_version),
    };
    const rendered = await new NativeSceneAssets(delivery).renderPackage(scene);
    const variant = JSON.parse(
      strFromU8(unzipSync(rendered.data)["scene.lsml"]!),
    );
    expect(variant.defaults).toEqual({ score: 5 });
    expect(scene.defaults["__cam.slots.@0"]).toBe("peer");
    expect(scene.defaults["__cam.viewer"]).toBe('{"rooms":[]}');
  });
  it("packages permitted remote images in RAM, reuses bytes and preserves the raw URL", async () => {
    const scene = {
      ...document,
      assets: { allowedHosts: ["images.example"] },
      defaults: { champion: "https://images.example/champion.png" },
      layout: { kind: "image", bind: { src: "champion" } },
    };
    const before = structuredClone(scene);
    const origin: SceneSourceDelivery = {
      sceneId: document.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(document.scene_id, version),
    };
    const image = new Uint8Array([1, 2, 3]);
    const fetchImage = vi.fn(
      async () =>
        new Response(image, { headers: { "content-type": "image/png" } }),
    );
    const assets = new NativeSceneAssets(origin, fetchImage as typeof fetch);
    const rendered = await assets.renderPackage(scene);
    const files = unzipSync(rendered.data);
    const variant = JSON.parse(strFromU8(files["scene.lsml"]!));
    const alias = rendered.imageBindings.champion!;
    const path = rendered.imageAssets[scene.defaults.champion]!;
    expect(files[path]).toEqual(image);
    expect(variant.defaults[alias]).toBe(path);
    expect(variant.defaults.champion).toBe(scene.defaults.champion);
    expect(variant.layout.bind.src).toBe(alias);
    await assets.renderPackage(scene);
    expect(fetchImage).toHaveBeenCalledOnce();
    expect(fetchImage).toHaveBeenCalledWith(scene.defaults.champion, {
      credentials: "omit",
      signal: undefined,
    });
    await expect(
      assets.renderPackage({
        ...scene,
        defaults: { champion: "https://forbidden.example/image.png" },
      }),
    ).rejects.toThrow("host is not allowed");
    expect(fetchImage).toHaveBeenCalledOnce();
    expect(scene).toEqual(before);
  });
  it("renders numeric scores as text without changing their numeric layout use or source", async () => {
    const scene = {
      ...document,
      defaults: { score: 0, "__solar.text.0": "authored" },
      layout: {
        kind: "stack",
        bind: { width: "score" },
        children: [
          { kind: "text", bind: { value: "score" } },
          { kind: "text", bind: { value: "row.message" } },
        ],
      },
    };
    const before = structuredClone(scene);
    const origin: SceneSourceDelivery = {
      sceneId: document.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(scene)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(document.scene_id, version),
    };
    const rendered = await new NativeSceneAssets(origin).renderPackage(scene);
    const variant = JSON.parse(
      strFromU8(unzipSync(rendered.data)["scene.lsml"]!),
    );
    const alias = rendered.textBindings.score!;
    expect(alias).not.toBe("__solar.text.0");
    expect(variant.defaults[alias]).toBe("0");
    expect(variant.defaults.score).toBe(0);
    expect(variant.layout.bind.width).toBe("score");
    expect(variant.layout.children[0].bind.value).toBe(alias);
    expect(variant.layout.children[1].bind.value).toBe("row.message");
    expect(visionTextPatch({ score: 7.9 }, rendered.textBindings)).toEqual({
      score: 7.9,
      [alias]: "7.9",
    });
    expect(visionTextPatch({ score: null }, rendered.textBindings)).toEqual({
      score: null,
      [alias]: "",
    });
    expect(visionTextPatch({ score: false }, rendered.textBindings)).toEqual({
      score: false,
      [alias]: "false",
    });
    expect(visionTextPatch({ other: 4 }, rendered.textBindings)).toEqual({
      other: 4,
    });
    expect(scene).toEqual(before);
  });
  it("rolls back an entire batch when a later test fails", () => {
    expect(() =>
      requireLSML(
        NativeState.from(document).patch([
          {
            op: "replace",
            path: "/defaults/__lit.text.title",
            value: "edited",
          },
          { op: "test", path: "/defaults/__lit.text.title", value: "wrong" },
        ]).value,
      ),
    ).toThrow();
    expect(document.defaults["__lit.text.title"]).toBe("before");
  });
  it("handles escaped keys and ordered array operations", () => {
    const next = requireLSML(
      NativeState.from(document).patch([
        { op: "add", path: "/defaults/a~1b~0c/1", value: 9 },
        { op: "remove", path: "/defaults/a~1b~0c/0" },
      ]).value,
    );
    expect(next.defaults?.["a/b~c"]).toEqual([9, 2]);
    expect(document.defaults["a/b~c"]).toEqual([1, 2]);
  });
  it("rejects unsupported operations and invalid pointers", () => {
    expect(() =>
      requireLSML(
        NativeState.from(document).patch([
          { op: "move", from: "/layout", path: "/other" },
        ]).value,
      ),
    ).toThrow();
    expect(() =>
      requireLSML(
        NativeState.from(document).patch([
          { op: "add", path: "/defaults/x~2", value: 1 },
        ]).value,
      ),
    ).toThrow();
  });
  it("updates literal defaults directly but rebuilds layout and removals", () => {
    expect(
      defaultsPatch(
        [{ op: "replace", path: "/defaults/__lit.text.title", value: "x" }],
        document,
      ),
    ).toEqual({ "__lit.text.title": "before" });
    expect(
      defaultsPatch(
        [{ op: "remove", path: "/defaults/__lit.text.title" }],
        document,
      ),
    ).toBeNull();
    expect(
      defaultsPatch([{ op: "replace", path: "/layout", value: {} }], document),
    ).toBeNull();
    expect(
      defaultsPatch(
        [{ op: "add", path: "/defaults/__cam.viewer", value: {} }],
        document,
      ),
    ).toEqual({}); // Camera controller consumes this leaf without a Vision rebuild.
    expect(
      defaultsPatch(
        [
          {
            op: "add",
            path: "/x-orion",
            value: { runtime_instance_id: "blue" },
          },
        ],
        document,
      ),
    ).toEqual({});
  });
  it("preserves original bytes, binary assets and validation pins", async () => {
    const asset = strToU8("original asset bytes");
    const data = zipSync({
      "scene.lsml": strToU8(JSON.stringify(document)),
      "assets/example.png": asset,
    });
    const origin: SceneSourceDelivery = {
      sceneId: document.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data,
      format: "lsmlz",
      assets: new Map(),
      blueManifest: nativeManifest(document.scene_id, version),
    };
    const before = data.slice();
    const pins = structuredClone(origin.blueManifest);
    const edited = requireLSML(
      NativeState.from(document).patch([
        { op: "add", path: "/layout/background", value: "#ff9900" },
      ]).value,
    );
    const rendered = await new NativeSceneAssets(origin).renderPackage(edited);
    const files = unzipSync(rendered.data);
    const variant = JSON.parse(strFromU8(files["scene.lsml"]!));
    expect(variant.layout.background).toBe("#ff9900");
    expect(variant.scene_version).toBe(await bundleAddress(variant));
    expect(variant.scene_version).not.toBe(version);
    expect(edited.scene_version).toBe(version);
    expect(files["assets/example.png"]).toEqual(asset);
    expect(origin.data).toEqual(before);
    expect(origin.blueManifest).toEqual(pins);
  });
  it("accepts plain LSML with delivered assets", async () => {
    const origin: SceneSourceDelivery = {
      sceneId: document.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(document)),
      format: "lsml",
      assets: new Map([["assets/test.bin", strToU8("asset")]]),
      blueManifest: nativeManifest(document.scene_id, version),
    };
    const rendered = await new NativeSceneAssets(origin).renderPackage(
      document,
    );
    expect(strFromU8(unzipSync(rendered.data)["assets/test.bin"]!)).toBe(
      "asset",
    );
  });
  it("renders empty Blue image bindings as a real transparent asset without changing source", async () => {
    const source = {
      ...document,
      layout: { type: "image", bind: { src: "logo" } },
      defaults: { logo: "" },
    };
    const origin: SceneSourceDelivery = {
      sceneId: source.scene_id,
      sceneVersion: version,
      sourceDigest: version,
      revision: 1,
      data: strToU8(JSON.stringify(source)),
      format: "lsml",
      assets: new Map(),
      blueManifest: nativeManifest(source.scene_id, version),
    };
    const result = await new NativeSceneAssets(origin).renderPackage(source);
    const files = unzipSync(result.data),
      variant = JSON.parse(strFromU8(files["scene.lsml"]!));
    const alias = result.imageBindings.logo!;
    expect(files[variant.defaults[alias]]).toBeInstanceOf(Uint8Array);
    expect(visionImageValue(null, {})).toBe(variant.defaults[alias]);
    expect(visionImageValue("", {})).toBe(variant.defaults[alias]);
    expect(visionImageValue("unknown.png", {})).toBe("unknown.png");
    expect(source.defaults.logo).toBe("");
  });
});
