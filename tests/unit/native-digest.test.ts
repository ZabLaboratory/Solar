import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { workerDigest } from "../../src/internal/native-digest";

describe("worker-local native checksum", () => {
  it("retains SHA-256 for empty, fragmented-offset and large byte inputs", async () => {
    const platform = vi.fn();
    const subtle = { digest: platform } as unknown as SubtleCrypto;
    workerDigest(subtle);
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 256);
    for (const value of [new Uint8Array(0), bytes.subarray(31, 91), bytes]) {
      const actual = await subtle.digest({ name: "SHA-256" }, value);
      expect(Buffer.from(actual).toString("hex")).toBe(
        createHash("sha256").update(value).digest("hex"),
      );
    }
    expect(platform).not.toHaveBeenCalled();
  });
  it("delegates other algorithms without changing their input", async () => {
    const result = new ArrayBuffer(1),
      platform = vi.fn().mockResolvedValue(result);
    const subtle = { digest: platform } as unknown as SubtleCrypto;
    workerDigest(subtle);
    const bytes = new Uint8Array([1, 2]);
    expect(await subtle.digest("SHA-512", bytes)).toBe(result);
    expect(platform).toHaveBeenCalledWith("SHA-512", bytes);
  });
});
