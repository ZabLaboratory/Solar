import { sha256 } from "@noble/hashes/sha256";

/** Worker-local SHA-256 avoids one Chromium crypto IPC round trip per tiny frame.
 * The checksum is still calculated and compared by the unmodified native client.
 * Other algorithms retain the platform implementation.
 */
export function workerDigest(subtle: SubtleCrypto): void {
  const platform = subtle.digest.bind(subtle);
  subtle.digest = (algorithm, data) => {
    const name = typeof algorithm === "string" ? algorithm : algorithm.name;
    if (name.toUpperCase() !== "SHA-256") return platform(algorithm, data);
    const value = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    return Promise.resolve(sha256(value).buffer as ArrayBuffer);
  };
}
