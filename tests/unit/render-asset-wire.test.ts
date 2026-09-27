import { describe, expect, it, vi } from "vitest";

import { rewriteRenderAssetFrame } from "../../src/internal/render-asset-wire";

const endpoint = {
  url: "http://127.0.0.1:4567/local-render-asset-url",
  token: "scene-server-token",
  gatewayOrigin: "https://zabgate.cyell.dev",
};

function encodeRenderAssetBatch(
  assets: Array<{ contentType: string; body: Uint8Array }>,
): ArrayBuffer {
  const encoder = new TextEncoder();
  const encoded = assets.map((asset) => ({
    contentType: encoder.encode(asset.contentType),
    body: asset.body,
  }));
  const packet = new Uint8Array(
    6 +
      encoded.reduce(
        (total, asset) =>
          total + 5 + asset.contentType.length + asset.body.length,
        0,
      ),
  );
  packet.set([0x4c, 0x52, 0x41, 0x31]);
  const view = new DataView(packet.buffer);
  view.setUint16(4, encoded.length);
  let offset = 6;
  for (const asset of encoded) {
    packet[offset] = asset.contentType.length;
    view.setUint32(offset + 1, asset.body.length);
    offset += 5;
    packet.set(asset.contentType, offset);
    offset += asset.contentType.length;
    packet.set(asset.body, offset);
    offset += asset.body.length;
  }
  return packet.buffer as ArrayBuffer;
}

function distinctImageSources(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Aatrox${index}.png`,
  );
}

function frameWithSources(sources: string[]): string {
  return JSON.stringify({
    state: Object.fromEntries(
      sources.map((source, index) => [`image${index}`, source]),
    ),
  });
}

describe("render asset wire hydration", () => {
  it("does not block the scene snapshot on immutable literals already pinned in the local bundle", async () => {
    const source = `https://zabgate.cyell.dev/canvas/api/v1/scene-assets/${"b".repeat(64)}/bytes`;
    const frame = JSON.stringify({
      type: "snapshot",
      state: {
        "__lit.image.background": source,
        "__lit.media.intro": source,
        title: "Incoming",
      },
    });
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await rewriteRenderAssetFrame(frame, endpoint, fetchImpl)).toBe(
      frame,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("scans ordinary state strings without reparsing each one as a URL", async () => {
    const NativeURL = globalThis.URL;
    let constructorCalls = 0;
    vi.stubGlobal(
      "URL",
      new Proxy(NativeURL, {
        construct(target, args, newTarget) {
          constructorCalls += 1;
          return Reflect.construct(target, args, newTarget);
        },
      }),
    );
    try {
      const source = distinctImageSources(1)[0]!;
      const state = Object.fromEntries(
        Array.from({ length: 5_000 }, (_, index) => [
          `label${index}`,
          `ordinary render text ${index}`,
        ]),
      );
      const replacements = new Map([[source, "data:image/png;base64,AQ=="]]);

      const rewritten = await rewriteRenderAssetFrame(
        JSON.stringify({ state: { ...state, image: source } }),
        endpoint,
        vi.fn<typeof fetch>(),
        replacements,
      );

      expect(JSON.parse(rewritten)).toMatchObject({
        state: { image: "data:image/png;base64,AQ==" },
      });
      expect(constructorCalls).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps accepting case-insensitive HTTPS URLs with leading URL whitespace", async () => {
    const source = ` \tHTTPS://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Aatrox.png`;
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );

    const rewritten = JSON.parse(
      await rewriteRenderAssetFrame(
        JSON.stringify({ state: { image: source } }),
        endpoint,
        fetchImpl,
      ),
    ) as { state: { image: string } };

    expect(rewritten.state.image).toBe("data:image/png;base64,AQ==");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("replaces dynamic scene and champion image URLs with local data URLs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toContain("local-render-asset-url");
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    const sceneAsset = `https://zabgate.cyell.dev/canvas/api/v1/scene-assets/${"a".repeat(64)}/bytes`;
    const frame = JSON.stringify({
      type: "snapshot",
      state: {
        "pl.L0.champ":
          "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Aatrox.png",
        "scene.logo": sceneAsset,
      },
    });

    const rewritten = JSON.parse(
      await rewriteRenderAssetFrame(frame, endpoint, fetchImpl),
    ) as { state: Record<string, string> };

    expect(rewritten.state["pl.L0.champ"]).toMatch(/^data:image\/png;base64,/);
    expect(rewritten.state["scene.logo"]).toMatch(/^data:image\/png;base64,/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("hydrates distinct image URLs with one same-origin batch request", async () => {
    const batchEndpoint = {
      ...endpoint,
      batchUrl: "http://127.0.0.1:4567/local-render-asset-batch",
    };
    const sources = distinctImageSources(8);
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const requestUrl = new URL(String(input));
      expect(requestUrl.pathname).toBe("/local-render-asset-batch");
      expect(requestUrl.searchParams.get("token")).toBe(endpoint.token);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ sources });
      return new Response(
        encodeRenderAssetBatch(
          sources.map((_, index) => ({
            contentType: index === 1 ? "image/webp" : "image/png",
            body: new Uint8Array([index + 1]),
          })),
        ),
        {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        },
      );
    });
    const frame = frameWithSources(sources);

    const rewritten = JSON.parse(
      await rewriteRenderAssetFrame(frame, batchEndpoint, fetchImpl),
    ) as { state: Record<string, string> };

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(rewritten.state.image0).toBe("data:image/png;base64,AQ==");
    expect(rewritten.state.image1).toBe("data:image/webp;base64,Ag==");
  });

  it("keeps a small image fan-out on parallel GETs", async () => {
    const batchEndpoint = {
      ...endpoint,
      batchUrl: "http://127.0.0.1:4567/local-render-asset-batch",
    };
    const sources = ["Aatrox", "Ahri", "Akali"].map(
      (champion) =>
        `https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/${champion}.png`,
    );
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );

    await rewriteRenderAssetFrame(
      JSON.stringify({
        state: { first: sources[0], second: sources[1], third: sources[2] },
      }),
      batchEndpoint,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.map(([input, init]) => ({
        path: new URL(String(input)).pathname,
        method: init?.method ?? "GET",
      })),
    ).toEqual(
      sources.map(() => ({ path: "/local-render-asset-url", method: "GET" })),
    );
  });

  it("falls back to per-image GETs when the binary batch is malformed", async () => {
    const batchEndpoint = {
      ...endpoint,
      batchUrl: "http://127.0.0.1:4567/local-render-asset-batch",
    };
    let batchRequested = false;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (new URL(String(input)).pathname === "/local-render-asset-batch") {
        batchRequested = true;
        return new Response(new Uint8Array([0, 1, 2, 3]));
      }
      return new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    const sources = distinctImageSources(8);

    const rewritten = JSON.parse(
      await rewriteRenderAssetFrame(
        frameWithSources(sources),
        batchEndpoint,
        fetchImpl,
      ),
    ) as { state: Record<string, string> };

    expect(batchRequested).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(rewritten.state.image0).toBe("data:image/png;base64,BwgJ");
  });

  it("falls back to per-image GETs when the bounded batch endpoint declines a payload", async () => {
    const batchEndpoint = {
      ...endpoint,
      batchUrl: "http://127.0.0.1:4567/local-render-asset-batch",
    };
    let batchRequested = false;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (new URL(String(input)).pathname === "/local-render-asset-batch") {
        batchRequested = true;
        return new Response(null, { status: 413 });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    const sources = distinctImageSources(8);

    const rewritten = await rewriteRenderAssetFrame(
      frameWithSources(sources),
      batchEndpoint,
      fetchImpl,
    );

    expect(batchRequested).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(
      fetchImpl.mock.calls.map(([, init]) => init?.method ?? "GET"),
    ).toEqual(["POST", ...sources.map(() => "GET")]);
    expect(rewritten).not.toContain("https://ddragon.leagueoflegends.com");
  });

  it("does not send the local token to a cross-origin batch URL", async () => {
    const unsafeEndpoint = {
      ...endpoint,
      batchUrl: "https://attacker.example/local-render-asset-batch",
    };
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );
    const source =
      "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Aatrox.png";

    await rewriteRenderAssetFrame(
      JSON.stringify({ state: { champ: source } }),
      unsafeEndpoint,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "local-render-asset-url",
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain(
      "attacker.example",
    );
  });

  it("reuses the replacement map for later deltas", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );
    const url =
      "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Aatrox.png";
    const replacements = new Map<string, string>();

    await rewriteRenderAssetFrame(
      JSON.stringify({ state: { champ: url } }),
      endpoint,
      fetchImpl,
      replacements,
    );
    await rewriteRenderAssetFrame(
      JSON.stringify({ patches: [{ value: url }] }),
      endpoint,
      fetchImpl,
      replacements,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(replacements.get(url)).toMatch(/^data:image\/png;base64,/);
  });

  it("leaves protocol frames without render assets byte-for-byte intact", async () => {
    const frame = JSON.stringify({ type: "pong", seq: 3 });
    await expect(rewriteRenderAssetFrame(frame, endpoint)).resolves.toBe(frame);
  });
});
