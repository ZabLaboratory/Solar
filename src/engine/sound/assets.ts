import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { SoundCatalogue } from "./catalogue";
/** Decode exact packaged bytes; no URL fetches, fallback assets or inactive-scene cache. */
export async function decodeSounds(
  context: BaseAudioContext,
  catalogue: SoundCatalogue,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  let encoded = 0,
    decoded = 0;
  for (const [id, asset] of Object.entries(catalogue.assets)) {
    const bytes = files.get(asset.src);
    if (
      !bytes ||
      bytes.length > 16 * 1024 * 1024 ||
      (encoded += bytes.length) > 64 * 1024 * 1024
    )
      throw Error("Sound asset missing or encoded budget exceeded");
    if (bytesToHex(sha256(bytes)) !== asset.sha256)
      throw Error(`Sound asset digest mismatch: ${id}`);
    const buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
    if (
      buffer.numberOfChannels > 2 ||
      buffer.duration > 120 ||
      (decoded += buffer.length * buffer.numberOfChannels * 4) >
        128 * 1024 * 1024
    )
      throw Error("Decoded sound budget exceeded");
    for (let c = 0; c < buffer.numberOfChannels; c++)
      if (buffer.getChannelData(c).some((v) => !Number.isFinite(v)))
        throw Error("Non-finite decoded sound sample");
    buffers.set(id, buffer);
  }
  return buffers;
}
export function reverseSound(
  context: BaseAudioContext,
  buffer: AudioBuffer,
): AudioBuffer {
  const reversed = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const source = buffer.getChannelData(c),
      target = reversed.getChannelData(c);
    for (let i = 0; i < source.length; i++)
      target[i] = source[source.length - 1 - i]!;
  }
  return reversed;
}
