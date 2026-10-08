const FONT_ADMISSION = Symbol("verified font admission");

/** An owned font snapshot. Its mutable bytes never escape without a copy. */
export class VerifiedFont {
  readonly #bytes: Uint8Array;

  private constructor(
    readonly digest: string,
    bytes: Uint8Array,
    admission: symbol,
  ) {
    if (admission !== FONT_ADMISSION)
      throw new Error("Unverified font snapshot.");
    this.#bytes = bytes;
    Object.freeze(this);
  }

  static async admit(
    source: Uint8Array,
    address?: string,
  ): Promise<VerifiedFont> {
    const bytes = new Uint8Array(source);
    const hex = (value: ArrayBuffer) =>
      Array.from(new Uint8Array(value), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
    if (address) {
      const actual =
        address.length === 40
          ? hex(await crypto.subtle.digest("SHA-1", bytes))
          : digest;
      if (actual !== address)
        throw new Error("Scene font content address mismatch.");
    }
    return new VerifiedFont(digest, bytes, FONT_ADMISSION);
  }

  static isVerified(value: unknown): value is VerifiedFont {
    return typeof value === "object" && value !== null && #bytes in value;
  }

  copy(): Uint8Array {
    return new Uint8Array(this.#bytes);
  }

  get byteLength(): number {
    return this.#bytes.byteLength;
  }
}
