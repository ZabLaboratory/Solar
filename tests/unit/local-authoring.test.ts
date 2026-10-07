import { afterEach, expect, it, vi } from "vitest";
import { bundleAddress } from "@lumencast/canonical";
import { strFromU8, unzipSync } from "fflate";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { createLocalAuthoringSourceProvider } from "../../src/scenes/local-authoring";
import { NativeSceneAssets } from "../../src/scenes/native-document";

afterEach(() => vi.unstubAllGlobals());

it("verifies a local addressed draft and its embedded assets without a Blue manifest", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const path = `assets/${bytesToHex(sha256(bytes))}.png`;
  const document = {
    lsml: "1.2",
    scene_id: "draft",
    scene_version: "",
    layout: { kind: "shape", width: 200 },
    defaults: { x: 10 },
  };
  document.scene_version = await bundleAddress(document);
  const response = () =>
    new Response(
      JSON.stringify({ lsml_bundle: document, assets: { [path]: "AQID" } }),
      { headers: { "X-Scene-Version": document.scene_version } },
    );
  const fetch = vi.fn(async (_url: URL, _options: RequestInit) => response());
  vi.stubGlobal("fetch", fetch);
  const source = await createLocalAuthoringSourceProvider(
    "http://127.0.0.1:8123/editable-source",
    "local",
  ).get("draft", { sceneVersion: document.scene_version });
  expect(source?.provenance).toBe("local-authoring");
  expect(source).not.toHaveProperty("blueManifest");
  expect(source?.assets.get(path)).toEqual(bytes);
  expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
    Authorization: "Bearer local",
  });
  const edited = { ...document, defaults: { x: 42 } };
  const packed = await new NativeSceneAssets(source!).renderPackage(edited);
  expect(
    JSON.parse(strFromU8(unzipSync(packed.data)["scene.lsml"]!)).defaults.x,
  ).toBe(42);
  expect(source?.data).toEqual(
    new TextEncoder().encode(JSON.stringify(document)),
  );
  document.layout.width = 201;
  await expect(
    createLocalAuthoringSourceProvider(
      "http://127.0.0.1:8123/editable-source",
      "local",
    ).get("draft", { sceneVersion: document.scene_version }),
  ).rejects.toThrow("SOURCE_INTEGRITY_FAILED");
});

it("falls back only for absent local drafts and rejects nonloopback endpoints", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  const provider = createLocalAuthoringSourceProvider(
    "http://localhost:8123/editable-source",
    "local",
  );
  expect(
    await provider.get("published", {
      sceneVersion: "sha256:" + "a".repeat(64),
    }),
  ).toBeNull();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 403 })),
  );
  await expect(provider.get("draft", {})).rejects.toThrow(
    "SOURCE_REQUEST_FAILED",
  );
  expect(() =>
    createLocalAuthoringSourceProvider("https://example.com/source", "local"),
  ).toThrow("SOURCE_DESCRIPTOR_INVALID");
});
