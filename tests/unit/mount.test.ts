import { describe, expect, it } from "vitest";
import { validateOptions } from "../../src/internal/validate-options";
import type { MountOptions, SolarHandle } from "../../src/index";

const baseOptions = (
  overrides: Partial<MountOptions> = {},
): MountOptions => ({
  target: document.createElement("div"),
  orionUrl: "wss://gate.example/orion/api/v1/show/stream",
  token: "fake-token",
  mode: "broadcast",
  ...overrides,
});

describe("validateOptions()", () => {
  it("rejects a non-HTMLElement target", () => {
    expect(() =>
      // @ts-expect-error — intentionally wrong type for the runtime check.
      validateOptions(baseOptions({ target: "not-an-element" })),
    ).toThrow(/HTMLElement/);
  });

  it("rejects an empty orionUrl", () => {
    expect(() => validateOptions(baseOptions({ orionUrl: "" }))).toThrow(
      /orionUrl/,
    );
  });

  it("rejects mode='test' without testSession", () => {
    expect(() =>
      validateOptions(baseOptions({ mode: "test", scene: "scene-42" })),
    ).toThrow(/testSession/);
  });

  it("rejects mode='test' without scene", () => {
    expect(() =>
      validateOptions(baseOptions({ mode: "test", testSession: "uuid-1" })),
    ).toThrow(/scene/);
  });

  it("accepts mode='test' with both testSession and scene", () => {
    expect(() =>
      validateOptions(
        baseOptions({
          mode: "test",
          testSession: "uuid-1",
          scene: "scene-42",
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a typed token provider", () => {
    expect(() =>
      validateOptions(
        baseOptions({
          token: { fetch: () => Promise.resolve("token") },
        }),
      ),
    ).not.toThrow();
  });
});

describe("public types — compile-time surface", () => {
  it("exposes mount + types", () => {
    // The public surface is re-exported through src/index.ts. If a
    // refactor accidentally drops a property, the assignment below
    // stops compiling — this test is the runtime tracker for those
    // compile-time guarantees.
    const fakeHandle: SolarHandle = {
      disconnect: () => {},
      setToken: () => {},
    };
    expect(typeof fakeHandle.disconnect).toBe("function");
    expect(typeof fakeHandle.setToken).toBe("function");
    const mode: MountOptions["mode"] = "broadcast";
    expect(["broadcast", "control", "test"]).toContain(mode);
  });
});
