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
  expect(prepareEditableBindings(variant)).toEqual([
    "position",
    "width",
    "height",
  ]);
  expect(variant.layout.children[0]).toMatchObject({
    position: { x: 30, y: 40 },
    size: { w: 200, h: 100 },
    bind: { opacity: "opacity", fill: "fill", cornerRadius: "radius" },
    bindStyle: {},
  });
  expect(variant.layout.children[0]).not.toHaveProperty("bindUniversal");
  expect(variant.layout.template.bindStyle).toEqual({
    fontSize: "font",
    color: "colour",
    fontWeight: "weight",
  });
  expect(document).toEqual(base);
  expect(prepareEditableBindings(variant)).toEqual([]);
});
