import { afterEach, describe, expect, it, vi } from "vitest";
import { animationAssets, animationDocument, animationLeaf, animationPatch, hasGeometry, prepareAnimationBindings, sampleAnimation, VisionAnimations } from "../../src/engine/animations";
import type { LSMLDocument } from "../../src/scenes/native-document";

const document: LSMLDocument = {
  lsml: "1.2", scene_id: "animation-proof", scene_version: `sha256:${"a".repeat(64)}`,
  defaults: { visible: 0.8 },
  layout: { kind: "frame", id: "panel", position: { x: 30, y: 20 }, size: { w: 100, h: 50 }, bind: { opacity: "visible" }, children: [] },
  animations: { reveal: { target: "panel", keyframes: { duration_ms: 100, easing: "linear", steps: [{ at: 0, opacity: 0, translateX: 0 }, { at: 1, opacity: 1, translateX: 40 }] } } },
};
afterEach(() => vi.unstubAllGlobals());
describe("Vision Blue animation adapter", () => {
  it("patches translation relative to authored coordinates without requiring a scene reload", () => {
    const frame = { target: "panel", values: { translateX: 20, translateY: -10, rotation: 4 } };
    expect(hasGeometry(frame)).toBe(false);
    expect(animationPatch(document, [frame])).toEqual({
      [animationLeaf("panel", "x")]: 50, [animationLeaf("panel", "y")]: 10,
      [animationLeaf("panel", "rotation")]: 4,
    });
    expect(hasGeometry({ target: "panel", values: { scale: 1.2 } })).toBe(true);
  });
  it("preserves bound position authority and resolves the current base for repeated samples", () => {
    const source = structuredClone(document);
    (source.layout as Record<string, unknown>).bind = { "position.x": "panelX" };
    source.defaults!.panelX = 75;
    const variant = structuredClone(source);
    const aliases = prepareAnimationBindings(variant);
    expect(aliases[animationLeaf("panel", "x")]).toBe("panelX");
    expect(variant.defaults![animationLeaf("panel", "x")]).toBe(75);
    expect(animationPatch(source, [{ target: "panel", values: { translateX: 5 } }])[animationLeaf("panel", "x")]).toBe(80);
    expect(source.defaults!.panelX).toBe(75);
  });
  it("samples sparse channels and holds the last frame", () => {
    const asset = animationAssets(document).reveal!;
    expect(sampleAnimation(asset, 0.5)).toEqual({ opacity: 0.5, translateX: 20 });
    expect(sampleAnimation(asset, 1)).toEqual({ opacity: 1, translateX: 40 });
  });
  it("preserves source and maps numeric bound opacity to a private patch", () => {
    const variant = structuredClone(document);
    const aliases = prepareAnimationBindings(variant);
    expect(aliases[animationLeaf("panel", "opacity")]).toBe("visible");
    expect(variant.defaults![animationLeaf("panel", "opacity")]).toBe(0.8);
    expect(document.defaults).toEqual({ visible: 0.8 });
  });
  it("uses original geometry on every sample without cumulative translation", () => {
    const frames = [{ target: "panel", values: { translateX: 20, opacity: 0.5 } }];
    const variant = animationDocument(document, frames);
    expect((variant.layout as Record<string, unknown>).position).toEqual({ x: 50, y: 20 });
    expect(variant.defaults![animationLeaf("panel", "opacity")]).toBe(0.5);
    expect(animationDocument(document, frames)).toEqual(variant);
    expect((document.layout as Record<string, unknown>).position).toEqual({ x: 30, y: 20 });
  });
  it("rejects missing targets and unsupported channels before rendering", () => {
    expect(() => prepareAnimationBindings({ ...document, layout: { kind: "frame", id: "other" } })).toThrow("not found");
    expect(() => animationAssets({ ...document, animations: { bad: { target: "panel", keyframes: { duration_ms: 100, steps: [{ at: 0, unknown: 1 }] } } } })).toThrow("Unsupported");
    expect(() => animationAssets({ ...document, animations: { bad: { target: "panel", keyframes: { duration_ms: 100, easing: "invalid", steps: [{ at: 0 }] } } } })).toThrow("easing");
  });
  it("uses the authored CSS cubic bezier rather than an approximate named curve", () => {
    const asset = animationAssets(document).reveal!;
    expect(sampleAnimation({ ...asset, keyframes: { ...asset.keyframes, easing: "cubic-bezier(0,0,1,1)" } }, 0.5).opacity).toBeCloseTo(0.5);
    expect(sampleAnimation({ ...asset, keyframes: { ...asset.keyframes, easing: "ease-in" } }, 0.5).opacity).toBeCloseTo(0.31536, 4);
  });
  it("bounds submissions while a GPU frame is pending and retains the final state only for the same scene", async () => {
    let callback: FrameRequestCallback | null = null, complete: (() => void) | null = null;
    const schedule = vi.fn((next: FrameRequestCallback) => { callback = next; return 1; });
    vi.stubGlobal("requestAnimationFrame", schedule); vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const player = new VisionAnimations(() => new Promise<void>(resolve => { complete = resolve; }), vi.fn());
    const scene = structuredClone(document);
    scene.defaults!["__animation.reveal"] = { animation_id: "reveal", command_id: "one" };
    player.update(scene);
    (callback as unknown as FrameRequestCallback)(performance.now() + 1000);
    scene.defaults!["__animation.reveal"] = { animation_id: "reveal", command_id: "two" };
    player.update(scene);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(player.current(scene)[0]?.values.opacity).toBe(1);
    expect(player.current({ ...scene, scene_id: "other" })).toEqual([]);
    (complete as unknown as () => void)();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(schedule).toHaveBeenCalledTimes(2);
    player.clear();
    expect(player.current()).toEqual([]);
    player.dispose();
  });
  it("replays a new command, deduplicates idle updates and cancels on disposal", async () => {
    let callback: FrameRequestCallback | null = null;
    const schedule = vi.fn((next: FrameRequestCallback) => { callback = next; return 1; });
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", schedule); vi.stubGlobal("cancelAnimationFrame", cancel);
    const apply = vi.fn(async () => {}), error = vi.fn();
    const player = new VisionAnimations(apply, error);
    const scene = structuredClone(document);
    scene.defaults!["__animation.reveal"] = { animation_id: "reveal", command_id: "one" };
    player.update(scene); player.update(scene);
    expect(schedule).toHaveBeenCalledTimes(1);
    const first = callback as unknown as FrameRequestCallback;
    first(performance.now() + 1000);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(apply).toHaveBeenCalledTimes(1);
    scene.defaults!["__animation.reveal"] = { animation_id: "reveal", command_id: "two" };
    player.update(scene);
    expect(schedule).toHaveBeenCalledTimes(2);
    player.dispose();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(error).not.toHaveBeenCalled();
  });
});
