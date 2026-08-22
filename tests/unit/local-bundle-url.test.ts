import { describe, expect, it } from "vitest";
import { localBundleUrl } from "../../src/internal/local-bundle-url";

describe("localBundleUrl()", () => {
  const host = "http://127.0.0.1:4173/solar/index.html";

  it("builds the content-addressed local scene bundle URL", () => {
    expect(
      localBundleUrl(
        "http://127.0.0.1:4173/solar-bundle",
        host,
        "scene id",
        "sha256:a/b+c",
      ),
    ).toBe(
      "http://127.0.0.1:4173/solar-bundle/scenes/scene%20id/render-bundle?v=sha256%3Aa%2Fb%2Bc",
    );
  });

  it("rejects a cross-origin bundle source", () => {
    expect(() =>
      localBundleUrl("https://other.example/solar-bundle", host, "s", "v"),
    ).toThrow(/same-origin/);
  });

  it("rejects a same-origin route that is not Prism's local bundle route", () => {
    expect(() =>
      localBundleUrl("http://127.0.0.1:4173/other", host, "s", "v"),
    ).toThrow(/local \/solar-bundle route/);
  });

  it("drops base query and hash before adding the version", () => {
    expect(
      localBundleUrl(
        "http://127.0.0.1:4173/solar-bundle/?token=stale#fragment",
        host,
        "scene",
        "v1",
      ),
    ).toBe(
      "http://127.0.0.1:4173/solar-bundle/scenes/scene/render-bundle?v=v1",
    );
  });
});
