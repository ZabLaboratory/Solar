import { describe, expect, it } from "vitest";
import { orionBundleUrl } from "../../src/internal/orion-bundle-url";

describe("orionBundleUrl()", () => {
  it("maps the live WS URL to the gateway-prefixed render-bundle URL", () => {
    const resolve = orionBundleUrl(
      "wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp?token=x",
    );
    expect(resolve("SCENE", "sha256:V")).toBe(
      "https://zabgate.cyell.dev/orion/api/v1/scenes/SCENE/render-bundle?v=sha256%3AV",
    );
  });

  it("upgrades ws:// to http:// and preserves host + port", () => {
    const resolve = orionBundleUrl(
      "ws://localhost:4007/orion/api/v1/show/stream.lsdp",
    );
    expect(resolve("abc", "sha256:deadbeef")).toBe(
      "http://localhost:4007/orion/api/v1/scenes/abc/render-bundle?v=sha256%3Adeadbeef",
    );
  });

  it("percent-encodes scene id and version (Orion URL-decodes for byte-match)", () => {
    const resolve = orionBundleUrl(
      "wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp",
    );
    // ':' and '/' in a hash, and a space in a (hypothetical) scene id, must
    // be query/path-safe; Orion's r.URL.Query().Get("v") decodes back.
    expect(resolve("s pace", "sha256:a/b+c")).toBe(
      "https://zabgate.cyell.dev/orion/api/v1/scenes/s%20pace/render-bundle?v=sha256%3Aa%2Fb%2Bc",
    );
  });

  it("falls back to stripping a /show/* suffix when the exact WS suffix drifts", () => {
    const resolve = orionBundleUrl(
      "wss://zabgate.cyell.dev/orion/api/v1/show/stream",
    );
    expect(resolve("SCENE", "sha256:V")).toBe(
      "https://zabgate.cyell.dev/orion/api/v1/scenes/SCENE/render-bundle?v=sha256%3AV",
    );
  });

  it("normalises a trailing slash on the API root", () => {
    const resolve = orionBundleUrl(
      "wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp/",
    );
    // pathname has no exact WS_SUFFIX match; /show/ fallback recovers root.
    expect(resolve("SCENE", "v1")).toBe(
      "https://zabgate.cyell.dev/orion/api/v1/scenes/SCENE/render-bundle?v=v1",
    );
  });

  it("throws a host-friendly error on a non-absolute URL", () => {
    expect(() => orionBundleUrl("not-a-url")).toThrow(/orionUrl.*absolute/);
  });
});
