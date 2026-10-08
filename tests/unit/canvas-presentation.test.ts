import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasPresentation } from "../../src/engine/canvas-presentation";
afterEach(() => vi.restoreAllMocks());
describe("atomic CEF canvas presentation", () => {
  it("copies only explicit completed frames into a synchronized retained surface", () => {
    const drawImage = vi.fn(),
      context = { drawImage, globalCompositeOperation: "source-over" };
    const get = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const source = document.createElement("canvas");
    source.width = 1920;
    source.height = 1080;
    const presentation = new CanvasPresentation(source);
    expect(get).toHaveBeenCalledWith("2d", {
      alpha: true,
      desynchronized: false,
    });
    expect(drawImage).not.toHaveBeenCalled();
    presentation.submit();
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1920, 1080);
    expect(context.globalCompositeOperation).toBe("copy");
    expect(presentation.canvas.width).toBe(1920);
    source.width = 1280;
    presentation.submit();
    expect(presentation.canvas.width).toBe(1280);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });
  it("does not manufacture a submitted frame if its copy fails", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: () => {
        throw new Error("GPU copy failed");
      },
    } as unknown as CanvasRenderingContext2D);
    const presentation = new CanvasPresentation(
      document.createElement("canvas"),
    );
    expect(() => presentation.submit()).toThrow("GPU copy failed");
  });
});
