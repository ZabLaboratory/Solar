// Reproduction of the prod "Solar paints black in mode=broadcast" incident
// (repo Solar v0.2.8, live leaderboard scene `57dc631f`).
//
// THE TRAP this test exists to pin: the existing render.test.tsx mounts a
// bundle whose text node binds the RENDER-vocab key `value` — and that
// works. Prod paints black because Orion shipped a bundle whose text node
// binds the AUTHORING-vocab key `text` (the natural Canvas key for a text
// node's content). The runtime's text primitive reads `resolved.value`
// only (prop-allowlist: text → {value, …}, `text` is NOT consumed). So a
// `text:`-keyed binding lands on `resolved.text` (ignored) while
// `resolved.value` stays undefined → empty span → black.
//
// This test reproduces the EXACT prod inputs end-to-end through Solar's
// real mount() over @lumencast/runtime in mode=broadcast:
//   - snapshot leaf  __vars..leaderboard_display = "1. GIDEON — 9\n…"
//   - bundle text node bound on the SAME leaf, but keyed `text:`
// and proves the leaderboard text is absent from the rendered DOM (the
// black). The companion fixed-input case (binding keyed `value:`) proves
// the same leaf DOES paint once the binding key is the render vocab — i.e.
// the defect is the binding KEY, lowered by Orion, not Solar's render path.

import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFrame, snapshot } from "@lumencast/protocol";
import type { RenderBundle } from "@lumencast/runtime";
import { mount } from "../../src/mount";

const SCENE_ID = "57dc631f";
const SCENE_VERSION = "sha256-f6c907-leaderboard";

// The exact bound leaf the wire emits (double-dot path preserved verbatim).
const LEADERBOARD_LEAF = "__vars..leaderboard_display";
const LEADERBOARD_TEXT =
  "1. GIDEON — 9\n2. Teddy — 8\n3. Loki — 7\n4. Gumayusi — 7\n5. Namgung — 6";

const SNAPSHOT_STATE = {
  [LEADERBOARD_LEAF]: LEADERBOARD_TEXT,
};

// PROD bundle (the black): text node bound on the leaf via the AUTHORING
// key `text` — exactly what Orion shipped for scene 57dc631f.
const BUNDLE_TEXT_KEYED: RenderBundle = {
  scene_version: SCENE_VERSION,
  root: {
    kind: "stack",
    children: [
      {
        kind: "text",
        id: "leaderboard",
        props: { colour: "#ffd200" },
        bindings: { text: LEADERBOARD_LEAF },
      },
    ],
  },
};

// FIXED bundle: same leaf, keyed on the RENDER vocab `value` (what Orion's
// lowering must emit). Proves the leaf and snapshot are correct and the
// only defect is the binding key.
const BUNDLE_VALUE_KEYED: RenderBundle = {
  scene_version: SCENE_VERSION,
  root: {
    kind: "stack",
    children: [
      {
        kind: "text",
        id: "leaderboard",
        props: { colour: "#ffd200" },
        bindings: { value: LEADERBOARD_LEAF },
      },
    ],
  },
};

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  protocol = "lsdp.v1.1";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(
    public url: string,
    _protocols?: string | string[],
  ) {
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = this.OPEN;
      this.onopen?.();
    });
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as { type?: string };
    if (frame.type === "subscribe") {
      const snap = snapshot({
        seq: 8,
        scene_id: SCENE_ID,
        scene_version: SCENE_VERSION,
        state: SNAPSHOT_STATE,
      });
      queueMicrotask(() => this.onmessage?.({ data: encodeFrame(snap) }));
    }
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = this.CLOSED;
    this.onclose?.({ code: 1000, reason: "client closing" });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  FakeWebSocket.last = null;
});

function mountBroadcast(bundle: RenderBundle, target: HTMLElement) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200 })),
  );
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  return mount({
    target,
    orionUrl: "wss://gate.example/orion/api/v1/show/stream",
    token: "show-token",
    mode: "broadcast",
  });
}

describe("Solar broadcast leaderboard render (prod incident 57dc631f)", () => {
  it("REPRODUCES the black: a `text:`-keyed binding leaves the span empty", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const handle = mountBroadcast(BUNDLE_TEXT_KEYED, target);

    // Wait until broadcast mode has mounted the scene tree (the span node
    // exists), so we assert on a rendered-but-empty span, not on a race.
    await waitFor(() => target.querySelector("span") !== null);
    // Give any binding resolution a chance to paint, then assert the leaf
    // text is absent — the black.
    await new Promise((r) => setTimeout(r, 50));

    expect(target.textContent).not.toContain("GIDEON");
    expect(target.querySelector("span")?.textContent ?? "").toBe("");

    handle.disconnect();
    target.remove();
  });

  it("paints once the binding is keyed on the render vocab `value`", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const handle = mountBroadcast(BUNDLE_VALUE_KEYED, target);

    await waitFor(() => target.textContent?.includes("GIDEON") === true);

    expect(target.textContent).toContain("1. GIDEON — 9");
    expect(target.textContent).toContain("5. Namgung — 6");
    // The jaune is on the span (render path honoured the colour prop).
    expect(target.querySelector("span")?.style.color).not.toBe("");

    handle.disconnect();
    target.remove();
  });
});

async function waitFor(
  predicate: () => boolean,
  { timeout = 2000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeout) {
      throw new Error("waitFor: predicate not satisfied within timeout");
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
