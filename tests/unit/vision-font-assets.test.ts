import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shares one host font acquisition and keeps the legacy font URL responses", async () => {
  vi.resetModules();
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2])));
  vi.stubGlobal("fetch", fetcher);
  const { loadHostFonts, visionFontResponse } =
    await import("../../src/engine/vision-font-assets");
  const first = loadHostFonts(),
    other = loadHostFonts();
  expect(first).toBe(other);
  const bytes = await first;
  expect(fetcher).toHaveBeenCalledTimes(bytes.length);
  expect(bytes).toHaveLength(11);
  const catalog = await visionFontResponse("/fonts", [new Uint8Array([3])]);
  expect(await catalog!.json()).toEqual(
    Array.from({ length: 12 }, (_, index) => `/fonts/${index}`),
  );
  const scene = await visionFontResponse("/fonts/11", [new Uint8Array([3])]);
  expect(Array.from(new Uint8Array(await scene!.arrayBuffer()))).toEqual([3]);
  expect((await visionFontResponse("/fonts/999", []))!.status).toBe(404);
  expect(await visionFontResponse("/scene", [])).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(11);
});

it("allows a new admission attempt after host font acquisition fails", async () => {
  vi.resetModules();
  const fetcher = vi.fn(async () => new Response(new Uint8Array([4])));
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  const { loadHostFonts } = await import("../../src/engine/vision-font-assets");
  await expect(loadHostFonts()).rejects.toThrow("Solar host font unavailable");
  expect(await loadHostFonts()).toHaveLength(11);
  expect(fetcher).toHaveBeenCalledTimes(22);
});
