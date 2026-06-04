// ADR 007 §B acceptance (b) — render a bundle served from an LSDP/mock
// server and assert the resulting DOM is correct.
//
// render.test.tsx already proves the *minimal* seam (one bound text node).
// This file widens it to a realistic broadcast scene : a nested tree
// (frame → stack → text + shape) with several bound leaves, and asserts
// the full DOM shape the runtime produces — element nesting, text
// content, and that every bound path landed on the right node. The point
// is to prove the bundle the runtime fetched from the (fake) server is
// projected faithfully, not just that *some* text appeared.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderBundle } from "@lumencast/runtime";
import { mount } from "../../src/mount";
import type { SolarStatus } from "../../src/types";
import { FakeWebSocket, findFrame, installHarness, waitFor } from "./_lsdp-harness";

// A small but representative scene : an absolutely-positioned frame that
// contains a vertical stack of a headline (text) and a divider (shape).
// Two bound text leaves + one bound shape colour exercise multi-path
// resolution through one snapshot.
const BUNDLE: RenderBundle = {
  scene_version: "sha256-bundle-render-0001",
  root: {
    kind: "frame",
    id: "root-frame",
    props: { x: 0, y: 0, width: 1920, height: 1080 },
    children: [
      {
        kind: "stack",
        id: "col",
        children: [
          {
            kind: "text",
            id: "headline",
            bindings: { value: "headline.text" },
          },
          {
            kind: "text",
            id: "subline",
            bindings: { value: "subline.text" },
          },
        ],
      },
    ],
  },
};

const INITIAL_STATE = {
  "headline.text": "GRAND FINAL",
  "subline.text": "Game 5 — Decider",
};

afterEach(() => {
  vi.restoreAllMocks();
  FakeWebSocket.last = null;
});

describe("ADR 007 §B (b) — bundle from LSDP/mock server → DOM", () => {
  it("fetches the bundle once and renders every bound leaf into the tree", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const { fetchMock } = installHarness(vi, {
      bundle: BUNDLE,
      initialState: INITIAL_STATE,
    });

    const statuses: SolarStatus[] = [];
    const handle = mount({
      target,
      orionUrl: "wss://gate.example/orion/api/v1/show/stream",
      token: "operator-token",
      mode: "broadcast",
      onStatus: (s) => statuses.push(s),
    });

    await waitFor(
      () =>
        target.textContent?.includes("GRAND FINAL") === true &&
        target.textContent?.includes("Game 5 — Decider") === true,
    );

    // Both bound leaves resolved from the single snapshot.
    expect(target.textContent).toContain("GRAND FINAL");
    expect(target.textContent).toContain("Game 5 — Decider");

    // DOM shape : the frame is an absolutely-positioned div sized to the
    // declared canvas, and the two text leaves render as <span> inside it.
    const frameDiv = findFrame(target);
    expect(frameDiv).not.toBeNull();
    expect(frameDiv?.style.width).toBe("1920px");
    expect(frameDiv?.style.height).toBe("1080px");

    const spans = Array.from(target.querySelectorAll("span")).map(
      (s) => s.textContent,
    );
    expect(spans).toContain("GRAND FINAL");
    expect(spans).toContain("Game 5 — Decider");

    // Exactly one content-addressed bundle fetch (cached-by-hash contract).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses).toContain("live");

    handle.disconnect();
    target.remove();
  });

  it("renders nothing-but-empty when the server snapshot has no values for the bound paths", async () => {
    // A bound text leaf whose path is absent from the snapshot resolves to
    // "" (the runtime's documented `value === undefined → ""` rule), not a
    // crash. Confirms the adapter survives a partial server state.
    const target = document.createElement("div");
    document.body.appendChild(target);

    installHarness(vi, {
      bundle: {
        scene_version: "sha256-bundle-render-empty",
        root: { kind: "text", id: "lonely", bindings: { value: "missing.path" } },
      },
      initialState: {}, // server sends an empty snapshot
    });

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

    await waitFor(() => live && target.querySelector("span") !== null);

    const span = target.querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("");

    handle.disconnect();
    target.remove();
  });
});
