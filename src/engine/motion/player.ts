import type { LSMLDocument } from "../../scenes/native-document";
import { finite, record } from "./curves";
import {
  compileCatalogue,
  nodeAnimations,
  samplePlan,
  type AnimationFrame,
  type MotionPlan,
} from "./timeline";

type Direction = "normal" | "reverse" | "alternate" | "alternate-reverse";
interface Play {
  plan: MotionPlan;
  time: number;
  anchor: number;
  rate: number;
  iterations: number;
  direction: Direction;
  paused: boolean;
  order: number;
}
const position = (play: Play, now: number) =>
  play.plan.duration === 0
    ? 0
    : Math.max(
        0,
        Math.min(
          play.plan.duration * play.iterations,
          play.time + (play.paused ? 0 : (now - play.anchor) * play.rate),
        ),
      );
export class MotionPlayback {
  private players = new Map<string, Play>();
  private order = 0;
  constructor(private readonly plans: Record<string, MotionPlan>) {}
  /** Validate the whole native transaction against staged state before committing. */
  commands(commands: unknown[], now: number): void {
    const staged = new Map(
      [...this.players].map(([id, play]) => [id, { ...play }]),
    );
    let order = this.order;
    for (const raw of commands) {
      const command = record(raw);
      if (
        !command ||
        typeof command.animation_id !== "string" ||
        !Object.hasOwn(this.plans, command.animation_id)
      )
        throw new Error(
          `Blue animation not declared: ${String(command?.animation_id)}`,
        );
      const id = command.animation_id,
        plan = this.plans[id]!,
        action = command.action ?? "play";
      const known = new Set([
        "animation_id",
        "command_id",
        "action",
        "time_ms",
        "speed",
        "iterations",
        "direction",
      ]);
      for (const key of Object.keys(command))
        if (!known.has(key))
          throw new Error(`Unsupported animation command field: ${key}`);
      if (
        command.speed !== undefined &&
        action !== "play" &&
        action !== "speed"
      )
        throw new Error("speed is only valid on play/speed");
      if (
        command.time_ms !== undefined &&
        action !== "play" &&
        action !== "seek"
      )
        throw new Error("time_ms is only valid on play/seek");
      if (
        (command.iterations !== undefined || command.direction !== undefined) &&
        action !== "play"
      )
        throw new Error("iterations/direction require play");
      if (action === "play") {
        const rate = finite(command.speed ?? 1, "speed", 0.01, 16);
        const iterations =
          command.iterations === "infinite"
            ? Infinity
            : finite(command.iterations ?? 1, "iterations", 1, 10000);
        if (Number.isFinite(iterations) && !Number.isInteger(iterations))
          throw new Error("iterations must be an integer");
        const direction = command.direction ?? "normal";
        if (
          !["normal", "reverse", "alternate", "alternate-reverse"].includes(
            String(direction),
          )
        )
          throw new Error("Invalid animation direction");
        const time = finite(
          command.time_ms ?? 0,
          "playhead",
          0,
          plan.duration * iterations,
        );
        staged.set(id, {
          plan,
          time,
          anchor: now,
          rate,
          iterations,
          direction: direction as Direction,
          paused: false,
          order: ++order,
        });
      } else {
        if (action === "cancel") {
          staged.delete(id);
          continue;
        }
        // A fresh reader has no previous playhead. Explicit seek supplies one;
        // other controls start deterministically at the declared boundary.
        const play = staged.get(id) ?? {
          plan,
          time: action === "reverse" ? plan.duration : 0,
          anchor: now,
          rate: 1,
          iterations: 1,
          direction: "normal" as Direction,
          paused: true,
          order: 0,
        };
        staged.set(id, play);
        play.time = position(play, now);
        play.anchor = now;
        play.order = ++order;
        if (action === "pause") play.paused = true;
        else if (action === "resume") play.paused = false;
        else if (action === "seek")
          play.time = finite(
            command.time_ms,
            "playhead",
            0,
            play.plan.duration * play.iterations,
          );
        else if (action === "speed")
          play.rate =
            Math.sign(play.rate) * finite(command.speed, "speed", 0.01, 16);
        else if (action === "reverse") {
          play.rate *= -1;
          play.paused = false;
        } else if (action === "stop") {
          play.time = 0;
          play.paused = true;
        } else
          throw new Error(`Unsupported animation action: ${String(action)}`);
      }
    }
    this.players = staged;
    this.order = order;
  }
  sample(now: number): AnimationFrame[] {
    const frames = new Map<string, AnimationFrame>();
    for (const play of [...this.players.values()].sort(
      (a, b) => a.order - b.order,
    )) {
      const time = position(play, now),
        duration = play.plan.duration;
      let iteration = duration ? Math.floor(time / duration) : 0,
        phase = duration ? time % duration : 0;
      if (duration && time === duration * play.iterations) {
        iteration = play.iterations - 1;
        phase = duration;
      }
      const reverse =
        play.direction === "reverse" ||
        (play.direction === "alternate" && iteration % 2 === 1) ||
        (play.direction === "alternate-reverse" && iteration % 2 === 0);
      for (const frame of samplePlan(
        play.plan,
        reverse ? duration - phase : phase,
      )) {
        const merged = frames.get(frame.target) ?? {
          target: frame.target,
          values: {},
        };
        Object.assign(merged.values, frame.values);
        frames.set(frame.target, merged);
      }
      if (
        !play.paused &&
        (duration === 0 ||
          (play.rate > 0 && time >= duration * play.iterations) ||
          (play.rate < 0 && time <= 0))
      ) {
        play.time = time;
        play.anchor = now;
        play.paused = true;
      }
    }
    return [...frames.values()];
  }
  get running(): boolean {
    return [...this.players.values()].some((p) => !p.paused);
  }
}

/** One clock and one queued GPU submission; plans compile only when catalogue changes. */
export class VisionAnimations {
  private document: LSMLDocument | null = null;
  private signature = "";
  private playback: MotionPlayback | null = null;
  private readonly seen = new Map<string, string>();
  private frames: readonly AnimationFrame[] = [];
  private scheduled: number | null = null;
  private inFlight = false;
  private generation = 0;
  private stopped = false;
  private dirty = false;
  constructor(
    private readonly apply: (
      frames: readonly AnimationFrame[],
    ) => Promise<void>,
    private readonly error: (error: unknown) => void,
  ) {}
  update(document: LSMLDocument): void {
    const automatic = nodeAnimations(document);
    const signature = JSON.stringify([
      document.animations ?? record(document.layout)?.animations ?? {},
      automatic.map((n) => n.asset),
    ]);
    const replacement =
      !this.playback ||
      this.document?.scene_id !== document.scene_id ||
      this.document?.scene_version !== document.scene_version ||
      this.signature !== signature;
    // Do not retire an accepted playback until all new plans/commands validate.
    const playback = replacement
      ? new MotionPlayback(compileCatalogue(document))
      : this.playback!;
    const changes: [string, string][] = [],
      commands: unknown[] = [];
    for (const [key, command] of Object.entries(document.defaults ?? {})) {
      if (!key.startsWith("__animation.")) continue;
      const identity = JSON.stringify(command);
      if (!replacement && this.seen.get(key) === identity) continue;
      commands.push(command);
      changes.push([key, identity]);
    }
    for (const node of automatic) {
      const key = `primitive:${node.id}`;
      if (!replacement && this.seen.get(key) === node.identity) continue;
      commands.push({ animation_id: node.id });
      changes.push([key, node.identity]);
    }
    playback.commands(commands, performance.now());
    if (replacement) this.reset();
    this.document = document;
    this.signature = signature;
    this.playback = playback;
    for (const [key, value] of changes) this.seen.set(key, value);
    if (commands.length) this.dirty = true;
    if (
      !this.stopped &&
      (this.dirty || playback.running) &&
      this.scheduled === null &&
      !this.inFlight
    )
      this.schedule();
  }
  private schedule(): void {
    const generation = this.generation;
    this.scheduled = requestAnimationFrame((now) => {
      this.scheduled = null;
      if (this.stopped || generation !== this.generation || !this.playback)
        return;
      this.frames = this.playback.sample(now);
      this.dirty = false;
      this.inFlight = true;
      void this.apply(this.frames)
        .catch((error) => {
          if (generation === this.generation) {
            this.playback = null;
            this.error(error);
          }
        })
        .finally(() => {
          this.inFlight = false;
          if (
            !this.stopped &&
            (this.dirty || this.playback?.running) &&
            this.scheduled === null
          )
            this.schedule();
        });
    });
  }
  current(document?: LSMLDocument): readonly AnimationFrame[] {
    if (
      document &&
      (this.document?.scene_id !== document.scene_id ||
        this.document?.scene_version !== document.scene_version)
    )
      return [];
    return this.frames;
  }
  private reset(): void {
    this.generation++;
    if (this.scheduled !== null) cancelAnimationFrame(this.scheduled);
    this.scheduled = null;
    this.playback = null;
    this.frames = [];
    this.seen.clear();
    this.dirty = false;
  }
  dispose(): void {
    this.stopped = true;
    this.clear();
  }
  clear(): void {
    this.reset();
    this.document = null;
    this.signature = "";
  }
}
