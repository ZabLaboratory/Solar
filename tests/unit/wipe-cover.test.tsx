// Proving test for the authored "wipe-cover" overlay element (M10 — Pulsar
// ADR 003 §A4.2). Two planes of proof:
//
//   1. STRUCTURE (deterministic) — `buildWipeCoverNode(...)` emits a
//      full-screen opaque `frame` whose keyframe sequence RISES to a fully
//      opaque plateau (opacity 1) and HOLDS it for exactly `hold_ms`, then
//      retracts. This is the "reaches the opaque plateau during hold_ms"
//      contract guarantee — proven on the authored keyframe shape, not on a
//      framer-motion wall-clock sample (which is non-deterministic in
//      happy-dom).
//
//   2. LIVE REACTIVE (M9 path) — mounting Solar end-to-end over a fake
//      LSDP/1.1 transport, a `scene_control` LEAF DELTA carrying a new
//      `overlay` makes the runtime REPLAY the element's animation: the
//      overlay's opacity is actively driven through intermediate values
//      (the keyframe tween runs). The delta flows `applyDelta` → the leaf's
//      signal → the runtime's `KeyframePlayer` (keyed off the leaf path) →
//      a fresh play. NOT `scene_changed`, NOT the runtime `<Crossfade>` —
//      the exact in-DOM, leaf-driven repaint M9 proved.

import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFrame, snapshot, delta } from "@lumencast/protocol";
import type { LeafValue } from "@lumencast/protocol";
import type { RenderBundle } from "@lumencast/runtime";
import { mount } from "../../src/mount";
import {
  buildWipeCoverNode,
  parseWipeCoverOverlay,
  type WipeCoverOverlay,
} from "../../src/overlay/wipe-cover";

const SCENE_ID = "scene-m10";
const SCENE_VERSION = "sha256-m10-0001";
// The F1 3-segment canonical leaf path (ADR 003 Amendment 2 §A2.2).
const LEAF = "__inputs.blue.m10-scene-control.scene_control";

const OVERLAY: WipeCoverOverlay = {
  kind: "wipe-cover",
  reveal_ms: 250,
  hold_ms: 200,
  retract_ms: 250,
};

// --- 1. STRUCTURE — deterministic keyframe proof ----------------------

describe("buildWipeCoverNode() — authored keyframe structure", () => {
  it("emits a full-screen opaque frame keyed off the scene_control leaf", () => {
    const node = buildWipeCoverNode({ leafPath: LEAF, overlay: OVERLAY });
    expect(node.kind).toBe("frame");
    // Full-screen, opaque, static (never on the layout path).
    expect(node.props).toMatchObject({ width: "100%", height: "100%" });
    // The cover paints a VISIBLE magenta fill by default (#C81E5A, the M9
    // demo colour) — NOT black. At the opaque plateau (opacity 1) the whole
    // screen is this magenta; that is what the M10 probe asserts on the MID
    // frame to distinguish "our engine painted the cover" from "cold black
    // capture". A black default would make MID indistinguishable from a
    // non-rendered frame.
    expect(node.props?.background).toBe("#C81E5A");
    // THE reactive trigger: the keyframe `key` is the leaf path, so a delta
    // on that leaf replays the sequence (M9). Not scene_changed.
    expect(node.keyframes?.key).toBe(LEAF);
  });

  it("rises to a fully-opaque plateau and HOLDS it for exactly hold_ms", () => {
    const node = buildWipeCoverNode({ leafPath: LEAF, overlay: OVERLAY });
    const kf = node.keyframes;
    expect(kf).toBeDefined();
    const total = OVERLAY.reveal_ms + OVERLAY.hold_ms + OVERLAY.retract_ms;
    expect(kf?.duration_ms).toBe(total);

    const steps = kf?.steps ?? [];
    // Endpoints transparent (content visible before/after the wipe).
    expect(steps[0]).toEqual({ at: 0, opacity: 0 });
    expect(steps[steps.length - 1]).toEqual({ at: 1, opacity: 0 });

    // The two interior steps form the opaque plateau (opacity 1 → 1). The
    // plateau opens at reveal_ms and closes at reveal_ms+hold_ms.
    const opaque = steps.filter((s) => s.opacity === 1);
    expect(opaque).toHaveLength(2);
    const [plateauOpen, plateauClose] = opaque;
    if (!plateauOpen || !plateauClose) throw new Error("expected a 2-step opaque plateau");
    const plateauStartAt = plateauOpen.at;
    const plateauEndAt = plateauClose.at;
    expect(plateauStartAt).toBeCloseTo(OVERLAY.reveal_ms / total, 6);
    expect(plateauEndAt).toBeCloseTo((OVERLAY.reveal_ms + OVERLAY.hold_ms) / total, 6);

    // The opaque window's real-time width equals hold_ms — the cut window.
    const plateauMs = (plateauEndAt - plateauStartAt) * total;
    expect(plateauMs).toBeCloseTo(OVERLAY.hold_ms, 6);
  });

  it("only opacity animates (GPU-only — no layout, no width/height keyframes)", () => {
    const node = buildWipeCoverNode({ leafPath: LEAF, overlay: OVERLAY });
    for (const step of node.keyframes?.steps ?? []) {
      expect(Object.keys(step).sort()).toEqual(["at", "opacity"]);
    }
  });
});

describe("parseWipeCoverOverlay()", () => {
  it("accepts a valid wipe-cover sub-object", () => {
    expect(parseWipeCoverOverlay(OVERLAY)).toEqual(OVERLAY);
  });
  it("rejects a non-wipe-cover or malformed value (no throw into render)", () => {
    expect(parseWipeCoverOverlay(undefined)).toBeUndefined();
    expect(parseWipeCoverOverlay({ kind: "other" })).toBeUndefined();
    expect(
      parseWipeCoverOverlay({ kind: "wipe-cover", reveal_ms: 0, hold_ms: 1, retract_ms: 1 }),
    ).toBeUndefined();
    expect(
      parseWipeCoverOverlay({ kind: "wipe-cover", reveal_ms: 1.5, hold_ms: 1, retract_ms: 1 }),
    ).toBeUndefined();
  });
});

// --- 2. LIVE REACTIVE — the M9 leaf→repaint proof, end-to-end ---------

const BUNDLE: RenderBundle = {
  scene_version: SCENE_VERSION,
  root: {
    kind: "stack",
    children: [buildWipeCoverNode({ leafPath: LEAF, overlay: OVERLAY })],
  },
};

// Minimal LSDP/1.1 fake WebSocket — opens, answers `subscribe` with an
// (overlay-less) snapshot, and lets the test push deltas via `last.push`.
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
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

  constructor(public url: string) {
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
        seq: 1,
        scene_id: SCENE_ID,
        scene_version: SCENE_VERSION,
        state: {},
      });
      queueMicrotask(() => this.onmessage?.({ data: encodeFrame(snap) }));
    }
  }
  push(frame: ReturnType<typeof delta>): void {
    this.onmessage?.({ data: encodeFrame(frame) });
  }
  close(): void {
    this.readyState = this.CLOSED;
    this.onclose?.({ code: 1000, reason: "client closing" });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  FakeWebSocket.last = null;
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The runtime's KeyframePlayer wraps the played subtree in a motion.div
 *  whose opacity carries the live keyframe value. Since the ADR 011 I7
 *  compositing fix that wrapper is a REAL box (`position:absolute; inset:0`)
 *  — a `display:contents` element generated no box and silently dropped the
 *  animated opacity at the antenna. We read the opacity off the player box,
 *  identified as the positioned `inset:0` wrapper that framer-motion drives
 *  (it carries an `opacity` style). The live CSSOM `style` property is read
 *  directly (happy-dom does not always serialise it into the attribute). */
function overlayOpacity(target: HTMLElement): number | undefined {
  const wrapper = Array.from(target.querySelectorAll<HTMLElement>("div")).find(
    (el) =>
      el.style.position === "absolute" &&
      (el.style.inset === "0px" || el.style.inset === "0") &&
      el.style.opacity !== "",
  );
  if (!wrapper) return undefined;
  const v = Number(wrapper.style.opacity);
  return Number.isNaN(v) ? undefined : v;
}

async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeout) throw new Error("waitFor: timeout");
    await sleep(10);
  }
}

describe("wipe-cover overlay — leaf delta replays the animation (M9 path)", () => {
  it("a scene_control delta with overlay:{...} drives an in-DOM opacity animation, not a static cut", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(BUNDLE), { status: 200 })),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const handle = mount({
      target,
      orionUrl: "wss://gate.example/orion/api/v1/show/stream",
      token: "operator-token",
      mode: "broadcast",
    });

    // The opaque cover frame is rendered (full-screen 100% box), wrapped by
    // the runtime's KeyframePlayer — a REAL compositing box (`position:
    // absolute; inset:0`, post-ADR-011-I7 fix) carrying the live opacity.
    await waitFor(() => overlayOpacity(target) !== undefined);

    // --- THE DELTA: a new scene_control value carrying the overlay. This is
    // the M10 leaf write Blue pushes; Solar receives it over the same
    // /show/stream fan-out the M9 repaint uses. It lands via applyDelta on
    // the very leaf the keyframe sequence is keyed on (LEAF).
    const last = FakeWebSocket.last;
    expect(last).not.toBeNull();
    last?.push(
      delta({
        seq: 2,
        patches: [
          {
            path: LEAF,
            // The scene_control leaf value is an OBJECT on the wire (the
            // ADR 003 §A4.2 contract). `@lumencast/protocol`'s `LeafValue`
            // under-types object-valued leaves (it omits the object case),
            // so we cast at the boundary — the JSON wire carries it fine and
            // the runtime reads `overlay` off it.
            value: {
              target_scene: "scene-screen-2",
              overlay: OVERLAY,
              cut_at_ms: 250,
            } as unknown as LeafValue,
          },
        ],
      }),
    );

    // Sample the overlay opacity densely across the play window. A static
    // cover (or an OBS-native hard cut) would hold one constant opacity; an
    // in-DOM keyframe tween driven by our engine passes CONTINUOUSLY through
    // many intermediate values between transparent (0) and opaque (1). That
    // continuous interpolation is the proof the animation is rendered by
    // Solar's engine reactively, not painted by OBS.
    //
    // Note: the exact opacity at a given wall-clock instant (i.e. "== 1
    // during hold_ms") is NOT asserted here — framer-motion runs on a real
    // RAF/timer clock that is non-deterministic under happy-dom. That the
    // plateau REACHES opacity 1 across hold_ms is proven deterministically
    // above on the authored keyframe structure; the visual mid-transition
    // capture is the Playwright E2E's job (CLAUDE.md — animation engine via
    // Playwright). Here we prove the reactive seam: a leaf delta animates
    // the cover in-DOM.
    const distinct = new Set<number>();
    let sawIntermediate = false;
    for (let i = 0; i < 80; i++) {
      await sleep(8);
      const o = overlayOpacity(target);
      if (o !== undefined) {
        distinct.add(Math.round(o * 1000) / 1000);
        if (o > 0.05 && o < 0.95) sawIntermediate = true;
      }
    }

    // The cover passed through strictly-intermediate opacities → an animated
    // wipe, not a cut.
    expect(sawIntermediate).toBe(true);
    // …and through many distinct waypoints → a real tween, not a 0↔1 toggle.
    expect(distinct.size).toBeGreaterThan(3);

    handle.disconnect();
    target.remove();
  });
});
