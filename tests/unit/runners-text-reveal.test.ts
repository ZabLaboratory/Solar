// text-reveal — stagger each `[data-anim-unit]` child of the target.
// We assert the runner walked every unit and toggled the state attr ;
// happy-dom's `element.animate` is a stub that resolves immediately,
// so the runner returns quickly under test.

import { describe, expect, it } from "vitest";

import { createStore } from "../../src/state/store";
import { runAction } from "../../src/animate/action-runner";

function setupRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-anim-path", "headline.text");
  const html = "Hello";
  for (const ch of html) {
    const span = document.createElement("span");
    span.setAttribute("data-anim-unit", "letter");
    span.textContent = ch;
    root.appendChild(span);
  }
  document.body.appendChild(root);
  return root;
}

describe("runners / text-reveal", () => {
  it("walks every [data-anim-unit] child and tags it with the state attr", async () => {
    const store = createStore();
    const root = setupRoot();
    const host = document.body;

    await runAction({
      store,
      root: host,
      patch: {
        path: "headline.text",
        value: "Hello",
        action: {
          kind: "text-reveal",
          params: { unit: "letter", stagger_ms: 10, per_unit_ms: 20 },
          duration_ms: 100,
          child_selector: { kind: "all", value: "[data-anim-unit]" },
        },
      },
    });

    const units = root.querySelectorAll("[data-anim-unit]");
    expect(units).toHaveLength(5);
    units.forEach((el) => {
      expect(el.getAttribute("data-anim-state")).toBe("in");
    });

    root.remove();
  });

  it("does nothing gracefully when no children match the selector", async () => {
    const store = createStore();
    const root = document.createElement("div");
    root.setAttribute("data-anim-path", "empty");
    document.body.appendChild(root);

    await runAction({
      store,
      root: document.body,
      patch: {
        path: "empty",
        value: "",
        action: {
          kind: "text-reveal",
          params: {},
          child_selector: { kind: "all", value: "[data-anim-unit]" },
        },
      },
    });

    root.remove();
    // No throw, no state mutation expected.
    expect(store.toRecord()).toEqual({});
  });
});
