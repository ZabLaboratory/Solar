import { describe, expect, it, vi } from "vitest";
import { bundleAddress, canonicalize } from "@lumencast/canonical";
import { createCanvasSceneSourceProvider } from "../../src/index";
import { acquireInstanceSources } from "../../src/scenes/instances";

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
    manifest_digest: await sha(
      new TextEncoder().encode(canonicalize(unsigned)),
    ),
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
const exactChildFixture = async () => {
  const document = {
    lsml: "1.2",
    scene_id: "child",
    scene_version: "",
    layout: { kind: "frame", children: [] },
  };
  document.scene_version = await bundleAddress(document);
  const documentBytes = new TextEncoder().encode(canonicalize(document));
  const assetBytes = new Uint8Array([8, 4, 2, 1]);
  const path = `assets/${(await sha(assetBytes)).slice(7)}.png`;
  const descriptor = await info({
    scene_version: document.scene_version,
    source_digest: await sha(documentBytes),
    lsml: `revisions/3/source.lsml?version=${document.scene_version}`,
    assets: {
      [path]: `revisions/3/${path}?version=${document.scene_version}`,
    },
    blue_manifest: await blueManifest({
      scene_id: document.scene_id,
      scene_revision: 3,
      scene_version: document.scene_version,
    }),
  });
  return { document, documentBytes, assetBytes, path, descriptor };
};
function exactChildRoot(sceneId: string, sceneVersion: string) {
  return {
    scene_id: "root",
    scene_version: version,
    layout: {
      kind: "frame",
      children: [
        { kind: "instance", scene_id: sceneId, scene_version: sceneVersion },
      ],
    },
  };
}
const sourceResponse = async (
  data = bytes,
  sceneVersion = version,
  revision = 3,
) =>
  new Response(data, {
    headers: {
      "X-Scene-Version": sceneVersion,
      "X-Scene-Revision": String(revision),
      ETag: `"${await sha(data)}"`,
    },
  });
const assetResponse = async (
  data: Uint8Array<ArrayBuffer>,
  sceneVersion = version,
  revision = 3,
  etag?: string,
) => {
  const responseEtag = etag ?? `"${await sha(data)}"`;
  return new Response(data, {
    headers: {
      "X-Scene-Version": sceneVersion,
      "X-Scene-Revision": String(revision),
      ETag: responseEtag,
    },
  });
};

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
      .mockResolvedValueOnce(await assetResponse(asset));
    const source = await createCanvasSceneSourceProvider({
      apiUrl: base,
      fetch: fetcher,
    }).get("demo", { format: "lsml" });
    expect(source.assets.get(path)).toEqual(asset);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("acquires an exact child LSML revision with separate HTTP assets through the existing policy", async () => {
    const fixture = await exactChildFixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(fixture.descriptor))
      .mockResolvedValueOnce(
        await sourceResponse(
          fixture.documentBytes,
          fixture.document.scene_version,
        ),
      )
      .mockResolvedValueOnce(
        await assetResponse(fixture.assetBytes, fixture.document.scene_version),
      );
    const controller = new AbortController();
    const provider = createCanvasSceneSourceProvider({
      apiUrl: base,
      fetch: fetcher,
    });
    const dependencies = await acquireInstanceSources(
      exactChildRoot(fixture.document.scene_id, fixture.document.scene_version),
      provider,
      controller.signal,
    );
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]).toMatchObject({
      sceneId: "child",
      sceneVersion: fixture.document.scene_version,
      sourceDigest: await sha(fixture.documentBytes),
      format: "lsml",
    });
    expect(dependencies[0]?.assets.get(fixture.path)).toEqual(
      fixture.assetBytes,
    );
    expect(
      new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get("version"),
    ).toBe(fixture.document.scene_version);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      signal: controller.signal,
      credentials: "include",
      redirect: "error",
      cache: "no-store",
    });
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
  });

  it("preserves exact child integrity, abort and package budget failures from HTTP acquisition", async () => {
    const fixture = await exactChildFixture();
    const providerFor = async (assetResponse: () => Promise<Response>) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(fixture.descriptor))
        .mockResolvedValueOnce(
          await sourceResponse(
            fixture.documentBytes,
            fixture.document.scene_version,
          ),
        )
        .mockImplementationOnce(assetResponse);
      return createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher });
    };
    const wrongHashProvider = await providerFor(() =>
      assetResponse(
        new Uint8Array([9, 9, 9]),
        fixture.document.scene_version,
      ),
    );
    await expect(
      acquireInstanceSources(
        exactChildRoot(
          fixture.document.scene_id,
          fixture.document.scene_version,
        ),
        wrongHashProvider,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_SOURCE_INVALID" });

    const wrongRevisionProvider = await providerFor(() =>
      assetResponse(fixture.assetBytes, fixture.document.scene_version, 4),
    );
    await expect(
      acquireInstanceSources(
        exactChildRoot(
          fixture.document.scene_id,
          fixture.document.scene_version,
        ),
        wrongRevisionProvider,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_SOURCE_INVALID" });

    const wrongVersionProvider = await providerFor(() =>
      assetResponse(fixture.assetBytes, version),
    );
    await expect(
      acquireInstanceSources(
        exactChildRoot(
          fixture.document.scene_id,
          fixture.document.scene_version,
        ),
        wrongVersionProvider,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_SOURCE_INVALID" });

    const wrongEtagProvider = await providerFor(() =>
      assetResponse(
        fixture.assetBytes,
        fixture.document.scene_version,
        3,
        `"${"0".repeat(64)}"`,
      ),
    );
    await expect(
      acquireInstanceSources(
        exactChildRoot(
          fixture.document.scene_id,
          fixture.document.scene_version,
        ),
        wrongEtagProvider,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_SOURCE_INVALID" });

    const missingHeadersProvider = await providerFor(() =>
      Promise.resolve(new Response(fixture.assetBytes)),
    );
    await expect(
      acquireInstanceSources(
        exactChildRoot(
          fixture.document.scene_id,
          fixture.document.scene_version,
        ),
        missingHeadersProvider,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_SOURCE_INVALID" });

    const budgetProvider = await providerFor(() =>
      Promise.resolve(
        new Response(null, {
          headers: { "content-length": String(32 * 1024 * 1024 + 1) },
        }),
      ),
    );
    await expect(
      acquireInstanceSources(
        exactChildRoot(
          fixture.document.scene_id,
          fixture.document.scene_version,
        ),
        budgetProvider,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTANCE_RESOURCE_LIMIT" });

    const controller = new AbortController();
    const reason = new Error("Cancel child asset transfer");
    const abortProvider = await providerFor(() =>
      Promise.resolve().then(() => {
        controller.abort(reason);
        return assetResponse(fixture.assetBytes, fixture.document.scene_version);
      }),
    );
    await expect(
      acquireInstanceSources(
        exactChildRoot(
          fixture.document.scene_id,
          fixture.document.scene_version,
        ),
        abortProvider,
        controller.signal,
      ),
    ).rejects.toBe(reason);
  });

  it.each([
    "assets/named/child-image.png",
    `assets/${"a".repeat(40)}.woff2`,
  ])("does not broaden Canvas HTTP package files to unsupported path %s", async (path) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...(await info()),
          assets: { [path]: `revisions/3/${path}?version=${version}` },
        }),
      );
    await expect(
      createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get(
        "demo",
        { format: "lsml" },
      ),
    ).rejects.toMatchObject({ code: "SOURCE_DESCRIPTOR_INVALID" });
    expect(fetcher).toHaveBeenCalledOnce();
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
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...(await info()), blue_manifest: invalidManifest }),
      );
    await expect(
      createCanvasSceneSourceProvider({ apiUrl: base, fetch: fetcher }).get(
        "demo",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_DESCRIPTOR_INVALID" });
    expect(fetcher).toHaveBeenCalledOnce();

    const validManifest = await blueManifest();
    const tampered = {
      ...validManifest,
      readiness: { ...validManifest.readiness, offline_ready: false },
    };
    const secondFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...(await info()), blue_manifest: tampered }),
      );
    await expect(
      createCanvasSceneSourceProvider({
        apiUrl: base,
        fetch: secondFetcher,
      }).get("demo"),
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
