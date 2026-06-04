// ADR 007 §B acceptance (e) — FILL PARITY. The headline acceptance.
//
// Before the convergence, Solar carried a hand-coded `fills.ts` that gave
// shapes/frames their rich fidelity (gradients, layered strokes). B
// deleted it on the premise that `@lumencast/runtime` now provides that
// fidelity to the LSML Fill spec. This test holds the runtime to that
// promise : it mounts, through Solar's public `mount()` seam, a scene
// declaring gradient backgrounds + gradient fills + layered strokes, and
// asserts the exact CSS / SVG the runtime emits. If the runtime ever
// regresses the Fill spec, this goes red.
//
// What the runtime DOES provide (verified against
//   node_modules/@lumencast/runtime/dist/render/fill.js
//   .../render/primitives/frame.js
//   .../render/primitives/shape.js ) :
//   - Frame `backgrounds[]`  → CSS `background-image: linear/radial-gradient(...)`
//   - Shape `fills[]`        → SVG <defs><linearGradient|radialGradient> + fill="url(#…)"
//   - Shape `strokes[]`      → layered SVG stroke / stroke-width
//
// What it does NOT provide (see the Probe report escalation) : `glow`
// (box-shadow / drop-shadow) and text-stroke (`-webkit-text-stroke`) are
// NOT emitted by any runtime primitive. Those parts of the brief's "glow
// + text-stroke" are a genuine fidelity gap, reported — not faked green.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderBundle } from "@lumencast/runtime";
import { mount } from "../../src/mount";
import { FakeWebSocket, findFrame, installHarness, waitFor } from "./_lsdp-harness";

afterEach(() => {
  vi.restoreAllMocks();
  FakeWebSocket.last = null;
});

async function mountScene(bundle: RenderBundle): Promise<{
  target: HTMLElement;
  handle: { disconnect: () => void };
}> {
  const target = document.createElement("div");
  document.body.appendChild(target);
  installHarness(vi, { bundle, initialState: {} });

  let live = false;
  const handle = mount({
    target,
    orionUrl: "wss://gate.example/orion/api/v1/show/stream",
    token: "t",
    mode: "broadcast",
    onStatus: (s) => {
      if (s === "live") live = true;
    },
  });
  await waitFor(() => live);
  return { target, handle };
}

describe("ADR 007 §B (e) — fill parity (gradients) on Frame backgrounds", () => {
  it("emits a CSS linear-gradient background-image for a linear-gradient fill", async () => {
    const bundle: RenderBundle = {
      scene_version: "sha256-fill-frame-linear",
      root: {
        kind: "frame",
        id: "bg",
        props: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          backgrounds: [
            {
              kind: "linear-gradient",
              angle_deg: 135,
              stops: [
                { offset: 0, color: "#ff0066" },
                { offset: 1, color: "#0066ff" },
              ],
            },
          ],
        },
      },
    };

    const { target, handle } = await mountScene(bundle);
    await waitFor(() => !!findFrame(target)?.style.backgroundImage);

    const frame = findFrame(target) as HTMLElement;
    const bg = frame.style.backgroundImage;

    // Exact runtime contract : `linear-gradient(<angle>deg, <c> <pct>%, ...)`
    // with stop offsets rendered as 2-decimal percentages.
    expect(bg).toContain("linear-gradient(135deg");
    expect(bg).toContain("#ff0066 0.00%");
    expect(bg).toContain("#0066ff 100.00%");

    handle.disconnect();
    target.remove();
  });

  it("emits a CSS radial-gradient and stacks multiple fills first-on-top", async () => {
    const bundle: RenderBundle = {
      scene_version: "sha256-fill-frame-radial-stack",
      root: {
        kind: "frame",
        id: "bg",
        props: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          backgrounds: [
            // First entry renders on top → first in the CSS layer list.
            {
              kind: "radial-gradient",
              center: { x: 0.25, y: 0.75 },
              stops: [
                { offset: 0, color: "#ffffff", opacity: 0.5 },
                { offset: 1, color: "#000000" },
              ],
            },
            { kind: "solid", color: "#123456" },
          ],
        },
      },
    };

    const { target, handle } = await mountScene(bundle);
    await waitFor(() => !!findFrame(target)?.style.backgroundImage);

    const frame = findFrame(target) as HTMLElement;
    const bg = frame.style.backgroundImage;

    // radial-gradient at the declared centre.
    expect(bg).toContain("radial-gradient(circle at 25% 75%");
    // The 0.5-opacity white #ffffff is appended as an 8-digit hex alpha
    // (0.5 → 0x80) per the runtime's cssWithOpacity().
    expect(bg).toContain("#ffffff80 0.00%");
    expect(bg).toContain("#000000 100.00%");
    // The solid layer is wrapped as a degenerate linear-gradient so it can
    // stack, and it comes AFTER the radial (radial is first → on top).
    expect(bg).toContain("linear-gradient(#123456, #123456)");
    expect(bg.indexOf("radial-gradient")).toBeLessThan(
      bg.indexOf("linear-gradient(#123456"),
    );

    handle.disconnect();
    target.remove();
  });
});

describe("ADR 007 §B (e) — fill parity (gradients + strokes) on Shape", () => {
  it("compiles a gradient fill into an SVG <linearGradient> def + url() ref", async () => {
    const bundle: RenderBundle = {
      scene_version: "sha256-fill-shape-gradient",
      root: {
        kind: "shape",
        id: "rect",
        props: {
          kind: "rect",
          width: 200,
          height: 80,
          radius: 8,
          fills: [
            {
              kind: "linear-gradient",
              angle_deg: 90,
              stops: [
                { offset: 0, color: "#11ccaa" },
                { offset: 1, color: "#aa11cc" },
              ],
            },
          ],
        },
      },
    };

    const { target, handle } = await mountScene(bundle);
    await waitFor(() => target.querySelector("svg defs linearGradient") !== null);

    const svg = target.querySelector("svg") as SVGSVGElement;
    expect(svg).not.toBeNull();

    const grad = svg.querySelector("defs linearGradient") as SVGElement;
    expect(grad).not.toBeNull();
    const gradId = grad.getAttribute("id");
    expect(gradId).toMatch(/^lumen-grad-/);

    // The two stops carry the declared colours.
    const stops = Array.from(svg.querySelectorAll("defs linearGradient stop"));
    const stopColors = stops.map((s) => s.getAttribute("stop-color"));
    expect(stopColors).toEqual(["#11ccaa", "#aa11cc"]);

    // The painted rect references the gradient via fill="url(#…)".
    const rect = svg.querySelector("rect[fill^='url(']") as SVGRectElement;
    expect(rect).not.toBeNull();
    expect(rect.getAttribute("fill")).toBe(`url(#${gradId})`);

    handle.disconnect();
    target.remove();
  });

  it("renders layered strokes as SVG stroke / stroke-width passes", async () => {
    const bundle: RenderBundle = {
      scene_version: "sha256-fill-shape-strokes",
      root: {
        kind: "shape",
        id: "rect",
        props: {
          kind: "rect",
          width: 120,
          height: 120,
          fills: [{ kind: "solid", color: "#222222" }],
          strokes: [
            { color: "#ffcc00", width: 6 },
            { color: "#ff0000", width: 2 },
          ],
        },
      },
    };

    const { target, handle } = await mountScene(bundle);
    await waitFor(() => target.querySelector("svg") !== null);

    const svg = target.querySelector("svg") as SVGSVGElement;
    // Stroke passes are rects with a non-"none" stroke + a stroke-width.
    const strokeRects = Array.from(svg.querySelectorAll("rect")).filter((r) => {
      const s = r.getAttribute("stroke");
      return s !== null && s !== "none" && s !== "transparent";
    });
    const stroked = strokeRects.map((r) => ({
      color: r.getAttribute("stroke"),
      width: r.getAttribute("stroke-width"),
    }));

    // Both declared strokes are present (order is reversed internally so
    // first-entry paints on top, so assert membership, not order).
    expect(stroked).toEqual(
      expect.arrayContaining([
        { color: "#ffcc00", width: "6" },
        { color: "#ff0000", width: "2" },
      ]),
    );

    handle.disconnect();
    target.remove();
  });

  it("falls back to the legacy single `fill` prop for a 1.0 bundle (no fills[])", async () => {
    // Parity must not regress 1.0 bundles : a bare `fill` colour still
    // paints, with no gradient defs emitted.
    const bundle: RenderBundle = {
      scene_version: "sha256-fill-shape-legacy",
      root: {
        kind: "shape",
        id: "rect",
        props: { kind: "rect", width: 50, height: 50, fill: "#abcdef" },
      },
    };

    const { target, handle } = await mountScene(bundle);
    await waitFor(() => target.querySelector("svg rect") !== null);

    const svg = target.querySelector("svg") as SVGSVGElement;
    expect(svg.querySelector("defs linearGradient")).toBeNull();
    expect(svg.querySelector("defs radialGradient")).toBeNull();
    const rect = svg.querySelector("rect") as SVGRectElement;
    expect(rect.getAttribute("fill")).toBe("#abcdef");

    handle.disconnect();
    target.remove();
  });
});
