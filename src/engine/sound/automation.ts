import {
  db,
  evaluate,
  type Keys,
  type SoundCatalogue,
  type soundMix,
} from "./catalogue";
import type { MotionPlayback, MotionTransport } from "../motion/player";
import type { SoundGraph } from "./graph";

/** Ahead-of-time bus automation; DSP keeps progressing during main-thread/GPU stalls. */
export function scheduleBuses(
  context: BaseAudioContext,
  graph: SoundGraph,
  catalogue: SoundCatalogue,
  playback: MotionPlayback,
  lead: MotionTransport,
  now: number,
  horizon: number,
  mix: ReturnType<typeof soundMix>,
): void {
  const when = context.currentTime;
  for (const bus of catalogue.buses) {
    const node = graph.buses.get(bus.id)!,
      override = mix.get(bus.id);
    for (const [channel, param, base] of [
      ["gain_db", node.gain, bus.gain_db],
      ["pan", node.pan, bus.pan],
      ["frequency", node.frequency, node.frequencyBase],
      ["wet", node.wet, node.wetBase],
    ] as const) {
      if (!param || base === undefined) continue;
      const fixed =
        channel === "gain_db"
          ? override?.mute
            ? -Infinity
            : override?.gain
          : override?.[channel];
      const keys = fixed === undefined ? bus.automation[channel] : undefined;
      const value = (phase: number) => {
        const v = fixed ?? evaluate(keys, phase, base);
        return channel === "gain_db" ? db(v) : v;
      };
      param.cancelScheduledValues(when);
      param.setValueAtTime(value(lead.phase), when);
      if (channel === "wet") {
        node.dry!.cancelScheduledValues(when);
        node.dry!.setValueAtTime(1 - value(lead.phase), when);
      }
      if (!keys) continue;
      let elapsed = 0,
        state = lead;
      for (
        let segment = 0;
        segment < 64 && elapsed < horizon && state.running;
        segment++
      ) {
        const distance =
          state.speed < 0 ? state.phase : state.duration - state.phase;
        const window = Math.min(
          horizon - elapsed,
          distance / Math.abs(state.speed),
        );
        const end = state.phase + state.speed * window;
        const times = keyTimes(keys, state.phase, end);
        for (const phase of times) {
          const at =
              when +
              (elapsed +
                Math.abs(phase - state.phase) / Math.abs(state.speed)) /
                1000,
            v = value(phase);
          if (channel === "gain_db" && v > 0)
            param.exponentialRampToValueAtTime(v, at);
          else param.linearRampToValueAtTime(v, at);
          if (channel === "wet") node.dry!.linearRampToValueAtTime(1 - v, at);
        }
        elapsed += Math.max(window, 0.001);
        const next = playback
          .transport(now + elapsed + 0.0001)
          .find((t) => t.id === lead.id);
        if (!next) break;
        state = next;
        if (elapsed < horizon && state.running) {
          param.setValueAtTime(value(state.phase), when + elapsed / 1000);
          if (channel === "wet")
            node.dry!.setValueAtTime(
              1 - value(state.phase),
              when + elapsed / 1000,
            );
        }
      }
    }
  }
}
function keyTimes(keys: Keys, start: number, end: number): number[] {
  const backward = end < start;
  return [
    ...keys
      .map((k) => k.at_ms)
      .filter((t) => (backward ? t < start && t > end : t > start && t < end)),
    end,
  ].sort((a, b) => (backward ? b - a : a - b));
}
