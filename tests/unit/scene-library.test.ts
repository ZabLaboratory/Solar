// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalize, bundleAddress } from "@lumencast/canonical";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { createHash } from "node:crypto";
import { cacheSource } from "../helpers/cache-source";
import { SceneSourceLibrary } from "../../src/server/scene-library";
import { createLocalSceneSourceProvider } from "../../src/scenes/local-library";
import { decodeSceneSource, encodeSceneSource } from "../../src/scenes/cache";
import type { SceneSourceDelivery } from "../../src/scenes/types";
const digest = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function source(
  id: string,
  title = "first",
): Promise<SceneSourceDelivery> {
  const value = await cacheSource();
  const files = unzipSync(value.data);
  const doc = JSON.parse(strFromU8(files["scene.lsml"]!));
  doc.scene_id = id;
  doc.defaults.title = title;
  doc.defaults.image = "https://images.example/live.png";
  doc.scene_version = await bundleAddress(doc);
  files["scene.lsml"] = strToU8(canonicalize(doc));
  const manifest = {
    ...value.blueManifest,
    scene_id: id,
    scene_version: doc.scene_version,
  };
  const { manifest_digest: _, ...unsigned } = manifest;
  manifest.manifest_digest = digest(strToU8(canonicalize(unsigned)));
  return {
    ...value,
    sceneId: id,
    sceneVersion: doc.scene_version,
    sourceDigest: digest(files["scene.lsml"]!),
    data: zipSync(files),
    blueManifest: manifest,
  };
}
function gateway(sources: Map<string, SceneSourceDelivery>) {
  let downloads = 0;
  const fetcher = vi.fn(
    async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer secret",
      );
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/scenes") {
        expect(url.searchParams.get("mine")).toBe("false");
        const offset = Number(url.searchParams.get("offset"));
        const ids = [...sources.keys()];
        return Response.json({
          items: ids.slice(offset, offset + 50).map((id) => ({ id })),
          next_offset: offset + 50 < ids.length ? offset + 50 : null,
        });
      }
      const id = decodeURIComponent(url.pathname.split("/")[4]!);
      const scene = sources.get(id)!;
      if (url.pathname.endsWith("/source"))
        return Response.json({
          revision: scene.revision,
          scene_version: scene.sceneVersion,
          source_digest: scene.sourceDigest,
          lsml: `revisions/1/source.lsml?version=${scene.sceneVersion}`,
          lsmlz: `revisions/1/source.lsmlz?version=${scene.sceneVersion}`,
          assets: {},
          blue_manifest: scene.blueManifest,
        });
      downloads++;
      return new Response(new Uint8Array(scene.data), {
        headers: {
          "x-scene-version": scene.sceneVersion,
          "x-scene-revision": "1",
          etag: `"${digest(scene.data)}"`,
        },
      });
    },
  );
  return { fetch: fetcher as typeof fetch, count: () => downloads };
}
it("synchronizes every accessible page, reuses unchanged bytes, replaces/prunes revisions and isolates accounts", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-library-"));
  directories.push(root);
  const sources = new Map(
    await Promise.all(
      Array.from({ length: 75 }, async (_, i) => {
        const s = await source(`scene-${i}`);
        return [s.sceneId, s] as const;
      }),
    ),
  );
  const remote = gateway(sources);
  const options = {
    apiUrl: "https://canvas/api/v1",
    token: "secret",
    fetch: remote.fetch,
  };
  const library = new SceneSourceLibrary(root, "https://canvas", "a");
  const signal = new AbortController().signal;
  expect(await library.synchronize(options, signal)).toMatchObject({
    discovered: 75,
    cached: 75,
    failures: [],
    truncated: false,
  });
  expect(remote.count()).toBe(75);
  const first = sources.get("scene-0")!;
  const bytes = await library.read(first.sceneId, first.sceneVersion);
  expect(decodeSceneSource(bytes!).data).toEqual(first.data);
  expect(
    await new SceneSourceLibrary(root, "https://canvas", "b").read(
      first.sceneId,
      first.sceneVersion,
    ),
  ).toBeNull();
  expect(
    await new SceneSourceLibrary(root, "https://canvas", "a").read(
      first.sceneId,
      first.sceneVersion,
    ),
  ).toBeNull();
  await library.synchronize(options, signal);
  expect(remote.count()).toBe(75); // descriptors only, no source/assets re-download
  const second = await source(first.sceneId, "updated");
  sources.set(first.sceneId, second);
  const revoked = sources.get("scene-74")!;
  sources.delete(revoked.sceneId);
  await library.synchronize(options, signal);
  expect(remote.count()).toBe(76);
  expect(await library.read(first.sceneId, first.sceneVersion)).toBeNull();
  expect(await library.read(revoked.sceneId, revoked.sceneVersion)).toBeNull();
  expect(
    decodeSceneSource(
      (await library.read(second.sceneId, second.sceneVersion))!,
    ).data,
  ).toEqual(second.data);
  const namespace = (await readdir(root))[0]!;
  expect(
    (await readdir(join(root, namespace))).filter((n) => n.endsWith(".scene")),
  ).toHaveLength(74);
  library.revoke();
  expect(await library.read(second.sceneId, second.sceneVersion)).toBeNull();
});
it("cancels incomplete passes without publishing an authorization index", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-library-"));
  directories.push(root);
  const s = await source("one");
  const controller = new AbortController();
  controller.abort();
  const library = new SceneSourceLibrary(root, "https://canvas", "a");
  await expect(
    library.synchronize(
      {
        apiUrl: "https://canvas/api/v1",
        fetch: gateway(new Map([[s.sceneId, s]])).fetch,
      },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(await library.read(s.sceneId, s.sceneVersion)).toBeNull();
});
it("local transport returns verified original LSML/assets/HTTP URL; corruption/auth failure never falls back", async () => {
  const s = await source("one");
  const upstream = { get: vi.fn(async () => s) };
  const response = vi.fn(
    async () => new Response(new Uint8Array(encodeSceneSource(s))),
  );
  const provider = createLocalSceneSourceProvider(
    "http://127.0.0.1:123/solar-sources",
    "local-token",
    upstream,
    response,
  );
  const result = await provider.get(s.sceneId, {
    sceneVersion: s.sceneVersion,
  });
  expect(result.data).toEqual(s.data);
  const document = JSON.parse(strFromU8(unzipSync(result.data)["scene.lsml"]!));
  expect(document.defaults.image).toBe("https://images.example/live.png");
  expect(upstream.get).not.toHaveBeenCalled();
  response.mockImplementation(async () => new Response("corrupt"));
  await expect(
    provider.get(s.sceneId, { sceneVersion: s.sceneVersion }),
  ).rejects.toThrow();
  response.mockImplementation(async () => new Response(null, { status: 401 }));
  await expect(
    provider.get(s.sceneId, { sceneVersion: s.sceneVersion }),
  ).rejects.toThrow();
  expect(upstream.get).not.toHaveBeenCalled();
  response.mockImplementation(async () => new Response(null, { status: 404 }));
  expect(await provider.get(s.sceneId, { sceneVersion: s.sceneVersion })).toBe(
    s,
  );
  expect(upstream.get).toHaveBeenCalledOnce();
});
