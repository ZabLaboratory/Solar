import { describe, expect, it, vi } from "vitest";

import { rewriteRenderAssetFrame } from "../../src/internal/render-asset-wire";

const endpoint = {
  url: "http://127.0.0.1:4567/local-render-asset-url",
  token: "scene-server-token",
  gatewayOrigin: "https://zabgate.cyell.dev",
};

describe("render asset wire hydration", () => {
  it("replaces dynamic scene and champion image URLs with local data URLs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toContain("local-render-asset-url");
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    const sceneAsset =
      `https://zabgate.cyell.dev/canvas/api/v1/scene-assets/${"a".repeat(64)}/bytes`;
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

  it("reuses the replacement map for later deltas", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
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
