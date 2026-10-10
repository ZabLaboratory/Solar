import { db, type SoundCatalogue, type Bus } from "./catalogue";
export interface SoundBus {
  input: GainNode;
  output: StereoPannerNode;
  gain: AudioParam;
  pan: AudioParam;
  frequency?: AudioParam;
  wet?: AudioParam;
  dry?: AudioParam;
}
export interface SoundGraph {
  buses: Map<string, SoundBus>;
  analyser: AnalyserNode;
  output: GainNode;
  dispose: () => void;
}
/** One host-owned processing graph, reusable by live and offline Web Audio contexts. */
export function createSoundGraph(
  context: BaseAudioContext,
  catalogue: SoundCatalogue,
  buffers: Map<string, AudioBuffer>,
  destination: AudioNode,
): SoundGraph {
  const nodes: AudioNode[] = [],
    buses = new Map<string, SoundBus>();
  const own = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const output = own(context.createGain()),
    analyser = own(context.createAnalyser());
  analyser.fftSize = 1024;
  output.connect(analyser);
  analyser.connect(destination);
  const build = (bus: Bus): SoundBus => {
    const input = own(context.createGain()),
      gain = own(context.createGain()),
      pan = own(context.createStereoPanner());
    gain.gain.value = db(bus.gain_db);
    pan.pan.value = bus.pan;
    let tail: AudioNode = input;
    const result: SoundBus = {
      input,
      output: pan,
      gain: gain.gain,
      pan: pan.pan,
    };
    for (const effect of bus.effects) {
      if (effect.type === "filter") {
        const filter = own(context.createBiquadFilter());
        filter.type = (effect.kind ?? "lowpass") as BiquadFilterType;
        filter.frequency.value = Number(effect.frequency ?? 18000);
        filter.Q.value = Number(effect.q ?? 0.707);
        filter.gain.value = Number(effect.gain_db ?? 0);
        tail.connect(filter);
        tail = filter;
        result.frequency ??= filter.frequency;
      } else if (effect.type === "compressor") {
        const compressor = own(context.createDynamicsCompressor());
        for (const [k, value] of Object.entries(effect))
          if (k !== "type" && value !== undefined)
            (
              compressor[k as keyof DynamicsCompressorNode] as AudioParam
            ).value = Number(value);
        tail.connect(compressor);
        tail = compressor;
      } else {
        const sum = own(context.createGain()),
          dry = own(context.createGain()),
          wet = own(context.createGain());
        const amount = Number(effect.wet ?? 0.2);
        dry.gain.value = 1 - amount;
        wet.gain.value = amount;
        tail.connect(dry);
        dry.connect(sum);
        result.wet ??= wet.gain;
        result.dry ??= dry.gain;
        if (effect.type === "delay") {
          const delay = own(context.createDelay(2)),
            feedback = own(context.createGain());
          delay.delayTime.value = Number(effect.time_ms ?? 180) / 1000;
          feedback.gain.value = Number(effect.feedback ?? 0.25);
          tail.connect(delay);
          delay.connect(feedback);
          feedback.connect(delay);
          delay.connect(wet);
        } else if (effect.type === "reverb") {
          const convolver = own(context.createConvolver());
          convolver.buffer = buffers.get(String(effect.impulse))!;
          tail.connect(convolver);
          convolver.connect(wet);
        } else {
          const shaper = own(context.createWaveShaper()),
            drive = 1 + Number(effect.drive ?? 8),
            curve = new Float32Array(2048);
          for (let i = 0; i < curve.length; i++) {
            const x = (i * 2) / (curve.length - 1) - 1;
            curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
          }
          shaper.curve = curve;
          shaper.oversample = "2x";
          tail.connect(shaper);
          shaper.connect(wet);
        }
        wet.connect(sum);
        tail = sum;
      }
    }
    tail.connect(gain);
    gain.connect(pan);
    buses.set(bus.id, result);
    return result;
  };
  for (const bus of catalogue.buses) build(bus);
  for (const bus of catalogue.buses)
    buses
      .get(bus.id)!
      .output.connect(
        bus.id === "master" ? output : buses.get(bus.output)!.input,
      );
  return {
    buses,
    output,
    analyser,
    dispose: () => {
      for (const n of nodes) n.disconnect();
    },
  };
}
