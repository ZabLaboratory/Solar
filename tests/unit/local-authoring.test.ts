import { afterEach, expect, it, vi } from "vitest";
import { bundleAddress } from "@lumencast/canonical";
import { strFromU8, unzipSync } from "fflate";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { readNativeAuthoringSource } from "../../src/scenes/local-authoring";
import { NativeSceneAssets } from "../../src/scenes/native-document";

afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const bytes = new Uint8Array([1, 2, 3]);
  const path = `assets/${bytesToHex(sha256(bytes))}.png`;
  const base = {
    lsml: "1.2",
    scene_id: "draft",
    scene_version: "",
    layout: { kind: "shape", width: 200 },
    defaults: { x: 10 },
  };
  base.scene_version = await bundleAddress(base);
  const envelope = {
    format: "solar.authoring/1",
    lsml_bundle: base,
    assets: { [path]: "AQID" },
  };
  const active = {
    ...base,
    defaults: { x: 42 },
    "x-solar-authoring": envelope,
  };
  return { bytes, path, base, active, envelope };
}
it("renders a mutated native draft without any HTTP acquisition or Blue claim", async () => {
  const { bytes, path, base, active } = await fixture();
  const fetch = vi.fn(() => {
    throw new Error("HTTP authoring is forbidden");
  });
  vi.stubGlobal("fetch", fetch);
  const source = await readNativeAuthoringSource(active);
  expect(source?.provenance).toBe("local-authoring");
  expect(source).not.toHaveProperty("blueManifest");
  expect(source?.assets.get(path)).toEqual(bytes);
  const packed = await new NativeSceneAssets(source!).renderPackage(active);
  const rendering = JSON.parse(
    strFromU8(unzipSync(packed.data)["scene.lsml"]!),
  );
  expect(rendering.defaults.x).toBe(42);
  expect(rendering).not.toHaveProperty("x-solar-authoring");
  expect(source?.data).toEqual(new TextEncoder().encode(JSON.stringify(base)));
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects corrupt bases, assets and cross-scene deliveries without falling back", async () => {
  const { active, envelope, path } = await fixture();
  for (const document of [
    { ...active, scene_id: "other" },
    {
      ...active,
      "x-solar-authoring": { ...envelope, assets: { [path]: "CQkJ" } },
    },
    {
      ...active,
      "x-solar-authoring": {
        ...envelope,
        lsml_bundle: {
          ...envelope.lsml_bundle,
          layout: { kind: "shape", width: 201 },
        },
      },
    },
  ])
    await expect(readNativeAuthoringSource(document)).rejects.toThrow(
      "SOURCE_INTEGRITY_FAILED",
    );
});
it("uses the published provider only when native authoring metadata is absent", async () => {
  const { base, active } = await fixture();
  expect(await readNativeAuthoringSource(base)).toBeNull();
  await expect(
    readNativeAuthoringSource({ ...active, "x-solar-authoring": {} }),
  ).rejects.toThrow("SOURCE_DESCRIPTOR_INVALID");
});
it("bounds native asset payloads before decoding", async () => {
  const { active, envelope, path } = await fixture();
  await expect(
    readNativeAuthoringSource({
      ...active,
      "x-solar-authoring": {
        ...envelope,
        assets: { [path]: "AAAA".repeat(4 * 1024 * 1024 + 1) },
      },
    }),
  ).rejects.toThrow("SOURCE_RESOURCE_LIMIT");
});
