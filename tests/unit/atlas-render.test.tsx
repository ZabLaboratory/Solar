import { afterEach, describe, expect, it } from "vitest";
import type { RenderBundle, RenderNode } from "@lumencast/runtime";
import { renderBundleHeadless } from "@lumencast/runtime";
import { buildAtlasRoot } from "../../src/atlas/atlas-node";
import { parseAtlasParam } from "../../src/atlas/atlas-param";

// DOM proof that the atlas transform PAINTS through the runtime's real
// broadcast render path (not just a structural tree): each band frame lands
// in the DOM at its slice height, with a transparent background, in a
// 1920×(1080·N) stage. Renders the atlas root headless (no WS, no fetch) —
// enough to assert geometry + transparency of the frames the transform emits.

let handles: { unmount(): void }[] = [];

afterEach(() => {
  for (const h of handles) h.unmount();
  handles = [];
});

async function renderAtlas(root: RenderNode, atlasParam: string): Promise<HTMLElement> {
  const spec = parseAtlasParam(atlasParam);
  if (spec === null) throw new Error("fixture: spec must parse");
  const bundle: RenderBundle = {
    scene_version: "sha256-atlas-test",
    root: buildAtlasRoot(root, spec),
  };
  const target = document.createElement("div");
  document.body.appendChild(target);
  const handle = renderBundleHeadless({ bundle, target });
  handles.push(handle);
  await handle.ready;
  return target;
}

describe("atlas render (headless DOM)", () => {
  it("paints N transparent band slices in a taller stage", async () => {
    const root: RenderNode = {
      kind: "stack",
      children: [
        { kind: "frame", id: "below-box", props: { width: 400, height: 200 } },
        { kind: "x-zab.capture", id: "cam", props: { width: 1920, height: 1080 } },
        { kind: "frame", id: "above-box", props: { width: 300, height: 150 } },
      ],
    };

    const target = await renderAtlas(root, "below,above");
    const divs = Array.from(target.querySelectorAll<HTMLElement>("div"));

    // The stage is the full N×1080 height.
    expect(divs.some((d) => d.style.height === "2160px")).toBe(true);
    // Two band slices, each 1080 tall.
    const bandSlices = divs.filter((d) => d.style.height === "1080px");
    expect(bandSlices.length).toBe(2);
    // Every frame the transform introduces is transparent — no fill declared.
    for (const d of divs) {
      expect(d.style.background).toBe("");
      expect(d.style.backgroundColor).toBe("");
    }
    // The authored scenic boxes still paint (one per band).
    expect(divs.some((d) => d.style.width === "400px")).toBe(true);
    expect(divs.some((d) => d.style.width === "300px")).toBe(true);
  });
});
