import type { MountOptions } from "../types";

/** Throws on invalid mount options so hosts fail before the LSDP connection opens. */
export function validateOptions(options: MountOptions): void {
  if (
    options.sceneAudio !== undefined &&
    typeof options.sceneAudio !== "boolean"
  )
    throw new TypeError("solar.mount: sceneAudio must be boolean");
  if (!(options.target instanceof HTMLElement)) {
    throw new TypeError("solar.mount: `target` must be an HTMLElement");
  }
  const url = options.nativeLSDP?.url;
  const name = "nativeLSDP.url";
  if (typeof url !== "string" || url.length === 0) {
    throw new TypeError(`solar.mount: ${name} must be a non-empty string`);
  }
  if (
    !options.sceneSourceProvider ||
    typeof options.sceneSourceProvider.get !== "function"
  ) {
    throw new TypeError("solar.mount: `sceneSourceProvider.get` is required");
  }
  let parsedOrionUrl: URL;
  try {
    parsedOrionUrl = new URL(url);
  } catch {
    throw new TypeError(`solar.mount: ${name} must be an absolute URL`);
  }
  const isLoopback = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(
    parsedOrionUrl.hostname,
  );
  if (!isLoopback || !/^(ws|wss):$/i.test(parsedOrionUrl.protocol)) {
    throw new TypeError(
      "solar.mount: nativeLSDP.url must target a local native LSDP server",
    );
  }
  if (
    options.nativeLSDP &&
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(options.nativeLSDP.resource)
  ) {
    throw new TypeError(
      "solar.mount: nativeLSDP.resource is required and must be a valid resource name",
    );
  }
  if (
    options.nativeLSDP?.selector !== undefined &&
    !/^[a-z0-9-]{1,128}$/.test(options.nativeLSDP.selector)
  ) {
    throw new TypeError("solar.mount: invalid native scene selector");
  }
  if (options.nativeComposition !== undefined) {
    const { width, height } = options.nativeComposition;
    if (
      !Number.isSafeInteger(width) ||
      width < 1 ||
      !Number.isSafeInteger(height) ||
      height < 1
    )
      throw new TypeError("solar.mount: invalid native composition viewport");
  }
  const composition = options.nativeCompositionLSDP;
  if (composition) {
    const expectedGraph =
      options.nativeLSDP.resource === "solar/lane-a"
        ? "A"
        : options.nativeLSDP.resource === "solar/lane-b"
          ? "B"
          : null;
    if (
      !expectedGraph ||
      composition.graph !== expectedGraph ||
      composition.resource !== "solar/composition" ||
      composition.url !== options.nativeLSDP.url ||
      !options.nativeComposition ||
      typeof composition.producer_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(composition.producer_id)
    )
      throw new TypeError(
        "solar.mount: native composition publication must match its physical lane host",
      );
  }
}
