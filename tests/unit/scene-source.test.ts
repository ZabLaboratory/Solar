import { describe, expect, it, vi } from "vitest";
import { canonicalize } from "@lumencast/canonical";
import { createCanvasSceneSourceProvider } from "../../src/index";

const bytes = new TextEncoder().encode('{"lsml":"1.2"}');
const sha = async (data: Uint8Array) =>
  "sha256:" +
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data))),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
const version = "sha256:" + "a".repeat(64);
const base = "https://gateway.test/canvas/api/v1";
const endpoint = base + "/scenes/demo/source";
const pinned = `revisions/3/source.lsmlz?version=${version}`;
const blueManifest = async (overrides: Record<string, unknown> = {}) => {
  const unsigned = {
    schema_version: "zabcanvas.scene-blue-manifest.v1",
    scene_id: "demo",
    scene_revision: 3,
    revision_id: "revision-3",
    scene_version: version,
    validation: {
      id: "validation-3",
      attempt: 1,
      verdict: "valid",
      program_digest: null,
      validated_at: null,
    },
    declarations: {
      node_bindings: [],
      scene_blueprints: [],
      scene_definition: null,
    },
    binding_closure: [],
    readiness: {
      program_ready: false,
      binding_closure_complete: true,
      offline_ready: true,
      missing_binding_ids: [],
      missing_scene_blueprint_keys: [],
    },
    ...overrides,
  };
  return {
    ...unsigned,
    manifest_digest: await sha(new TextEncoder().encode(canonicalize(unsigned))),
  };
};
const info = async (overrides: Record<string, unknown> = {}) => ({
  revision: 3,
  scene_version: version,
  source_digest: await sha(bytes),
  lsml: `revisions/3/source.lsml?version=${version}`,
  lsmlz: pinned,
  assets: {},
  blue_manifest: await blueManifest(),
  ...overrides,
});
const sourceResponse = async (data = bytes) =>
  new Response(data, {
    headers: {
      "X-Scene-Version": version,
      "X-Scene-Revision": "3",
      ETag: `"${await sha(data)}"`,
    },
  });

describe("native scene acquisition", () => {
  it("requests by id, obtains pinned LSMLZ and forwards a host token without redirects", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(await info()))
      .mockResolvedValueOnce(await sourceResponse());
    const token = { fetch: vi.fn().mockResolvedValue("host-token") };
    const provider = createCanvasSceneSourceProvider({
      apiUrl: base,
      token,
      fetch: fetcher,
    });
    const source = await provider.get("demo");
    expect(source).toMatchObject({
      sceneId: "demo",
      revision: 3,
      sceneVersion: version,
      format: "lsmlz",
      data: bytes,
    });
    expect(source.assets.size).toBe(0);
    expect(source.blueManifest).toMatchObject({
      schema_version: "zabcanvas.scene-blue-manifest.v1",
      scene_id: "demo",
      scene_version: version,
      readiness: { offline_ready: true },
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      endpoint,
      new URL(pinned, endpoint).href,
    ]);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer host-token" },
      redirect: "error",
      cache: "no-store",
    });
    expect(token.fetch).toHaveBeenCalledOnce();
  });

  it("obtains plain LSML with verified assets", async () => {
    const asset = new Uint8Array([1, 2, 3]);
    const path = `assets/${(await sha(asset)).slice(7)}.png`;
    const descriptor = {
      ...(await info()),
      assets: { [path]: `revisions/3/${path}?version=${version}` },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(descriptor))
      .mockResolvedValueOnce(await sourceResponse())
      .mockResolvedValueOnce(new Response(asset));
    const source = await createCanvasSceneSourceProvider({
      apiUrl: base,
      fetch: fetcher,
    }).get("demo", { format: "lsml" });
    expect(source.assets.get(path)).toEqual(asset);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    "https://evil.test/source",
    "../other/source.lsmlz",
    "revisions/3/source.lsmlz?version=" + "sha256:" + "b".repeat(64),
  ])(
    "refuses descriptor-controlled credential destination %s",
    async (lsmlz) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ ...(await info()), lsmlz }));
      await expect(
        createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get(
          "demo",
        ),
      ).rejects.toMatchObject({ code: "SOURCE_DESCRIPTOR_INVALID" });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([404, 409, 500])(
    "surfaces an unavailable scene (%i) without falling back",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("refused", { status }));
      await expect(
        createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get(
          "demo",
        ),
      ).rejects.toMatchObject({ code: "SOURCE_REQUEST_FAILED" });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("rejects corrupt transport bytes", async () => {
    const response = await sourceResponse();
    response.headers.set("etag", '"sha256:' + "0".repeat(64) + '"');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(await info()))
      .mockResolvedValueOnce(response);
    await expect(
      createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get(
        "demo",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INTEGRITY_FAILED" });
  });

  it("rejects a descriptor/source race", async () => {
    const response = await sourceResponse();
    response.headers.set("x-scene-version", "sha256:" + "0".repeat(64));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(await info()))
      .mockResolvedValueOnce(response);
    await expect(
      createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get(
        "demo",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INTEGRITY_FAILED" });
  });

  it("rejects a Blue manifest whose declared scene or digest is changed", async () => {
    const invalidManifest = await blueManifest({ scene_id: "other-scene" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ ...(await info()), blue_manifest: invalidManifest }),
    );
    await expect(
      createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get("demo"),
    ).rejects.toMatchObject({ code: "SOURCE_DESCRIPTOR_INVALID" });
    expect(fetcher).toHaveBeenCalledOnce();

    const validManifest = await blueManifest();
    const tampered = { ...validManifest, readiness: { ...validManifest.readiness, offline_ready: false } };
    const secondFetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ ...(await info()), blue_manifest: tampered }),
    );
    await expect(
      createCanvasSceneSourceProvider({ apiUrl: base, fetch: secondFetcher }).get("demo"),
    ).rejects.toMatchObject({ code: "SOURCE_INTEGRITY_FAILED" });
  });

  it("rejects unbounded responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("{}", {
        headers: { "content-length": String(2 * 1024 * 1024) },
      }),
    );
    await expect(
      createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get(
        "demo",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_RESOURCE_LIMIT" });
  });

  it("honors cancellation before requesting a scene", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get(
        "demo",
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
