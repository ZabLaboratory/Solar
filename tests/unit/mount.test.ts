import { describe, expect, it } from "vitest";
import { validateOptions } from "../../src/internal/validate-options";
import type { MountOptions, SolarHandle } from "../../src/index";

const baseOptions = (overrides: Partial<MountOptions> = {}): MountOptions => ({
  target: document.createElement("div"),
  nativeLSDP: { url:"ws://127.0.0.1:4520/lsdp",resource:"scene" },
  sceneSourceProvider: {
    get: async () => {
      throw new Error("not called");
    },
  },
  token: "fake-token",
  mode: "broadcast",
  ...overrides,
});

describe("validateOptions()", () => {
  it("accepts a native LSML resource without an Orion test session", () => {
    expect(() =>
      validateOptions(
        baseOptions({
          nativeLSDP: { url: "ws://127.0.0.1:4520/lsdp", resource: "scene" },
          mode: "test",
        }),
      ),
    ).not.toThrow();
  });
  it("rejects missing, distant or invalid native selections", () => {
    expect(() => validateOptions(baseOptions({nativeLSDP:undefined} as never))).toThrow(/nativeLSDP/);
    expect(() => validateOptions(baseOptions({nativeLSDP:{url:"ws://example.com/lsdp",resource:"scene"}}))).toThrow(/local native/);
    expect(() => validateOptions(baseOptions({nativeLSDP:{url:"ws://127.0.0.1:4520/lsdp",resource:"solar/generations",selector:"__proto__"}}))).toThrow(/selector/);
  });
  it("rejects a non-HTMLElement target", () => {
    expect(() =>
      // @ts-expect-error — intentionally wrong type for the runtime check.
      validateOptions(baseOptions({ target: "not-an-element" })),
    ).toThrow(/HTMLElement/);
  });

  it("requires a scene source provider", () => {
    expect(() =>
      validateOptions(baseOptions({ sceneSourceProvider: undefined } as never)),
    ).toThrow(/sceneSourceProvider/);
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
