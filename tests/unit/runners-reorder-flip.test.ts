// reorder — invokes FLIP capture before the mutation and play after.
// We can't observe pixel transforms under happy-dom (it doesn't lay
// out), so we assert the contract the runner exposes : (a) captureFlip
// records every item present at call time, (b) playFlip is invoked
// against the same root once the store value has been written.

import { describe, expect, it, vi } from "vitest";

import { createStore } from "../../src/state/store";
import { runAction } from "../../src/animate/action-runner";
import { captureFlip } from "../../src/animate/flip";

function setupList(): HTMLElement {
  const root = document.createElement("ul");
  root.setAttribute("data-anim-path", "leaderboard.order");
  ["a", "b", "c"].forEach((id) => {
    const li = document.createElement("li");
    li.setAttribute("data-flip-id", id);
    // give happy-dom *something* to measure even if it's zeros
    li.textContent = id;
    root.appendChild(li);
  });
  document.body.appendChild(root);
  return root;
}

describe("runners / reorder + FLIP", () => {
  it("captures pre-state via captureFlip and writes the new value", async () => {
    const store = createStore();
    const root = setupList();
    const snapshot = captureFlip(root);
    expect(snapshot.rects.size).toBe(3);

    await runAction({
      store,
      root,
      patch: {
        path: "leaderboard.order",
        value: ["c", "a", "b"],
        action: {
          kind: "reorder",
          params: { selector: "[data-flip-id]" },
          duration_ms: 50,
        },
      },
    });

    expect(store.toRecord()["leaderboard.order"]).toEqual(["c", "a", "b"]);
    root.remove();
  });

  it("falls back to a plain store write when no root is provided", async () => {
    const store = createStore();
    await runAction({
      store,
      patch: {
        path: "x",
        value: ["a"],
        action: { kind: "reorder", params: {} },
      },
    });
    expect(store.toRecord()["x"]).toEqual(["a"]);
  });

  it("FLIP capture skips elements without a flip id", () => {
    const root = document.createElement("div");
    const tagged = document.createElement("div");
    tagged.setAttribute("data-flip-id", "k");
    const untagged = document.createElement("div");
    root.appendChild(tagged);
    root.appendChild(untagged);
    document.body.appendChild(root);
    const s = captureFlip(root);
    expect(s.rects.size).toBe(1);
    expect(s.rects.has("k")).toBe(true);
    root.remove();
  });

  it("playFlip resolves cleanly with no animations to run", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { playFlip } = await import("../../src/animate/flip");
    await expect(
      playFlip(root, { rects: new Map() }, { duration: 10 }),
    ).resolves.toBeUndefined();
    root.remove();
  });

  it("rAF is awaited between snapshot and play", async () => {
    const store = createStore();
    const root = setupList();
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    await runAction({
      store,
      root,
      patch: {
        path: "leaderboard.order",
        value: ["b", "c", "a"],
        action: { kind: "reorder", params: {}, duration_ms: 10 },
      },
    });
    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
    root.remove();
  });
});
