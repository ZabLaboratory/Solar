import { describe, expect, it, vi } from "vitest";
import { createLocalImageAssetsProvider } from "../../src/scenes/local-images";

const config = {
  url: "http://127.0.0.1:12345/local-render-asset-url",
  token: "test-local-credential",
  gatewayOrigin: "https://gateway.example",
};
const image =
  "https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Ahri.png";

describe("trusted host image cache adapter", () => {
  it("reuses the authenticated loopback route for admitted images and forwards cancellation", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImage = vi.fn(
      async () =>
        new Response(bytes, {
          headers: { "content-type": "image/png; charset=binary" },
        }),
    );
    const provider = createLocalImageAssetsProvider(
      config,
      fetchImage as typeof fetch,
    );
    const controller = new AbortController();
    expect(await provider.get(image, { signal: controller.signal })).toEqual({
      data: bytes,
      contentType: "image/png",
    });
    const [request, options] = fetchImage.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(request.origin + request.pathname).toBe(config.url);
    expect(request.searchParams.get("url")).toBe(image);
    expect(request.searchParams.get("token")).toBe(config.token);
    expect(options).toEqual({
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
    });
    const canvas = `${config.gatewayOrigin}/canvas/api/v1/scene-assets/${"a".repeat(64)}/bytes`;
    await provider.get(canvas, {});
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://images.example/image.png",
    "http://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Ahri.png",
    "https://user:password@ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Ahri.png",
    "https://ddragon.leagueoflegends.com/another/image.png",
    `https://other.example/canvas/api/v1/scene-assets/${"a".repeat(64)}/bytes`,
  ])(
    "leaves unsupported URLs to the existing source policy: %s",
    async (url) => {
      const fetchImage = vi.fn();
      const provider = createLocalImageAssetsProvider(config, fetchImage);
      expect(await provider.get(url, {})).toBeNull();
      expect(fetchImage).not.toHaveBeenCalled();
    },
  );

  it("rejects host configurations that could forward a credential outside loopback", () => {
    for (const url of [
      "https://remote.example/local-render-asset-url",
      "http://localhost/other",
      "http://user:pass@localhost/local-render-asset-url",
    ])
      expect(() => createLocalImageAssetsProvider({ ...config, url })).toThrow(
        "HOST_INVALID",
      );
    expect(() =>
      createLocalImageAssetsProvider({ ...config, token: "" }),
    ).toThrow("HOST_INVALID");
  });

  it("rejects failures, nonimages and oversized advertised bodies", async () => {
    for (const response of [
      new Response("denied", { status: 401 }),
      new Response("html", { headers: { "content-type": "text/html" } }),
      new Response(new Uint8Array([1]), {
        headers: {
          "content-type": "image/png",
          "content-length": String(8 * 1024 * 1024 + 1),
        },
      }),
    ]) {
      const provider = createLocalImageAssetsProvider(
        config,
        vi.fn(async () => response),
      );
      await expect(provider.get(image, {})).rejects.toThrow();
    }
  });

  it("bounds streamed bytes even without content-length and cancels the body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
      },
      cancel,
    });
    const provider = createLocalImageAssetsProvider(
      config,
      vi.fn(
        async () =>
          new Response(body, { headers: { "content-type": "image/png" } }),
      ),
    );
    await expect(provider.get(image, {})).rejects.toThrow("exceeds 8 MiB");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
