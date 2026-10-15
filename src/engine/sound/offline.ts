import type { LSMLDocument } from "../../scenes/native-document";
import { compileSound, db } from "./catalogue";
import { decodeSounds } from "./assets";
import { createSoundGraph } from "./graph";
import { startVoice } from "./voice";
/** Render the same declared assets/effect graph to real PCM without a presentation clock. */
export async function renderSound(
  document: LSMLDocument,
  files: ReadonlyMap<string, Uint8Array>,
  animationId: string,
): Promise<AudioBuffer> {
  const catalogue = compileSound(document),
    show = catalogue?.shows[animationId];
  if (!catalogue || !show) throw Error("Unknown sound export show");
  if (show.duration > 120000)
    throw Error("Offline sound export is limited to 120 seconds");
  const context = new OfflineAudioContext(
    2,
    Math.ceil((show.duration + 1500) * 48),
    48000,
  );
  const buffers = await decodeSounds(context, catalogue, files),
    graph = createSoundGraph(context, catalogue, buffers, context.destination);
  for (const bus of catalogue.buses) {
    const node = graph.buses.get(bus.id)!;
    for (const [channel, keys] of Object.entries(bus.automation)) {
      const param =
        channel === "gain_db"
          ? node.gain
          : channel === "pan"
            ? node.pan
            : channel === "frequency"
              ? node.frequency
              : node.wet;
      if (!param) continue;
      for (const [index, key] of keys.entries()) {
        const value = channel === "gain_db" ? db(key.value) : key.value,
          time = key.at_ms / 1000;
        if (index === 0) param.setValueAtTime(value, 0);
        if (channel === "gain_db")
          param.exponentialRampToValueAtTime(value, time);
        else param.linearRampToValueAtTime(value, time);
        if (channel === "wet") {
          if (index === 0) node.dry?.setValueAtTime(1 - value, 0);
          node.dry?.linearRampToValueAtTime(1 - value, time);
        }
      }
    }
  }
  for (const cue of show.cues)
    startVoice(
      context,
      graph,
      cue,
      buffers.get(cue.asset)!,
      undefined,
      cue.start,
      1,
      cue.start / 1000,
      () => {},
    );
  try {
    return await context.startRendering();
  } finally {
    graph.dispose();
  }
}
