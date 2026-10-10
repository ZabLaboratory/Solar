import { describe, expect, it } from "vitest";
import { morphPath, parseMorphPath } from "../../src/engine/motion/vector";
import {
  sampleAnimation,
  compileCatalogue,
  samplePlan,
} from "../../src/engine/motion/timeline";
import {
  animationPatch,
  prepareAnimationBindings,
} from "../../src/engine/animations";
import type { LSMLDocument } from "../../src/scenes/native-document";

describe("retained vector motion", () => {
  const from = "M0 0 C10 0 20 0 30 0",
    to = "M0 0 C10 30 20 30 30 0";
  it("interpolates handles and preserves exact endpoints, holes and subpaths", () => {
    const sample = morphPath(from + " M40 0 L50 0 Z", to + " M40 10 L50 10 Z");
    expect(sample(0)).toBe(from + " M40 0 L50 0 Z");
    expect(sample(1)).toBe(to + " M40 10 L50 10 Z");
    expect(sample(0.5)).toBe("M0 0 C10 15 20 15 30 0 M40 5 L50 5 Z");
  });
  it("rejects unsupported syntax, correspondence, nonfinite and over-budget geometry", () => {
    for (const path of [
      "",
      "M0 0 A1 1 0 0 0 5 5",
      "m0 0 l1 1",
      "M0 0 1 1",
      "M0 0 C1 1",
      "M0 0 L1e99 0",
      "M0 0 Z L1 1",
    ])
      expect(() => parseMorphPath(path)).toThrow();
    expect(() => morphPath(from, "M0 0 L30 0")).toThrow(/topology/);
    expect(() => parseMorphPath("M0 0 " + "L1 1 ".repeat(1024))).toThrow(
      /budget/,
    );
  });
  it("admits the larger observed contour catalogue but still bounds aggregate input", () => {
    const padded = "M0 0 L1 1 Z".padEnd(32768, " ");
    const document = (count: number) =>
      ({
        lsml: "1.2",
        scene_id: "budget",
        scene_version: `sha256:${"0".repeat(64)}`,
        layout: { kind: "shape", id: "line", geometry: "path", pathData: from },
        animations: {
          show: {
            target: "line",
            keyframes: {
              duration_ms: 100,
              steps: Array.from({ length: count }, (_, index) => ({
                at: index / (count - 1),
                pathData: padded,
              })),
            },
          },
        },
      }) as LSMLDocument;
    expect(() => compileCatalogue(document(128))).not.toThrow();
    expect(() => compileCatalogue(document(129))).toThrow(/catalogue budget/);
  });
  it("selects a hold boundary when millisecond seeking rounds below its normalized key", () => {
    const source = {
      lsml: "1.2",
      scene_id: "hold",
      scene_version: `sha256:${"0".repeat(64)}`,
      layout: { kind: "shape", id: "line" },
      animations: {
        show: {
          target: "line",
          keyframes: {
            duration_ms: (232 * 1000) / 30,
            steps: [
              { at: 0, opacity: 0, easing: "hold" },
              { at: 37 / 232, opacity: 1 },
            ],
          },
        },
      },
    } as LSMLDocument;
    expect(
      samplePlan(compileCatalogue(source).show!, (37 * 1000) / 30)[0]?.values
        .opacity,
    ).toBe(1);
    expect(
      samplePlan(compileCatalogue(source).show!, (37 * 1000) / 30 - 0.01)[0]
        ?.values.opacity,
    ).toBe(0);
  });
  it("reuses compiled paths across cloned native snapshots and invalidates changed definitions", () => {
    const source = {
      lsml: "1.2",
      scene_id: "clone",
      scene_version: `sha256:${"0".repeat(64)}`,
      layout: { kind: "shape", id: "line" },
      animations: {
        show: {
          target: "line",
          keyframes: {
            duration_ms: 100,
            steps: [
              { at: 0, pathData: from },
              { at: 1, pathData: to },
            ],
          },
        },
      },
    } as LSMLDocument;
    const original = compileCatalogue(source);
    const clone = structuredClone(source);
    clone.defaults = { "__animation.show": { animation_id: "show" } };
    expect(compileCatalogue(clone)).toBe(original);
    const changed = structuredClone(clone);
    (changed.animations as Record<string, unknown>).show = {
      target: "line",
      keyframes: {
        duration_ms: 100,
        steps: [
          { at: 0, pathData: from },
          { at: 1, pathData: from },
        ],
      },
    };
    const replacement = compileCatalogue(changed);
    expect(replacement).not.toBe(original);
    expect(samplePlan(replacement.show!, 100)[0]?.values.pathData).toBe(from);
    expect(samplePlan(original.show!, 100)[0]?.values.pathData).toBe(to);
  });
  it("uses the existing timeline curves and projects/cancels exact path and trim bindings", () => {
    const asset = {
      target: "line",
      keyframes: {
        duration_ms: 100,
        steps: [
          { at: 0, pathData: from, trimEnd: 0 },
          { at: 1, pathData: to, trimEnd: 1 },
        ],
      },
    };
    const source: LSMLDocument = {
      lsml: "1.2",
      scene_id: "vector",
      scene_version: `sha256:${"0".repeat(64)}`,
      defaults: {},
      animations: { show: asset },
      layout: {
        kind: "shape",
        id: "line",
        geometry: "path",
        pathData: from,
        size: { w: 30, h: 30 },
        stroke: { color: "#fff", width: 2 },
      },
    };
    const variant = structuredClone(source);
    prepareAnimationBindings(variant);
    expect(variant.defaults?.["__solar.animation.line.trimEnd"]).toBe(1);
    const values = sampleAnimation(asset, 0.5);
    expect(values).toEqual({
      pathData: "M0 0 C10 15 20 15 30 0",
      trimEnd: 0.5,
    });
    expect(
      animationPatch(source, [{ target: "line", values }])[
        "__solar.animation.line.pathData"
      ],
    ).toBe(values.pathData);
    expect(
      animationPatch(source, [], true)["__solar.animation.line.pathData"],
    ).toBe(from);
    expect(source.layout).not.toEqual(variant.layout);
    const invalid = structuredClone(source);
    (invalid.layout as Record<string, unknown>).kind = "image";
    expect(() => prepareAnimationBindings(invalid)).toThrow(/shape/);
  });
});
