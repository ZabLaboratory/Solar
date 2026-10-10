import { afterEach, describe, expect, it, vi } from "vitest";
import type { LSMLDocument } from "../../src/scenes/native-document";
import {
  compileCatalogue,
  samplePlan,
  sampleAnimation,
  nodeAnimations,
} from "../../src/engine/motion/timeline";
import { curve } from "../../src/engine/motion/curves";
import {
  MotionPlayback,
  VisionAnimations,
} from "../../src/engine/motion/player";
import {
  animationLeaf,
  animationPatch,
  prepareAnimationBindings,
} from "../../src/engine/animations";

const leaf = (
  target: string,
  property: string,
  from: number | string,
  to: number | string,
  duration = 100,
) => ({
  target,
  keyframes: {
    duration_ms: duration,
    steps: [
      { at: 0, [property]: from },
      { at: 1, [property]: to },
    ],
  },
});
const scene = (animations: Record<string, unknown>): LSMLDocument => ({
  lsml: "1.2",
  scene_id: "motion",
  scene_version: `sha256:${"c".repeat(64)}`,
  defaults: {},
  layout: {
    kind: "frame",
    id: "panel",
    size: { w: 100, h: 100 },
    position: { x: 30, y: 20 },
    background: "#000000",
    children: [],
  },
  animations,
});
const channel = (frames: ReturnType<MotionPlayback["sample"]>, key: string) =>
  frames.find((f) => f.target === "panel")?.values[key];
afterEach(() => vi.unstubAllGlobals());
describe("compiled composed motion", () => {
  it("projects imported/long node ids into valid bounded native leaf segments", () => {
    for (const id of ["1:27", "�quipe sponsor", "x".repeat(200)]) {
      const path = animationLeaf(id, "scaleX"),
        segment = path.split(".")[2]!;
      expect(segment.length).toBeLessThanOrEqual(64);
      expect(segment).toMatch(/^[a-zA-Z_][a-zA-Z0-9_-]*$/);
      expect(path).toBe(animationLeaf(id, "scaleX"));
      expect(path).not.toBe(animationLeaf(id + "next", "scaleX"));
    }
  });

  it("compiles nested n-stage sequences, parallel tracks and delays deterministically", () => {
    const plans = compileCatalogue(
      scene({
        move: leaf("panel", "translateX", 0, 100),
        fade: leaf("panel", "opacity", 0, 1),
        settle: leaf("panel", "translateX", 100, 110),
        show: {
          sequence: [
            { parallel: ["move", { animation: "fade", delay_ms: 50 }] },
            "settle",
          ],
        },
      }),
    );
    expect(plans.show!.duration).toBe(250);
    expect(samplePlan(plans.show!, 75)[0]?.values).toEqual({
      translateX: 75,
      opacity: 0.25,
    });
    expect(samplePlan(plans.show!, 200)[0]?.values).toEqual({
      translateX: 105,
      opacity: 1,
    });
  });
  it("stagger shifts whole child compositions and later authored overlapping channels win", () => {
    const plan = compileCatalogue(
      scene({
        show: {
          parallel: [
            leaf("panel", "opacity", 0, 1),
            leaf("panel", "opacity", 0.2, 0.8),
          ],
          stagger_ms: 50,
        },
      }),
    ).show!;
    expect(plan.duration).toBe(150);
    expect(samplePlan(plan, 75)[0]?.values.opacity).toBeCloseTo(0.35);
  });
  it("keeps independent easing per property and segment, including holds", () => {
    const asset = {
      target: "panel",
      keyframes: {
        duration_ms: 200,
        steps: [
          {
            at: 0,
            opacity: 0,
            translateX: 0,
            easing: { opacity: "hold", translateX: "ease-in" },
          },
          { at: 0.5, opacity: 1, translateX: 100, easing: "linear" },
          { at: 1, opacity: 0.5, translateX: 150 },
        ],
      },
    };
    expect(sampleAnimation(asset, 0.25).opacity).toBe(0);
    expect(sampleAnimation(asset, 0.25).translateX).toBeCloseTo(31.536, 2);
    expect(sampleAnimation(asset, 0.75)).toEqual({
      opacity: 0.75,
      translateX: 125,
    });
  });
  it("selects the final value at duplicate timestamps without divide-by-zero", () => {
    const asset = {
      target: "panel",
      keyframes: {
        duration_ms: 100,
        steps: [
          { at: 0, opacity: 0 },
          { at: 0.5, opacity: 0.2 },
          { at: 0.5, opacity: 0.8 },
          { at: 1, opacity: 1 },
        ],
      },
    };
    expect(sampleAnimation(asset, 0.5).opacity).toBe(0.8);
    expect(sampleAnimation(asset, 0.75).opacity).toBeCloseTo(0.9);
  });
  it("samples damped springs consistently across under/critical/over damping", () => {
    for (const damping of [8, 20, 40]) {
      const ease = curve(
        { type: "spring", stiffness: 100, mass: 1, damping },
        1000,
      );
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(Number.isFinite(ease(0.3))).toBe(true);
    }
    expect(
      curve(
        { type: "spring", stiffness: 100, mass: 1, damping: 8 },
        1000,
      )(0.35),
    ).toBeGreaterThan(1);
    expect(() => curve({ type: "spring", mass: 0 })).toThrow();
  });
  it("interpolates RGB/alpha in sRGB and supports nested canonical transforms", () => {
    const plan = compileCatalogue(
      scene({
        show: {
          target: "panel",
          keyframes: {
            duration_ms: 100,
            steps: [
              {
                at: 0,
                background: "#f000",
                transform: { translate: [0, 10], scale: [1, 0.5], rotate: 0 },
                filter: { blur: 0 },
              },
              {
                at: 1,
                background: "rgba(0,0,255,1)",
                transform: { translate: [50, 20], scale: 2, rotate: 90 },
                filter: { blur: 8 },
              },
            ],
          },
        },
      }),
    ).show!;
    expect(samplePlan(plan, 50)[0]?.values).toEqual({
      background: "#80008080",
      translateX: 25,
      translateY: 15,
      scaleX: 1.5,
      scaleY: 1.25,
      rotation: 45,
      blur: 4,
    });
  });
  it("samples cubic paths, orientation and independently animated path progress", () => {
    const plan = compileCatalogue(
      scene({
        path: {
          target: "panel",
          motion_path: {
            points: [
              [0, 0],
              [0, 100],
              [100, 100],
              [100, 0],
            ],
            orient: true,
          },
          keyframes: {
            duration_ms: 100,
            steps: [
              { at: 0, pathProgress: 0 },
              { at: 1, pathProgress: 1 },
            ],
          },
        },
      }),
    ).path!;
    expect(samplePlan(plan, 50)[0]?.values).toEqual({
      translateX: 50,
      translateY: 75,
      rotation: 0,
    });
    expect(samplePlan(plan, 0)[0]?.values.rotation).toBe(90);
  });
  it("rejects cyclic, unknown, ambiguous, excessive and unsupported authoring", () => {
    for (const animations of [
      { a: { sequence: ["a"] } },
      { a: { parallel: ["missing"] } },
      { a: { parallel: [], sequence: [] } },
      { a: { parallel: [leaf("panel", "opacity", 0, 1)], delay_ms: 600001 } },
      {
        a: {
          target: "panel",
          keyframes: {
            duration_ms: 100,
            steps: [{ at: 0, filter: { brightness: 2 } }],
          },
        },
      },
    ])
      expect(() => compileCatalogue(scene(animations))).toThrow();
    let nested: unknown = leaf("panel", "opacity", 0, 1);
    for (let i = 0; i < 20; i++) nested = { sequence: [nested] };
    expect(() => compileCatalogue(scene({ a: nested }))).toThrow("depth");
  });
  it("prepares bound retained transforms/effects, preserves authority and restores cancelled channels", () => {
    const source = scene({
      show: {
        target: "panel",
        keyframes: {
          duration_ms: 100,
          steps: [
            {
              at: 0,
              scale: 1,
              skewX: 0,
              anchorX: 0.5,
              backdropBlur: 0,
              background: "#000000",
            },
            {
              at: 1,
              scale: 2,
              skewX: 20,
              anchorX: 0,
              backdropBlur: 12,
              background: "#ffffff",
            },
          ],
        },
      },
    });
    const prepared = structuredClone(source);
    prepareAnimationBindings(prepared);
    expect((prepared.layout as Record<string, unknown>).size).toEqual({
      w: 100,
      h: 100,
    });
    expect((prepared.layout as Record<string, unknown>).bind).toMatchObject({
      "x-vision.scaleX": animationLeaf("panel", "scaleX"),
      backdropBlur: animationLeaf("panel", "backdropBlur"),
    });
    const restore = animationPatch(source, [], true);
    expect(restore[animationLeaf("panel", "scaleX")]).toBe(1);
    expect(restore[animationLeaf("panel", "background")]).toBe("#000000");
    expect((source.layout as Record<string, unknown>).bind).toBeUndefined();
  });
  it("adapts standard primitive keyframes and requires canonical endpoints/scoped instances", () => {
    const source = scene({});
    (source.layout as Record<string, unknown>).keyframes = {
      key: "open",
      duration_ms: 100,
      steps: [
        { at: 0, transform: { scale: 0.8 } },
        { at: 1, transform: { scale: 1 } },
      ],
    };
    expect(nodeAnimations(source)[0]?.id).toBe("node:panel");
    expect(compileCatalogue(source)["node:panel"]?.duration).toBe(100);
    (source.layout as Record<string, unknown>).kind = "repeat";
    expect(() => nodeAnimations(source)).toThrow("scoped");
  });
});
describe("native command playback", () => {
  it("replays standard primitive keyframes only when their bound key changes", async () => {
    let callback: FrameRequestCallback | null = null;
    const schedule = vi.fn((cb: FrameRequestCallback) => {
      callback = cb;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", schedule);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const source = scene({});
    (source.layout as Record<string, unknown>).keyframes = {
      key: "open",
      duration_ms: 100,
      steps: [
        { at: 0, opacity: 0 },
        { at: 1, opacity: 1 },
      ],
    };
    source.defaults!.open = false;
    const player = new VisionAnimations(async () => {}, vi.fn());
    player.update(source);
    expect(schedule).toHaveBeenCalledTimes(1);
    (callback as unknown as FrameRequestCallback)(performance.now() + 1000);
    await new Promise((r) => setTimeout(r, 0));
    player.update(source);
    expect(schedule).toHaveBeenCalledTimes(1);
    source.defaults!.open = true;
    player.update(source);
    expect(schedule).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("bounds spring overshoot at retained render-channel admission", () => {
    const source = scene({ a: leaf("panel", "opacity", 0, 1) });
    const patch = animationPatch(source, [
      {
        target: "panel",
        values: { opacity: 1.2, scaleX: -0.1, waveHarmonic: 1.3, skewX: 90 },
      },
    ]);
    expect(patch[animationLeaf("panel", "opacity")]).toBe(1);
    expect(patch[animationLeaf("panel", "scaleX")]).toBe(0);
    expect(patch[animationLeaf("panel", "waveHarmonic")]).toBe(1);
    expect(patch[animationLeaf("panel", "skewX")]).toBe(88);
  });

  it("handles cold control snapshots deterministically without an inactive-scene cache", () => {
    const p = new MotionPlayback(
      compileCatalogue(scene({ move: leaf("panel", "translateX", 0, 100) })),
    );
    p.commands([{ animation_id: "move", action: "pause" }], 0);
    expect(channel(p.sample(10), "translateX")).toBe(0);
    p.commands([{ animation_id: "move", action: "seek", time_ms: 40 }], 10);
    expect(channel(p.sample(20), "translateX")).toBe(40);
    p.commands([{ animation_id: "move", action: "cancel" }], 20);
    expect(p.sample(20)).toEqual([]);
    p.commands([{ animation_id: "move", action: "cancel" }], 20);
    expect(p.sample(20)).toEqual([]);
  });

  const playback = () =>
    new MotionPlayback(
      compileCatalogue(
        scene({
          move: leaf("panel", "translateX", 0, 100),
          fade: leaf("panel", "opacity", 0, 1),
        }),
      ),
    );
  it("combines independent same-target playbacks instead of discarding an entire target", () => {
    const p = playback();
    p.commands([{ animation_id: "move" }, { animation_id: "fade" }], 0);
    expect(p.sample(50)[0]?.values).toEqual({ translateX: 50, opacity: 0.5 });
  });
  it("pauses, seeks while paused, resumes, changes speed and reverses without jumping", () => {
    const p = playback();
    p.commands([{ animation_id: "move" }], 0);
    p.commands([{ animation_id: "move", action: "pause" }], 40);
    expect(channel(p.sample(100), "translateX")).toBe(40);
    expect(p.running).toBe(false);
    p.commands([{ animation_id: "move", action: "seek", time_ms: 70 }], 100);
    expect(channel(p.sample(120), "translateX")).toBe(70);
    p.commands(
      [
        { animation_id: "move", action: "resume" },
        { animation_id: "move", action: "speed", speed: 2 },
      ],
      120,
    );
    expect(channel(p.sample(125), "translateX")).toBe(80);
    p.commands([{ animation_id: "move", action: "reverse" }], 125);
    expect(channel(p.sample(130), "translateX")).toBe(70);
  });
  it("supports alternate/reverse loops and retains the exact final state", () => {
    const p = playback();
    p.commands(
      [{ animation_id: "move", iterations: 2, direction: "alternate" }],
      0,
    );
    expect(channel(p.sample(125), "translateX")).toBe(75);
    expect(channel(p.sample(200), "translateX")).toBe(0);
    expect(p.running).toBe(false);
    p.commands([{ animation_id: "move", direction: "reverse" }], 300);
    expect(channel(p.sample(300), "translateX")).toBe(100);
    expect(channel(p.sample(400), "translateX")).toBe(0);
  });
  it("loops indefinitely without accumulated timing drift and handles zero duration", () => {
    const p = playback();
    p.commands([{ animation_id: "move", iterations: "infinite" }], 0);
    expect(channel(p.sample(100025), "translateX")).toBe(25);
    expect(p.running).toBe(true);
    const z = new MotionPlayback(
      compileCatalogue(scene({ zero: leaf("panel", "opacity", 0, 1, 0) })),
    );
    z.commands([{ animation_id: "zero" }], 0);
    expect(channel(z.sample(0), "opacity")).toBe(1);
    expect(z.running).toBe(false);
  });
  it("rewinds stop, removes cancel and validates a command batch atomically", () => {
    const p = playback();
    p.commands([{ animation_id: "move" }], 0);
    expect(() =>
      p.commands(
        [
          { animation_id: "move", action: "pause" },
          { animation_id: "missing" },
        ],
        50,
      ),
    ).toThrow();
    expect(channel(p.sample(60), "translateX")).toBe(60);
    p.commands([{ animation_id: "move", action: "stop" }], 60);
    expect(channel(p.sample(80), "translateX")).toBe(0);
    p.commands([{ animation_id: "move", action: "cancel" }], 80);
    expect(p.sample(80)).toEqual([]);
    expect(() =>
      p.commands([{ animation_id: "move", speed: 0 }], 80),
    ).toThrow();
  });
  it("submits paused control commands and handles scene replacement while an old frame is pending", async () => {
    let callback: FrameRequestCallback | null = null,
      resolve: (() => void) | null = null;
    const schedule = vi.fn((cb: FrameRequestCallback) => {
      callback = cb;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", schedule);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const apply = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const player = new VisionAnimations(apply, vi.fn());
    const source = scene({ move: leaf("panel", "translateX", 0, 100) });
    source.defaults!["__animation.move"] = {
      animation_id: "move",
      command_id: 1,
    };
    player.update(source);
    (callback as unknown as FrameRequestCallback)(performance.now() + 30);
    const replacement = { ...source, scene_id: "new" };
    player.update(replacement);
    expect(schedule).toHaveBeenCalledTimes(1);
    (resolve as unknown as () => void)();
    await new Promise((r) => setTimeout(r, 0));
    expect(schedule).toHaveBeenCalledTimes(2);
    player.dispose();
  });
});
