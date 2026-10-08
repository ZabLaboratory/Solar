/** CEF samples the retained front canvas, never Vision's in-progress GPU surface. */
export class CanvasPresentation {
  readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;

  constructor(private readonly source: HTMLCanvasElement) {
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, {
      display: "block",
      width: "100%",
      height: "100%",
    });
    const context = this.canvas.getContext("2d", {
      alpha: true,
      desynchronized: false,
    });
    if (!context) throw new Error("Solar compositor canvas is unavailable.");
    this.context = context;
  }

  submit(): void {
    const { width, height } = this.source;
    if (width < 1 || height < 1)
      throw new Error("Vision submitted an empty surface.");
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.globalCompositeOperation = "copy";
    this.context.drawImage(this.source, 0, 0, width, height);
  }
}
