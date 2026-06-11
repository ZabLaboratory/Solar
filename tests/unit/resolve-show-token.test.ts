import { describe, expect, it } from "vitest";
import { resolveShowToken } from "../../src/internal/resolve-show-token";

describe("resolveShowToken()", () => {
  it("extracts the token embedded in the orionUrl query (Pulsar browser-source shape)", () => {
    const orionUrl =
      "wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp?token=SHOW123";
    expect(resolveShowToken(orionUrl, null)).toBe("SHOW123");
  });

  it("prefers an explicit top-level token over the embedded one", () => {
    const orionUrl =
      "wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp?token=EMBEDDED";
    expect(resolveShowToken(orionUrl, "EXPLICIT")).toBe("EXPLICIT");
  });

  it("returns '' when no token is present anywhere", () => {
    const orionUrl = "wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp";
    expect(resolveShowToken(orionUrl, null)).toBe("");
  });

  it("returns '' for an unparseable orionUrl (no token to mine)", () => {
    // orionUrl is always absolute in production (validateOptions enforces a
    // non-empty string and orionBundleUrl parses it as an absolute URL). A
    // non-absolute/garbage value cannot embed a token — stay header-less.
    expect(resolveShowToken("not a url", null)).toBe("");
    expect(resolveShowToken("/relative/path?token=X", null)).toBe("");
  });

  it("preserves token characters that URLSearchParams round-trips (JWT dots/dashes)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.aBc-_123";
    const orionUrl = `wss://gate/orion/api/v1/show/stream.lsdp?token=${jwt}`;
    expect(resolveShowToken(orionUrl, null)).toBe(jwt);
  });
});
