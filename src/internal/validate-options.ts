import type { MountOptions } from "../types";

/** Throws on invalid mount options. Exposed separately so unit tests
 *  can exercise it without mounting a real React root. */
export function validateOptions(options: MountOptions): void {
  if (!(options.target instanceof HTMLElement)) {
    throw new TypeError("solar.mount: `target` must be an HTMLElement");
  }
  if (typeof options.orionUrl !== "string" || options.orionUrl.length === 0) {
    throw new TypeError("solar.mount: `orionUrl` must be a non-empty string");
  }
  if (options.mode === "test") {
    if (!options.testSession) {
      throw new TypeError(
        "solar.mount: `testSession` is required when mode === 'test'",
      );
    }
    if (!options.scene) {
      throw new TypeError(
        "solar.mount: `scene` is required when mode === 'test'",
      );
    }
  }
}
