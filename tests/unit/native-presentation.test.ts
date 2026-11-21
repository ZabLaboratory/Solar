import { describe, expect, it, vi } from "vitest";
import {
  NativePresentation,
  changedPresentationPatch,
} from "../../src/engine/native-presentation";
import type { VisionSceneHandle } from "../../src/engine/vision-contracts";
import type { LSMLDocument } from "../../src/scenes/native-document";
const document: LSMLDocument = {
  lsml: "1.1",
  scene_id: "presentation",
  scene_version: `sha256:${"1".repeat(64)}`,
  layout: {
    kind: "frame",
    id: "panel",
    position: { x: 30, y: 20 },
    size: { w: 100, h: 50 },
  },
  defaults: { title: "before" },
  animations: {
    move: {
      target: "panel",
      keyframes: {
        duration_ms: 100,
        steps: [
          { at: 0, opacity: 1 },
          { at: 1, opacity: 1 },
        ],
      },
    },
  },
};
function scene() {
  return {
    applyPatch: vi.fn(async (_patch: Record<string, unknown>) => {}),
  } as unknown as VisionSceneHandle & { applyPatch: ReturnType<typeof vi.fn> };
}
describe("presented native frame state", () => {
  it("compares JSON values semantically, including reordered object keys", () => {
    expect(
      changedPresentationPatch(
        { object: { b: [2], a: 1 }, scalar: 2, new: 0 },
        { object: { a: 1, b: [2] }, scalar: 2 },
      ),
    ).toEqual({ new: 0 });
  });
  it("suppresses repeated visual animation samples while resetting on source and scene changes", async () => {
    const submitted = scene(),
      state = new NativePresentation(),
      publish = vi.fn();
    state.record(document, "one", submitted);
    for (let tick = 0; tick < 10; tick++)
      await state.animate(
        [{ target: "panel", values: { opacity: 1 } }],
        submitted,
        () => true,
        publish,
      );
    expect(submitted.applyPatch).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    const updated = {
      ...document,
      layout: {
        ...(document.layout as Record<string, unknown>),
        position: { x: 90, y: 20 },
      },
    };
    state.record(updated, "two", submitted);
    await state.animate(
      [{ target: "panel", values: { opacity: 1 } }],
      submitted,
      () => true,
      publish,
    );
    expect(submitted.applyPatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ "__solar.animation.panel.x": 90 }),
    );
    expect(publish).toHaveBeenCalledTimes(2);
    const next = scene();
    state.record(updated, "two", next);
    await state.animate(
      [{ target: "panel", values: { opacity: 1 } }],
      next,
      () => true,
      publish,
    );
    expect(next.applyPatch).toHaveBeenCalledOnce();
  });
  it("restores cancelled animation offsets and suppresses their identical repetitions", async () => {
    const submitted = scene(),
      state = new NativePresentation(),
      publish = vi.fn();
    state.record(document, "one", submitted);
    await state.animate(
      [{ target: "panel", values: { translateX: 40 } }],
      submitted,
      () => true,
      publish,
    );
    await state.animate([], submitted, () => true, publish);
    await state.animate([], submitted, () => true, publish);
    expect(submitted.applyPatch).toHaveBeenCalledTimes(2);
    expect(submitted.applyPatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ "__solar.animation.panel.x": 30 }),
    );
  });
  it("rebinds changed resource hashes without resubmitting unchanged selected values", async () => {
    const submitted = scene(),
      state = new NativePresentation(),
      publish = vi.fn();
    state.record(document, "one", submitted);
    await state.scalar(
      submitted,
      { title: "before" },
      document,
      "two",
      () => {},
      publish,
    );
    expect(submitted.applyPatch).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
  });
  it("does not record or publish a patch cancelled while submission is awaited", async () => {
    const submitted = scene(),
      state = new NativePresentation(),
      publish = vi.fn();
    state.record(document, "one", submitted);
    const abort = new AbortController();
    submitted.applyPatch.mockImplementationOnce(async () => {
      abort.abort(new Error("cancelled"));
    });
    await expect(
      state.scalar(
        submitted,
        { title: "after" },
        { ...document, defaults: { title: "after" } },
        "two",
        () => abort.signal.throwIfAborted(),
        publish,
      ),
    ).rejects.toThrow("cancelled");
    expect(state.document).toBe(document);
    expect(state.hash).toBe("one");
    expect(publish).not.toHaveBeenCalled();
  });
  it("rejects missing presentation hashes before submitting", async () => {
    const submitted = scene(),
      state = new NativePresentation();
    await expect(
      state.scalar(
        submitted,
        { title: "after" },
        document,
        undefined,
        () => {},
        vi.fn(),
      ),
    ).rejects.toThrow("NATIVE_PRESENTATION_HASH_REQUIRED");
    expect(submitted.applyPatch).not.toHaveBeenCalled();
  });
});
