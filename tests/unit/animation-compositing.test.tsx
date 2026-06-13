// Proving test for the ADR 011 I7 live bug — the keyframe WRAPPER must be a
// REAL compositing box, not a `display:contents` element.
//
// THE BUG (proven live by frame-diff, tir I7 #2). The render bundle Orion
// serves for `core.animation.play@1` was CORRECT: a keyframed `frame`
// wrapper carrying the target's static geometry (x:80,y:360, 160×160) with
// the animated `transform`/`opacity` keyframes, and the resolved target
// (`anim_box`, x/y stripped, its own size+fill) NESTED beneath it. Yet at
// the antenna the box rendered 100×100 pinned at (0,0), immobile — no
// translateX, no fade. Root cause: `@lumencast/runtime`'s `KeyframePlayer`
// wrapped the played subtree in a `<motion.div style={{display:"contents"}}>`.
// A `display:contents` element generates NO box, so the browser silently
// dropped the animated `transform`/`opacity` framer-motion wrote onto it —
// the geometry the wrapper carried never composited and the nested target
// rendered dead at its default origin.
//
// THE FIX (patches/@lumencast+runtime+0.6.0.patch). The player now renders
// `<motion.div style={{position:"absolute", inset:0}}>` — a real compositing
// box that (a) carries the animated channels onto live pixels and (b), being
// positioned, is the containing block for the absolutely-positioned Frame
// nested beneath, so the target's authored x/y are preserved.
//
// This test mounts Solar end-to-end over a fake LSDP/1.1 transport against a
// bundle shaped exactly like the live render-bundle (wrapper frame with the
// target geometry + nested target), and asserts on the actual DOM that the
// keyframe wrapper is a COMPOSITING box carrying the animated transform —
// not a `display:contents` element. happy-dom's wall clock is
// non-deterministic, so we assert the STRUCTURE that makes compositing
// possible (a positioned box with a transform/opacity style), not a precise
// mid-tween pixel sample (that is the Playwright E2E's job).

import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFrame, snapshot, delta } from "@lumencast/protocol";
import type { LeafValue } from "@lumencast/protocol";
import type { RenderBundle, RenderNode } from "@lumencast/runtime";
import { mount } from "../../src/mount";
import { buildAnimationNode } from "../../src/overlay/animation";

const SCENE_ID = "scene-anim";
const SCENE_VERSION = "sha256-anim-0001";
// The scalar generation leaf the exec op increments (ADR 011 §3.2).
const LEAF = "__anim.anim_box";

// The authored keyframe geometry the live render-bundle carries:
// translateX 0→120→360→400 px over 1500 ms, opacity 0→1, ease-out.
const KEYFRAMES = {
  duration_ms: 1500,
  easing: "ease-out" as const,
  steps: [
    { at: 0, transform: { translateX: 0 }, opacity: 0 },
    { at: 0.3, transform: { translateX: 120 }, opacity: 1 },
    { at: 0.8, transform: { translateX: 360 }, opacity: 1 },
    { at: 1, transform: { translateX: 400 }, opacity: 1 },
  ],
};

// The resolved target overlay node — `anim_box` shape, x/y stripped by the
// lowering (the wrapper carries the position), keeping its own size + fill.
const NESTED_TARGET: RenderNode = {
  kind: "shape",
  id: "anim_box",
  props: { width: 160, height: 160, fill: "#C81E5A" },
};

// The wrapper node exactly as the live render-bundle serves it: the target's
// STATIC geometry (x:80, y:360, 160×160) on the wrapper props, the animated
// keyframes keyed on the scalar leaf, and the target NESTED beneath.
const ANIM_NODE = buildAnimationNode({
  leafPath: LEAF,
  keyframes: KEYFRAMES,
  id: "anim_play",
  props: { x: 80, y: 360, width: 160, height: 160 },
  children: [NESTED_TARGET],
});

const BUNDLE: RenderBundle = {
  scene_version: SCENE_VERSION,
  root: { kind: "stack", children: [ANIM_NODE] },
};

// --- fake LSDP/1.1 transport ------------------------------------------

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
        // The scalar generation leaf starts at 0 (ADR 011 §3.2).
        state: { [LEAF]: 0 },
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
async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeout) throw new Error("waitFor: timeout");
    await sleep(10);
  }
}

/** The keyframe player's wrapper — the element that carries the animated
 *  transform/opacity. Post-fix it is a positioned compositing box
 *  (`position:absolute; inset:0`) wrapping the nested target Frame. */
function keyframeWrapper(target: HTMLElement): HTMLElement | null {
  // We resolve via the live CSSOM `style` PROPERTY (not an attribute-substring
  // selector): framer-motion writes the animated `transform`/`opacity` to the
  // element's style object, and happy-dom does not always reflect those into
  // the serialized `style` attribute. The player is the positioned `inset:0`
  // box (NOT `display:contents`) that CONTAINS the nested 160px target Frame —
  // that containment distinguishes it from the scene's other positioned
  // wrappers. The broadcast mode also mounts an OUTER `inset:0` scene
  // container that contains the player, so several boxes match : we pick the
  // INNERMOST (the keyframe player nests beneath the scene container, never
  // the reverse), which is the box carrying the played transform/opacity.
  const candidates = Array.from(target.querySelectorAll<HTMLElement>("div")).filter(
    (el) =>
      el.style.position === "absolute" &&
      (el.style.inset === "0px" || el.style.inset === "0") &&
      Array.from(el.querySelectorAll<HTMLElement>("div")).some((c) => c.style.width === "160px"),
  );
  if (candidates.length === 0) return null;
  // The innermost candidate is the one not containing any other candidate.
  return (
    candidates.find((el) => !candidates.some((other) => other !== el && el.contains(other))) ??
    null
  );
}

describe("ADR 011 I7 — keyframe wrapper composites geometry + transform", () => {
  it("renders the keyframe player as a real positioned box, NOT display:contents", async () => {
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

    // Wait for the keyframe player's compositing box to mount.
    await waitFor(() => keyframeWrapper(target) !== null);
    const wrapper = keyframeWrapper(target)!;

    // THE REGRESSION GUARD: the wrapper must NOT be a `display:contents`
    // element (the dead-pixel bug). It must be a real box.
    expect(wrapper.style.display).not.toBe("contents");
    expect(wrapper.style.position).toBe("absolute");

    // The nested target frame renders BENEATH the wrapper (the wrapper is its
    // containing block), keeping its authored size + fill. The target's
    // geometry is composed INSIDE the animated wrapper — not at the document
    // origin with a default size.
    const box =
      Array.from(wrapper.querySelectorAll<HTMLElement>("div")).find(
        (c) => c.style.width === "160px",
      ) ?? null;
    expect(box, "nested 160px target must render inside the wrapper").not.toBeNull();
    expect(box!.style.width).toBe("160px");
    expect(box!.style.height).toBe("160px");

    handle.disconnect();
    target.remove();
  });

  it("composites the keyframe translateX + opacity onto the wrapper box (not dropped)", async () => {
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
    await waitFor(() => keyframeWrapper(target) !== null);

    // The play runs on mount of the keyed wrapper (the scalar leaf seeded to 0
    // by the snapshot). framer-motion's wall clock is non-deterministic under
    // happy-dom mid-tween, but the SETTLED frame is deterministic: at the end
    // of the 1500 ms sequence the wrapper holds the LAST keyframe waypoint
    // (translateX 400 px, opacity 1). We wait for the wrapper to reach that
    // settled transform — proof the keyframe `translateX` AND `opacity` BOTH
    // composited onto a real box.
    //
    // Pre-fix this could NEVER pass: (a) `display:contents` dropped every
    // animated channel, and (b) the authored `translateX` key was emitted
    // verbatim to framer (which animates `x`/`y`), so the translation was
    // silently ignored even on a real box. Both halves of the I7 live bug.
    await waitFor(() => {
      const w = keyframeWrapper(target);
      return w !== null && w.style.transform.includes("translateX(400px)");
    }, 4000);
    const wrapper = keyframeWrapper(target)!;
    expect(wrapper.style.transform, "wrapper must carry the keyframe translateX").toContain(
      "translateX(400px)",
    );
    expect(wrapper.style.opacity, "wrapper must carry the keyframe opacity").toBe("1");
    // The fix preserves the nested target's authored geometry: it sits at
    // (80,360) 160×160 INSIDE the translating/fading wrapper, not at the
    // origin with a default size.
    const box = Array.from(wrapper.querySelectorAll<HTMLElement>("div")).find(
      (c) => c.style.width === "160px",
    )!;
    expect(box.style.transform).toContain("translateX(80px)");
    expect(box.style.transform).toContain("translateY(360px)");

    // A leaf delta re-triggers the replay (ADR 011 §3.2 — the exec op's tick
    // increments the scalar generation leaf), and the wrapper re-settles to
    // the composited end-state. Proof the reactive replay path also composites.
    FakeWebSocket.last?.push(delta({ seq: 2, patches: [{ path: LEAF, value: 1 as LeafValue }] }));
    await waitFor(() => {
      const w = keyframeWrapper(target);
      return w !== null && w.style.transform.includes("translateX(400px)");
    }, 4000);

    handle.disconnect();
    target.remove();
  });
});
