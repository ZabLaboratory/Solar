import { describe, expect, it } from "vitest";
import { buildAnimationNode } from "../../src/overlay/animation";
import { buildWipeCoverNode } from "../../src/overlay/wipe-cover";

// I2 (ADR 011 §3.3) — the Solar oracle twin of Orion's lower_animation.go
// buildAnimationNode. These tests pin the bundle-fragment shape the Go↔TS
// parity test (Orion-side) asserts against, and prove wipe-cover is the
// degenerate case of the general builder (§3.5 / I4).

describe("buildAnimationNode()", () => {
  it("frames an authored keyframe block into a full-screen frame keyed on the scalar leaf", () => {
    const node = buildAnimationNode({
      leafPath: "__anim.ov",
      id: "anim-1",
      keyframes: {
        duration_ms: 500,
        easing: "ease-out",
        steps: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
      },
    });

    expect(node).toEqual({
      kind: "frame",
      id: "anim-1",
      props: { width: "100%", height: "100%", background: "#C81E5A" },
      keyframes: {
        key: "__anim.ov",
        duration_ms: 500,
        easing: "ease-out",
        steps: [
          { at: 0, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
      },
    });
  });

  it("overrides any authored key with the compiler-bound leaf (ADR 011 §3.3)", () => {
    const node = buildAnimationNode({
      leafPath: "__anim.scoreboard",
      keyframes: {
        key: "authored.leaf.to.be.overridden",
        duration_ms: 200,
        easing: "linear",
        steps: [
          { at: 0, opacity: 1 },
          { at: 1, opacity: 0 },
        ],
      },
    });
    expect(node.keyframes?.key).toBe("__anim.scoreboard");
    // id defaults to "wipe-cover" for byte-parity with the degenerate node.
    expect(node.id).toBe("wipe-cover");
  });

  it("frames the general animation.play path as a transform WRAPPER dimensioned to the target, with the target NESTED (I7 geometry fix)", () => {
    // The I7 live-bug fix: the general path is NOT a full-screen aplat
    // (translating/fading a 1920×1080 uniform fill is invisible). The
    // wrapper is sized/positioned to the target overlay, and the target is
    // nested beneath so it inherits the animated transform/opacity. The
    // wrapper carries NO background — it is a transparent transform host.
    const node = buildAnimationNode({
      leafPath: "__anim.anim_box",
      id: "anim-1",
      props: { x: 80, y: 360, width: 160, height: 160 },
      children: [
        {
          kind: "shape",
          id: "anim_box",
          props: { width: 160, height: 160, background: "#C81E5A" },
        },
      ],
      keyframes: {
        duration_ms: 500,
        easing: "ease-out",
        steps: [
          { at: 0, transform: { translateX: 0 } },
          { at: 1, transform: { translateX: 200 } },
        ],
      },
    });

    expect(node).toEqual({
      kind: "frame",
      id: "anim-1",
      // wrapper geometry = the target's box; NO background (transparent host)
      props: { x: 80, y: 360, width: 160, height: 160 },
      keyframes: {
        key: "__anim.anim_box",
        duration_ms: 500,
        easing: "ease-out",
        steps: [
          { at: 0, transform: { translateX: 0 } },
          { at: 1, transform: { translateX: 200 } },
        ],
      },
      // target nested beneath → inherits the animated transform
      children: [
        {
          kind: "shape",
          id: "anim_box",
          props: { width: 160, height: 160, background: "#C81E5A" },
        },
      ],
    });
  });

  it("subsumes wipe-cover: a reveal/hold/retract asset frames identically (§3.5)", () => {
    // The wipe-cover specialisation expressed as a general Animation Asset:
    // the same 4-step opacity geometry buildWipeCoverNode emits, framed by
    // the general builder — proving no geometry is duplicated (I4).
    const reveal = 400;
    const hold = 500;
    const retract = 400;
    const total = reveal + hold + retract;
    const wipe = buildWipeCoverNode({
      leafPath: "__inputs.blue.m10-scene-control.scene_control",
      overlay: { kind: "wipe-cover", reveal_ms: reveal, hold_ms: hold, retract_ms: retract },
    });
    const general = buildAnimationNode({
      leafPath: "__inputs.blue.m10-scene-control.scene_control",
      keyframes: {
        duration_ms: total,
        easing: "ease-in-out",
        steps: [
          { at: 0, opacity: 0 },
          { at: reveal / total, opacity: 1 },
          { at: (reveal + hold) / total, opacity: 1 },
          { at: 1, opacity: 0 },
        ],
      },
    });
    expect(general).toEqual(wipe);
  });
});
