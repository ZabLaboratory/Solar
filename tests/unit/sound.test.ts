import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  compileSound,
  evaluate,
  soundMix,
} from "../../src/engine/sound/catalogue";
import { decodeSounds, reverseSound } from "../../src/engine/sound/assets";
import { startVoice } from "../../src/engine/sound/voice";
import { MotionPlayback } from "../../src/engine/motion/player";
import { compileCatalogue } from "../../src/engine/motion/timeline";
import type { LSMLDocument } from "../../src/scenes/native-document";
import type { SoundGraph } from "../../src/engine/sound/graph";
import { scheduleBuses } from "../../src/engine/sound/automation";
const fixture = (): LSMLDocument =>
  JSON.parse(readFileSync("fixtures/sound-design/sponsor-motion.lsml", "utf8"));
interface RawAudio {
  assets: Record<string, { src: string; sha256: string }>;
  buses: Record<
    string,
    { output?: string; effects?: unknown[]; automation?: unknown }
  >;
  shows: Record<string, { timeline: unknown }>;
}
const audio = (d: LSMLDocument) => d["x-solar.audio"] as RawAudio;
const cue = (id: string, delay_ms = 0) => ({
  id,
  asset: "tick",
  duration_ms: 100,
  delay_ms,
});
describe("authored sound admission", () => {
  it("compiles the actual original sound study and its nested timing", () => {
    const d = fixture(),
      a = audio(d);
    const original = compileSound(d)!;
    expect(original.shows.show!.cues).toHaveLength(58);
    expect(original.shows.show!.cues.map((cue) => cue.id)).toEqual(
      expect.arrayContaining([
        "brand-wordmark",
        "signature-many-systems",
        "signature-one-motion",
      ]),
    );
    expect(original.buses).toHaveLength(5);
    a.shows.show!.timeline = {
      sequence: [
        cue("a", 20),
        { delay_ms: 30, parallel: [cue("b"), cue("c", 40)] },
        cue("d"),
      ],
    };
    expect(
      compileSound(d)!.shows.show!.cues.map((c) => [c.id, c.start]),
    ).toEqual([
      ["a", 20],
      ["b", 150],
      ["c", 190],
      ["d", 290],
    ]);
  });
  it("rejects cycles, missing outputs, unsafe sources and cue overruns", () => {
    for (const mutate of [
      (a: RawAudio) => (a.buses.fx!.output = "fx"),
      (a: RawAudio) => (a.buses.fx!.output = "absent"),
      (a: RawAudio) => (a.assets.tick!.src = "assets/../secret.wav"),
      (a: RawAudio) => (a.assets.tick!.sha256 = "nohash"),
      (a: RawAudio) => (a.shows.show!.timeline = cue("late", 15000)),
      (a: RawAudio) =>
        (a.shows.show!.timeline = { parallel: [cue("same"), cue("same")] }),
      (a: RawAudio) =>
        (a.buses.fx!.automation = { wet: [{ at_ms: 0, value: 2 }] }),
    ]) {
      const d = fixture();
      mutate(audio(d));
      expect(() => compileSound(d)).toThrow();
    }
  });
  it("includes the implicit master in the bus budget and rejects unknown effects", () => {
    const d = fixture(),
      a = audio(d);
    a.buses = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => ["bus" + i, {}]),
    );
    expect(() => compileSound(d)).toThrow(/including master/);
    a.buses = { master: { effects: [{ type: "vst" }] } };
    expect(() => compileSound(d)).toThrow(/Unsupported sound effect/);
  });
  it("rejects mismatched bytes before asking the decoder to run", async () => {
    const d = fixture(),
      catalogue = compileSound(d)!;
    const context = { decodeAudioData: vi.fn() } as unknown as BaseAudioContext;
    const files = new Map(
      Object.values(catalogue.assets).map((a) => [
        a.src,
        new Uint8Array([1, 2, 3]),
      ]),
    );
    await expect(decodeSounds(context, catalogue, files)).rejects.toThrow(
      /SHA|hash|digest/i,
    );
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });
  it("interpolates dB automation with hold boundaries", () => {
    const keys = [
      { at_ms: 100, value: -20 },
      { at_ms: 300, value: 0 },
    ];
    expect([0, 100, 200, 300, 500].map((t) => evaluate(keys, t, 999))).toEqual([
      -20, -20, -10, 0, 0,
    ]);
  });
  it("validates the whole live mix before applying overrides", () => {
    const catalogue = compileSound(fixture())!;
    expect(
      soundMix(catalogue, {
        music: { gain_db: -15, frequency: 1000 },
        space: { wet: 0.4 },
        master: { mute: true },
      }).get("master"),
    ).toEqual({ mute: true });
    for (const mix of [
      { missing: { mute: true } },
      { master: { wet: 0.4 } },
      { music: { pan: 2 } },
      { master: { mute: "yes" } },
    ])
      expect(() => soundMix(catalogue, mix)).toThrow();
    const d = fixture();
    d.defaults = { "__audio.mix": { master: { wet: 0.3 } } };
    expect(() => compileSound(d)).toThrow(/requires a wet effect/);
    audio(d).buses = { master: { effects: [{ type: "constructor" }] } };
    expect(() => compileSound(d)).toThrow(/Unsupported sound effect/);
  });
});
describe("shared sound and visual transport", () => {
  it("preserves paused phase, resumes, changes speed and reverses the same clock", () => {
    const p = new MotionPlayback(compileCatalogue(fixture()));
    const command = (action: string, now: number, extra = {}) =>
      p.commands([{ animation_id: "show", action, ...extra }], now);
    command("play", 100);
    expect(p.transport(600)[0]!.phase).toBe(500);
    command("pause", 600);
    expect(p.transport(1200)[0]).toMatchObject({
      phase: 500,
      paused: true,
      running: false,
    });
    command("seek", 1200, { time_ms: 3500 });
    expect(p.transport(1500)[0]!.phase).toBe(3500);
    command("resume", 1500);
    command("speed", 1600, { speed: 2 });
    expect(p.transport(1700)[0]!.phase).toBe(3800);
    command("reverse", 1700);
    expect(p.transport(1800)[0]).toMatchObject({
      phase: 3600,
      speed: -2,
      running: true,
    });
    command("stop", 1800);
    expect(p.transport(2000)[0]).toMatchObject({ phase: 0, running: false });
  });
  it("changes direction at ping-pong boundaries without a new cue command", () => {
    const p = new MotionPlayback(compileCatalogue(fixture()));
    p.commands(
      [{ animation_id: "show", direction: "alternate", iterations: 2 }],
      0,
    );
    expect(p.transport(15025)[0]).toMatchObject({
      phase: 14975,
      speed: -1,
      iteration: 1,
    });
    expect(p.transport(30000)[0]).toMatchObject({ phase: 0, running: false });
  });
});
describe("sample scheduled voices", () => {
  it("schedules future bus keys on the audio clock and restores authored effect defaults", () => {
    const catalogue = compileSound(fixture())!,
      bus = catalogue.buses.find((b) => b.id === "space")!;
    const param = () => ({
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    });
    const gain = param(),
      pan = param(),
      wet = param(),
      dry = param(),
      frequency = param();
    const graph = {
      buses: new Map([
        [
          bus.id,
          { gain, pan, wet, dry, frequency, wetBase: 0.22, frequencyBase: 150 },
        ],
      ]),
    } as unknown as SoundGraph;
    const playback = new MotionPlayback(compileCatalogue(fixture()));
    playback.commands([{ animation_id: "show" }], 0);
    const context = { currentTime: 2 } as BaseAudioContext;
    scheduleBuses(
      context,
      graph,
      { ...catalogue, buses: [bus] },
      playback,
      playback.transport(0)[0]!,
      0,
      15000,
      soundMix(catalogue, { space: { wet: 0.05, frequency: 700 } }),
    );
    expect(wet.setValueAtTime).toHaveBeenCalledWith(0.05, 2);
    expect(frequency.setValueAtTime).toHaveBeenCalledWith(700, 2);
    expect(wet.linearRampToValueAtTime).not.toHaveBeenCalled();
    scheduleBuses(
      context,
      graph,
      { ...catalogue, buses: [{ ...bus, automation: {} }] },
      playback,
      playback.transport(0)[0]!,
      0,
      15000,
      new Map(),
    );
    expect(wet.setValueAtTime).toHaveBeenLastCalledWith(0.22, 2);
    expect(frequency.setValueAtTime).toHaveBeenLastCalledWith(150, 2);
    scheduleBuses(
      context,
      graph,
      {
        ...catalogue,
        buses: [
          {
            ...bus,
            automation: {
              wet: [
                { at_ms: 0, value: 0.1 },
                { at_ms: 2000, value: 0.7 },
              ],
            },
          },
        ],
      },
      playback,
      playback.transport(0)[0]!,
      0,
      15000,
      new Map(),
    );
    expect(wet.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, 4);
    expect(
      dry.linearRampToValueAtTime.mock.calls.some(
        (c) => c[1] === 4 && Math.abs(Number(c[0]) - 0.3) < 1e-6,
      ),
    ).toBe(true);
  });
  it("reverses every PCM channel without modifying the original asset", () => {
    const original = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
    const output = [new Float32Array(3), new Float32Array(3)];
    const buffer = {
      numberOfChannels: 2,
      length: 3,
      sampleRate: 48000,
      getChannelData: (c: number) => original[c],
    } as AudioBuffer;
    const context = {
      createBuffer: () => ({ getChannelData: (c: number) => output[c] }),
    } as unknown as BaseAudioContext;
    reverseSound(context, buffer);
    expect([...output[0]!]).toEqual([3, 2, 1]);
    expect([...output[1]!]).toEqual([6, 5, 4]);
    expect([...original[0]!]).toEqual([1, 2, 3]);
  });
  it("honors a trimmed source region, schedules once and releases idempotently", () => {
    const c = compileSound(fixture())!.shows.show!.cues.find(
      (c) => c.asset === "tick",
    )!;
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      playbackRate: { value: 0 },
    };
    const param = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
    const context = {
      createBufferSource: () => source,
      createGain: () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: param,
      }),
      createStereoPanner: () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        pan: param,
      }),
    } as unknown as BaseAudioContext;
    const graph = { buses: new Map([[c.bus, { input: {} }]]) } as SoundGraph;
    const buffer = { duration: 1, sampleRate: 48000 } as AudioBuffer,
      done = vi.fn();
    const stop = startVoice(
      context,
      graph,
      { ...c, rate: 1, duration: 800, offset: 200, sourceDuration: 300 },
      buffer,
      buffer,
      c.start + 100,
      2,
      4,
      done,
    )!;
    expect(source.start.mock.calls[0]![0]).toBe(4);
    expect(source.start.mock.calls[0]![1]).toBeCloseTo(0.3);
    expect(source.stop).toHaveBeenCalledWith(4.1);
    stop();
    stop();
    expect(done).toHaveBeenCalledTimes(1);
    const reverse = { duration: 1, sampleRate: 48000 } as AudioBuffer;
    const reverseStop = startVoice(
      context,
      graph,
      { ...c, rate: 1, duration: 800, offset: 200, sourceDuration: 300 },
      buffer,
      reverse,
      c.start + 100,
      -2,
      5,
      done,
    )!;
    expect(source.start.mock.calls[1]![0]).toBe(5);
    expect(source.start.mock.calls[1]![1]).toBeCloseTo(0.7);
    expect(source.stop).toHaveBeenCalledWith(5.05);
    reverseStop();
    expect(
      startVoice(
        context,
        graph,
        { ...c, rate: 1, sourceDuration: 100 },
        buffer,
        buffer,
        c.start + 110,
        1,
        4,
        done,
      ),
    ).toBeNull();
  });
});
