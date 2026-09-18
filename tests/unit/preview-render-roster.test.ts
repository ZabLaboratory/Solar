import { describe, expect, it } from "vitest";
import { previewRenderRoster } from "../../src/internal/preview-render-roster";

describe("previewRenderRoster", () => {
  const entry = { scene_id: "blue", scene_version: `sha256:${"a".repeat(64)}` };
  it("projects immutable identities without any runtime state", () => {
    expect(
      previewRenderRoster([{ ...entry, leaves: { score: 10 } }], true),
    ).toEqual([entry]);
  });
  it("never enables preload for Program", () => {
    expect(previewRenderRoster([entry], false)).toEqual([]);
  });
  it("ignores absent or malformed optional hints", () => {
    expect(previewRenderRoster(undefined, true)).toEqual([]);
    expect(
      previewRenderRoster(
        [null, {}, { ...entry, scene_version: "latest" }, entry],
        true,
      ),
    ).toEqual([entry]);
  });
});
