import { describe, it, expect } from "vitest";
import { bundleAddress, canonicalize, ZERO_HASH } from "@lumencast/canonical";
import { canonicalRender } from "../../src/scenes/canonical-render";
import { VerifiedFont } from "../../src/scenes/verified-font";

describe("single LSML serialization", () => {
  it("matches the normative canonical bytes and address without stamping nested keys", async () => {
    for (const layout of [
      { scene_version: ZERO_HASH, text: '\\"scene_version\\":' + ZERO_HASH },
      [{ value: "日本語 😀", scene_version: ZERO_HASH }, { value: 1e-7 }],
      { value: '\\"}\\\\', negative: -0, é: true },
    ]) {
      const source = {
        lsml: "1.2",
        scene_id: "test",
        scene_version: ZERO_HASH,
        layout,
      };
      const before = structuredClone(source);
      const result = await canonicalRender(source);
      expect(result.sceneVersion).toBe(await bundleAddress(source));
      expect(new TextDecoder().decode(result.data)).toBe(
        canonicalize({ ...source, scene_version: result.sceneVersion }),
      );
      expect(source).toEqual(before);
    }
  });
});

describe("owned verified fonts", () => {
  it("keeps its acknowledged digest valid despite caller and transfer mutations", async () => {
    const source = new Uint8Array([1, 2, 3]);
    const font = await VerifiedFont.admit(source);
    source.fill(0);
    font.copy().fill(9);
    expect(font.copy()).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.isFrozen(font)).toBe(true);
    expect(VerifiedFont.isVerified(font)).toBe(true);
    expect(VerifiedFont.isVerified(Object.create(VerifiedFont.prototype))).toBe(
      false,
    );
    expect(() =>
      Reflect.construct(VerifiedFont, [font.digest, source, Symbol()]),
    ).toThrow("Unverified font snapshot");
    expect(font.digest).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
    await expect(VerifiedFont.admit(source, font.digest)).rejects.toThrow(
      "content address mismatch",
    );
  });
});
