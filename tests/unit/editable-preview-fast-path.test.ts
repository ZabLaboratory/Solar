// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  applyEditableFastPatch,
  applyEditableTranslatePatch,
  EditablePreviewDeltaGate,
  editablePreviewFastPathEnabled,
  parseAcceptedEditablePatches,
  parseEditableFastPatch,
  parseEditableTranslatePatch,
  readEditablePreviewSidebandUrl,
} from "../../src/internal/editable-preview-fast-path";

const PANEL_TOKEN = "70616e656c";

describe("editable Preview compositor fast path", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("decodes only bounded atomic editable translations", () => {
    expect(
      parseEditableTranslatePatch({
        path: `__editable.${PANEL_TOKEN}.translate`,
        value: [61, 40],
      }),
    ).toEqual({ componentId: "panel", property: "translate", x: 61, y: 40 });
    expect(
      parseEditableTranslatePatch({
        path: `__editable.${PANEL_TOKEN}.translate`,
        value: [Number.NaN, 40],
      }),
    ).toBeNull();
    expect(
      parseEditableTranslatePatch({ path: "blue.input", value: [1, 2] }),
    ).toBeNull();
  });

  it("mirrors snapshot, ordering, duplicate, gap and scene-change gates", () => {
    const gate = new EditablePreviewDeltaGate();
    const delta = (seq: number, x: number): string =>
      JSON.stringify({
        type: "delta",
        seq,
        patches: [
          {
            path: `__editable.${PANEL_TOKEN}.translate`,
            value: [x, 40],
          },
        ],
      });

    expect(gate.accept(delta(2, 10))).toEqual([]);
    expect(gate.accept(JSON.stringify({ type: "snapshot", seq: 1 }))).toEqual(
      [],
    );
    expect(gate.accept(delta(2, 20))).toEqual([
      { componentId: "panel", property: "translate", x: 20, y: 40 },
    ]);
    expect(gate.accept(delta(2, 30))).toEqual([]);
    expect(gate.accept(delta(4, 40))).toEqual([]);
    expect(gate.accept(delta(5, 50))).toEqual([]);
    expect(gate.accept(JSON.stringify({ type: "snapshot", seq: 8 }))).toEqual(
      [],
    );
    expect(gate.accept(delta(9, 90))).toHaveLength(1);
    expect(
      gate.accept(JSON.stringify({ type: "scene_changed", seq: 10 })),
    ).toEqual([]);
    expect(gate.accept(delta(11, 110))).toEqual([]);
  });

  it("mutates only the matching Solar compositor wrapper", () => {
    document.body.innerHTML = `
      <div data-lumencast-bind-animate="other"></div>
      <div data-lumencast-bind-animate="panel"></div>
      <div data-lumencast-bind-animate="panel"></div>
    `;
    expect(
      applyEditableTranslatePatch({
        componentId: "panel",
        property: "translate",
        x: 61,
        y: 40,
      }),
    ).toBe(true);
    const panels = document.querySelectorAll<HTMLElement>(
      '[data-lumencast-bind-animate="panel"]',
    );
    expect([...panels].map((panel) => panel.style.transform)).toEqual([
      "translate3d(61px, 40px, 0px)",
      "translate3d(61px, 40px, 0px)",
    ]);
    expect([...panels].map((panel) => panel.style.willChange)).toEqual([
      "transform",
      "transform",
    ]);
    expect(
      document.querySelector<HTMLElement>(
        '[data-lumencast-bind-animate="other"]',
      )?.style.transform,
    ).toBe("");
  });

  it("applies bounded geometry, text, style, visibility, order and source leaves", () => {
    document.body.innerHTML = `
      <div data-lumencast-bind-animate="panel"><div><svg><rect fill="#000" /></svg></div></div>
      <div data-lumencast-bind-animate="title"><div><span>Before</span></div></div>
      <div data-lumencast-bind-animate="photo"><div><img src="about:blank" /></div></div>
    `;
    const token = (componentId: string) =>
      Array.from(new TextEncoder().encode(componentId), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    const patch = (componentId: string, property: string, value: unknown) =>
      parseEditableFastPatch({
        path: `__editable.${token(componentId)}.${property}`,
        value,
      });
    for (const candidate of [
      patch("panel", "width", 640),
      patch("panel", "height", 360),
      patch("panel", "rotation", 12),
      patch("panel", "opacity", 0.5),
      patch("panel", "zIndex", 9),
      patch("panel", "fill", "#ff0066"),
      patch("title", "value", "After"),
      patch("title", "fontSize", 48),
      patch("title", "colour", "#fff"),
      patch("photo", "src", "https://assets.example/photo.png"),
    ]) {
      expect(candidate).not.toBeNull();
      expect(applyEditableFastPatch(candidate!)).toBe(true);
    }
    const panel = document.querySelector<HTMLElement>(
      '[data-lumencast-bind-animate="panel"]',
    )!;
    expect(panel.style.width).toBe("640px");
    expect(panel.style.height).toBe("360px");
    expect(panel.style.rotate).toBe("12deg");
    expect(panel.style.opacity).toBe("0.5");
    expect(panel.style.zIndex).toBe("9");
    expect(panel.querySelector("rect")?.getAttribute("fill")).toBe("#ff0066");
    const title = document.querySelector<HTMLElement>(
      '[data-lumencast-bind-animate="title"] span',
    )!;
    expect(title.textContent).toBe("After");
    expect(title.style.fontSize).toBe("48px");
    expect(title.style.color).not.toBe("");
    expect(
      document.querySelector<HTMLImageElement>(
        '[data-lumencast-bind-animate="photo"] img',
      )?.src,
    ).toBe("https://assets.example/photo.png");
    expect(patch("panel", "opacity", 2)).toBeNull();
    expect(patch("photo", "src", "javascript:alert(1)")).toBeNull();
  });

  it("requires the explicit Preview URL capability flag", () => {
    expect(editablePreviewFastPathEnabled("?editable_fast=1")).toBe(true);
    expect(editablePreviewFastPathEnabled("?editable_fast=0")).toBe(false);
    expect(editablePreviewFastPathEnabled("?mode=broadcast")).toBe(false);
    const sideband =
      "ws://127.0.0.1:4317/api/v1/show/editable-preview.ws?local_editor_token=cap&role=solar";
    expect(
      readEditablePreviewSidebandUrl(
        `?editable_fast=1&editable_fast_url=${encodeURIComponent(sideband)}`,
      ),
    ).toBe(sideband);
    expect(
      readEditablePreviewSidebandUrl(
        "?editable_fast=1&editable_fast_url=wss%3A%2F%2Fevil.test%2Fsteal",
      ),
    ).toBeNull();
  });

  it("accepts only Orion-confirmed editable sideband frames", () => {
    expect(
      parseAcceptedEditablePatches(
        JSON.stringify({
          type: "accepted_patch",
          scene_id: "editable-1",
          edit_seq: 2,
          patches: [
            {
              path: `__editable.${PANEL_TOKEN}.translate`,
              value: [61, 40],
            },
          ],
        }),
      ),
    ).toEqual([{ componentId: "panel", property: "translate", x: 61, y: 40 }]);
    expect(
      parseAcceptedEditablePatches(
        JSON.stringify({
          type: "ack",
          patches: [
            {
              path: `__editable.${PANEL_TOKEN}.translate`,
              value: [61, 40],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
});
