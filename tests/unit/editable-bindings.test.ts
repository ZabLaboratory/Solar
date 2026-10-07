import { expect, it } from "vitest";
import { prepareEditableBindings } from "../../src/scenes/editable-bindings";

it("projects editable geometry and paint while keeping scalar style bindings live", () => {
  const shape = {
    kind: "shape",
    size: { w: 1, h: 2 },
    bindAnimate: { "transform.translate": "position" },
    bindUniversal: { width: "width", height: "height", opacity: "opacity" },
    bindStyle: { fill: "fill", radius: "radius" },
  };
  const text = {
    kind: "text",
    bindStyle: { size: "font", colour: "colour", weight: "weight" },
  };
  const document = {
    scene_id: "draft",
    scene_version: "base",
    defaults: {
      position: [30, 40],
      width: 200,
      height: 100,
    },
    layout: { kind: "frame", children: [shape], template: text },
  };
  const base = structuredClone(document);
  const variant = structuredClone(document);
  expect(prepareEditableBindings(variant)).toEqual({
    position: ["__solar.geometry.n0.x", "__solar.geometry.n0.y"],
  });
  expect(variant.layout.children[0]!).toMatchObject({
    bind: {
      "position.x": "__solar.geometry.n0.x",
      "position.y": "__solar.geometry.n0.y",
      "size.w": "width",
      "size.h": "height",
      opacity: "opacity",
      fill: "fill",
      cornerRadius: "radius",
    },
    bindStyle: {},
  });
  expect(variant.layout.children[0]!).not.toHaveProperty("bindUniversal");
  expect(variant.layout.template.bindStyle).toEqual({
    fontSize: "font",
    color: "colour",
    fontWeight: "weight",
  });
  expect(document).toEqual(base);
  expect(variant.defaults).toMatchObject({
    "__solar.geometry.n0.x": 30,
    "__solar.geometry.n0.y": 40,
  });
  expect(prepareEditableBindings(variant)).toEqual({});
});

it("keeps Pulsar native captures between distinct transparent Vision bands", async () => {
  const { prepareNativeComposition } =
    await import("../../src/scenes/editable-bindings");
  const document = {
    scene_id: "scene",
    scene_version: "base",
    layout: {
      kind: "frame",
      id: "root",
      fill: "#ff0000",
      bind: { fill: "background" },
      size: { w: 1920, h: 1080 },
      children: [
        {
          kind: "frame",
          id: "below",
          children: [
            { kind: "x-zab.capture", size: { w: 100, h: 50 } },
            { kind: "x-zab.meet-peer", "x-zab.slotRef": "@0" },
          ],
        },
        { kind: "x-zab.capture", id: "native", size: { w: 100, h: 50 } },
        { kind: "text", id: "above", bind: { value: "title" } },
      ],
    },
  };
  prepareNativeComposition(document, { width: 1920, height: 1080 });
  const layout = document.layout as unknown as {
    size: { w: number; h: number };
    children: Array<{
      position: { x: number; y: number };
      children: Array<{
        id?: string;
        fill?: string;
        bind: Record<string, string>;
        children: Array<{ id: string; children: Array<{ kind: string }> }>;
      }>;
    }>;
  };
  expect(layout.size).toEqual({ w: 1920, h: 2160 });
  expect(layout.children[0]!.position).toEqual({ x: 0, y: 0 });
  expect(layout.children[1]!.position).toEqual({ x: 0, y: 1080 });
  const below = layout.children[0]!.children[0]!,
    above = layout.children[1]!.children[0]!;
  expect(below.children[0]!.id).toBe("below");
  expect(below.children[0]!.children[0]!.kind).toBe("frame");
  expect(below.children[0]!.children[1]!.kind).toBe("x-zab.meet-peer");
  expect(above.children[0]!.id).toBe("above");
  expect(below.fill).toBe("#ff0000");
  expect(above).not.toHaveProperty("fill");
  expect(above.bind).not.toHaveProperty("fill");
  expect(below).not.toHaveProperty("id");
  expect(above).not.toHaveProperty("id");
});
