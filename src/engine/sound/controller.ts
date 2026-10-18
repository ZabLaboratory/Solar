import type { LSMLDocument } from "../../scenes/native-document";
import type { MotionPlayback, MotionTransport } from "../motion/player";
import { compileSound, soundMix, type SoundCatalogue } from "./catalogue";
import { decodeSounds, reverseSound } from "./assets";
import { createSoundGraph, type SoundGraph } from "./graph";
import { startVoice } from "./voice";
import { scheduleBuses } from "./automation";

const SOUND_HORIZON_MS = 3000;

export interface SoundStatus {
  state: string;
  assets: number;
  voices: number;
  scheduled: number;
  sampleRate: number;
  rms: number;
  peak: number;
  transports: MotionTransport[];
}
/** Active-scene sound only; cue scheduling uses the accepted motion transport and Web Audio clock. */
export class VisionSound {
  private context: AudioContext | null = null;
  private capture: MediaStreamAudioDestinationNode | null = null;
  private output: GainNode | null = null;
  private catalogue: SoundCatalogue | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private reversed = new Map<string, AudioBuffer>();
  private graph: SoundGraph | null = null;
  private playback: MotionPlayback | null = null;
  private signature = "";
  private revision = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private voices = new Map<string, () => void>();
  private admitted = new Set<string>();
  private count = 0;
  private busRefreshAt = 0;
  private mix = new Map<
    string,
    {
      gain?: number;
      pan?: number;
      mute?: boolean;
      frequency?: number;
      wet?: number;
    }
  >();
  private disposed = false;
  private generation = 0;
  constructor(
    private readonly enabled: boolean,
    private readonly error: (error: unknown) => void,
    private readonly contextFactory = () =>
      new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }),
  ) {}
  private getContext(): AudioContext {
    if (this.context) return this.context;
    const context = this.contextFactory();
    this.context = context;
    this.output = context.createGain();
    this.capture = context.createMediaStreamDestination();
    this.output.connect(this.capture);
    this.output.connect(context.destination);
    context.addEventListener("statechange", () => {
      if (context.state === "running") this.tick();
    });
    return context;
  }
  async prepare(
    document: LSMLDocument,
    files: ReadonlyMap<string, Uint8Array>,
  ): Promise<void> {
    const catalogue = compileSound(document);
    const signature = JSON.stringify([
      document.scene_id,
      document.scene_version,
      document["x-solar.audio"] ?? null,
    ]);
    if (signature === this.signature) return;
    const generation = ++this.generation;
    if (!catalogue || !this.enabled) {
      this.clear();
      this.signature = signature;
      return;
    }
    const context = this.getContext(),
      buffers = await decodeSounds(context, catalogue, files);
    // Reversal owns one extra PCM copy per asset; both banks count toward 128MiB.
    const bytes = [...buffers.values()].reduce(
      (sum, b) => sum + b.length * b.numberOfChannels * 4,
      0,
    );
    if (bytes * 2 > 128 * 1024 * 1024)
      throw Error("Forward and reverse PCM exceed 128MiB");
    if (generation !== this.generation || this.disposed) return;
    this.stopVoices();
    this.graph?.dispose();
    this.graph = null;
    this.buffers = buffers;
    this.reversed = new Map(
      [...buffers].map(([id, b]) => [id, reverseSound(context, b)]),
    );
    this.catalogue = catalogue;
    this.signature = signature;
    this.revision = "";
    this.count = 0;
    this.busRefreshAt = 0;
    this.graph = createSoundGraph(context, catalogue, buffers, this.output!);
    // A suspended browser context stays visibly blocked until the host unlocks it.
    if (this.timer === null) this.timer = setInterval(() => this.tick(), 25);
  }
  attach(playback: MotionPlayback | null): void {
    this.playback = playback;
    const revision = JSON.stringify(
      playback?.transport(performance.now()).map((t) => [t.id, t.revision]) ??
        [],
    );
    if (revision !== this.revision) {
      this.revision = revision;
      this.stopVoices();
      this.admitted.clear();
      this.busRefreshAt = 0;
      if (this.catalogue && this.context) {
        this.graph?.dispose();
        this.graph = createSoundGraph(
          this.context,
          this.catalogue,
          this.buffers,
          this.output!,
        );
      }
    }
    if (playback && this.context?.state === "suspended")
      void this.context.resume().catch(this.error);
    this.tick();
  }
  async resume(): Promise<void> {
    if (this.enabled && this.catalogue && !this.disposed)
      await this.getContext().resume();
    this.tick();
  }
  setMix(value: unknown): void {
    this.mix = soundMix(this.catalogue, value);
    this.busRefreshAt = 0;
    this.tick();
  }
  stream(): MediaStream | null {
    return this.capture?.stream ?? null;
  }
  status(): SoundStatus {
    const samples = new Float32Array(this.graph?.analyser.fftSize ?? 0);
    this.graph?.analyser.getFloatTimeDomainData(samples);
    const rms = samples.length
      ? Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length)
      : 0;
    const transports = this.playback?.transport(performance.now()) ?? [];
    return {
      state: this.disposed
        ? "disposed"
        : !this.enabled
          ? "disabled"
          : !this.catalogue
            ? "empty"
            : this.context?.state !== "running"
              ? "blocked"
              : transports.some((t) => t.running)
                ? "playing"
                : transports.length
                  ? "paused"
                  : "ready",
      assets: this.buffers.size,
      voices: this.voices.size,
      scheduled: this.count,
      sampleRate: this.context?.sampleRate ?? 0,
      rms,
      peak: samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0),
      transports,
    };
  }
  private tick(): void {
    const context = this.context,
      catalogue = this.catalogue,
      graph = this.graph,
      playback = this.playback;
    if (
      this.disposed ||
      !context ||
      context.state !== "running" ||
      !catalogue ||
      !graph ||
      !playback
    )
      return;
    try {
      const now = performance.now(),
        states = playback.transport(now),
        active = states.filter((t) => t.running && catalogue.shows[t.id]);
      if (!active.length) {
        this.stopVoices();
        return;
      }
      const lead = active.reduce((a, b) => (a.revision > b.revision ? a : b));
      const horizonFor = (state: MotionTransport) =>
        state.iterations === 1 && catalogue.shows[state.id]!.cues.length <= 128
          ? Math.min(30000, state.duration / Math.abs(state.speed))
          : SOUND_HORIZON_MS;
      if (context.currentTime >= this.busRefreshAt) {
        scheduleBuses(
          context,
          graph,
          catalogue,
          playback,
          lead,
          now,
          horizonFor(lead),
          this.mix,
        );
        const cycle = lead.duration / Math.abs(lead.speed);
        this.busRefreshAt =
          context.currentTime +
          Math.min(1000, horizonFor(lead) / 2, cycle * 16) / 1000;
      }
      for (const state of active)
        this.schedule(
          playback,
          state,
          now,
          context,
          graph,
          catalogue,
          horizonFor(state),
        );
      // Dedup bank is bounded to nearby iterations, rather than retaining every infinite loop.
      if (this.admitted.size > 4096)
        this.admitted = new Set([...this.voices.keys()]);
    } catch (error) {
      this.attach(null);
      this.error(error);
    }
  }
  private schedule(
    playback: MotionPlayback,
    state: MotionTransport,
    now: number,
    context: AudioContext,
    graph: SoundGraph,
    catalogue: SoundCatalogue,
    horizon: number,
  ): void {
    let elapsed = 0,
      current = state;
    for (
      let segment = 0;
      segment < 64 && elapsed < horizon && current.running;
      segment++
    ) {
      const rate = Math.abs(current.speed),
        backward = current.speed < 0;
      const distance = backward
        ? current.phase
        : current.duration - current.phase;
      const window = Math.min(horizon - elapsed, distance / rate);
      const end = current.phase + current.speed * window;
      for (const cue of catalogue.shows[state.id]!.cues) {
        const buffer = this.buffers.get(cue.asset)!;
        const region = Math.min(
          cue.sourceDuration ?? buffer.duration * 1000 - cue.offset,
          buffer.duration * 1000 - cue.offset,
        );
        const high = Math.max(current.phase, end),
          low = Math.min(current.phase, end),
          cueEnd =
            cue.start +
            Math.min(cue.duration, cue.loop ? Infinity : region / cue.rate);
        if (cue.start >= high || cueEnd <= low) continue;
        const key = `${state.id}:${state.revision}:${current.iteration}:${cue.id}`;
        if (this.admitted.has(key)) continue;
        if (this.voices.size >= 128) return;
        const phase = backward
          ? Math.min(current.phase, cueEnd - 0.001)
          : Math.max(current.phase, cue.start);
        const offset = elapsed + Math.abs(phase - current.phase) / rate;
        this.admitted.add(key);
        this.count++;
        const stop = startVoice(
          context,
          graph,
          cue,
          this.buffers.get(cue.asset)!,
          this.reversed.get(cue.asset),
          phase,
          current.speed,
          context.currentTime + offset / 1000,
          () => this.voices.delete(key),
        );
        if (stop) this.voices.set(key, stop);
      }
      elapsed += Math.max(window, 0.001);
      current = playback
        .transport(now + elapsed + 0.0001)
        .find((t) => t.id === state.id)!;
      if (!current) break;
    }
  }
  private stopVoices(): void {
    for (const stop of [...this.voices.values()]) stop();
    this.voices.clear();
  }
  clear(): void {
    this.generation++;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopVoices();
    this.graph?.dispose();
    this.graph = null;
    this.catalogue = null;
    this.buffers.clear();
    this.reversed.clear();
    this.playback = null;
    this.admitted.clear();
    this.signature = "";
    this.revision = "";
    this.mix.clear();
  }
  dispose(): void {
    this.disposed = true;
    this.clear();
    this.output?.disconnect();
    void this.context?.close();
    this.context = null;
    this.capture = null;
    this.output = null;
  }
}
