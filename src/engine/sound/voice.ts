import { db, evaluate, type Cue } from "./catalogue";
import type { SoundGraph } from "./graph";

/** Build one sample-scheduled voice, including reverse PCM and timeline envelopes. */
export function startVoice(
  context: BaseAudioContext,
  graph: SoundGraph,
  cue: Cue,
  buffer: AudioBuffer,
  reversed: AudioBuffer | undefined,
  phase: number,
  speed: number,
  when: number,
  onEnd: () => void,
): (() => void) | null {
  const backward = speed < 0,
    rate = Math.abs(speed),
    local = phase - cue.start;
  const region = Math.min(
    (cue.sourceDuration ?? buffer.duration * 1000 - cue.offset) / 1000,
    buffer.duration - cue.offset / 1000,
  );
  if (region <= 0) throw Error("Sound cue offset exceeds its asset");
  const elapsed = (local / 1000) * cue.rate;
  let cursor =
    cue.offset / 1000 +
    (cue.loop ? ((elapsed % region) + region) % region : elapsed);
  if (!cue.loop && elapsed >= region) {
    onEnd();
    return null;
  }
  const source = context.createBufferSource(),
    gain = context.createGain(),
    pan = context.createStereoPanner();
  source.buffer = backward ? reversed! : buffer;
  source.playbackRate.value = cue.rate * rate;
  source.loop = cue.loop;
  if (backward) {
    source.loopStart = buffer.duration - cue.offset / 1000 - region;
    source.loopEnd = buffer.duration - cue.offset / 1000;
    cursor = buffer.duration - cursor;
  } else {
    source.loopStart = cue.offset / 1000;
    source.loopEnd = cue.offset / 1000 + region;
  }
  cursor = Math.max(
    0,
    Math.min(source.buffer.duration - 1 / source.buffer.sampleRate, cursor),
  );
  source.connect(gain);
  gain.connect(pan);
  pan.connect(graph.buses.get(cue.bus)!.input);
  const end = backward
      ? 0
      : Math.min(
          cue.duration,
          cue.loop ? Infinity : (region * 1000) / cue.rate,
        ),
    remaining = Math.abs(end - local) / 1000 / rate;
  const envelope = (t: number) =>
    db(evaluate(cue.automation.gain_db, t, cue.gain)) *
    Math.min(
      1,
      cue.fadeIn ? t / cue.fadeIn : 1,
      cue.fadeOut ? (cue.duration - t) / cue.fadeOut : 1,
    );
  const times = [
    0,
    cue.fadeIn,
    cue.duration - cue.fadeOut,
    cue.duration,
    ...Object.values(cue.automation)
      .flat()
      .map((k) => k.at_ms),
  ]
    .filter((t) => (backward ? t < local : t > local))
    .sort((a, b) => (backward ? b - a : a - b));
  gain.gain.setValueAtTime(Math.max(0, envelope(local)), when);
  pan.pan.setValueAtTime(evaluate(cue.automation.pan, local, cue.pan), when);
  for (const t of [...new Set(times)]) {
    const at = when + Math.abs(t - local) / 1000 / rate;
    gain.gain.linearRampToValueAtTime(Math.max(0, envelope(t)), at);
    pan.pan.linearRampToValueAtTime(
      evaluate(cue.automation.pan, t, cue.pan),
      at,
    );
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    source.disconnect();
    gain.disconnect();
    pan.disconnect();
    onEnd();
  };
  source.onended = release;
  source.start(when, cursor);
  source.stop(when + remaining);
  return () => {
    if (released) return;
    try {
      source.stop();
    } finally {
      release();
    }
  };
}
