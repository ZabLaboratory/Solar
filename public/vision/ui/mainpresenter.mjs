import { fetchFonts, fontFactory } from "./fonts.mjs";

const IMAGE_BITMAP_OPTIONS = Object.freeze({
  premultiplyAlpha: "none",
  colorSpaceConversion: "default",
});

const WEBGL2_CONTEXT_ATTRIBUTES = Object.freeze({
  desynchronized: true,
  antialias: false,
  alpha: true,
  premultipliedAlpha: true,
});

const STOPPED = Symbol("presenter stopped");

export function selectPresenterProfile(search = "") {
  return new URLSearchParams(search).get("presenter") === "webgl" ? "webgl" : "webgpu";
}

export function createMainThreadPresenter(canvas, dependencies = {}) {
  const fetchResource = dependencies.fetch ?? ((...args) => globalThis.fetch(...args));
  const loadWasm = dependencies.loadWasm ?? (() => import("/pkg/lumencast_vision_web.js"));
  const createBitmap = dependencies.createImageBitmap ?? ((...args) => globalThis.createImageBitmap(...args));
  const BlobType = dependencies.Blob ?? globalThis.Blob;
  const clock = dependencies.performance ?? globalThis.performance;

  const listeners = new Map();
  let engine = null;
  let latestSize = null;
  let lastSequence = -1;
  let queue = Promise.resolve();
  let hasSubmittedFrame = false;
  let sceneLoaded = false;
  let disposed = false;
  let generation = 0;
  let context = null;
  let contextLost = false;
  let restoring = false;
  let restoreEpoch = 0;
  let initialRequest = null;
  let packageBytes = null;
  let fontBytes = null;
  let lastAppliedSequence = -1;
  let pendingRestore = false;
  const uploadedAssets = new Set();

  // State mutations stay in Rust while its GPU projection is unavailable.
  // There is no replay journal and no scene parse on the recovery path.
  function onContextLost(event) {
    if (disposed) return;
    event.preventDefault();
    contextLost = true;
    restoreEpoch += 1;
    emit({ type: "context-lost", seq: Math.max(0, lastSequence), phase: "context", message: "GPU context lost; accepted state is retained." });
  }

  function onContextRestored() {
    if (disposed || !initialRequest) return;
    if (restoring) { pendingRestore = true; return; }
    const ticket = generation;
    const epoch = restoreEpoch;
    restoring = true;
    queue = queue.then(async () => {
      ensureActive(ticket);
      emit({ type: "context-restoring", seq: Math.max(0, lastSequence) });
      if (engine) {
        if (typeof engine.restore_html_canvas !== "function") throw new Error("Rust GPU engine does not support retained context restoration.");
        const size = latestSize ?? authoredSurfaceSize(readEngineInfo(engine));
        await engine.restore_html_canvas(canvas, size.width, size.height);
        ensureActive(ticket);
        if (epoch !== restoreEpoch || context?.isContextLost?.()) throw new Error("GPU context was lost again during restoration.");
        if (sceneLoaded) await registerRequiredImages(engine, { Blob: BlobType, createImageBitmap: createBitmap }, () => {
          ensureActive(ticket);
          if (epoch !== restoreEpoch || context?.isContextLost?.()) throw new Error("GPU context was lost again during image restoration.");
        });
        uploadedAssets.clear();
        if (sceneLoaded) for (const path of parseJson(engine.required_images_json(), "required_images_json()")) uploadedAssets.add(path);
        ensureActive(ticket);
        if (epoch !== restoreEpoch || context?.isContextLost?.()) throw new Error("GPU context was lost again during image restoration.");
        contextLost = false;
        if (sceneLoaded) await submit(Math.max(0, lastAppliedSequence), size, {}, ticket);
      } else {
        contextLost = false;
        await initialize(initialRequest, {}, ticket);
      }
      ensureActive(ticket);
      if (contextLost) throw new Error("GPU context unavailable after restoration.");
      emit({ type: "context-restored", seq: Math.max(0, lastAppliedSequence) });
    }).catch(error => postError(Math.max(0, lastSequence), "context", error, {})).finally(() => {
      restoring = false;
      if (pendingRestore && !disposed) { pendingRestore = false; onContextRestored(); }
    });
  }

  canvas?.addEventListener?.("webglcontextlost", onContextLost);
  canvas?.addEventListener?.("webglcontextrestored", onContextRestored);

  function emit(message) {
    if (disposed) return;
    for (const listener of listeners.get("message") ?? []) listener({ data: message });
  }

  function postError(seq, phase, error, timing) {
    if (error === STOPPED || disposed) return;
    emit({
      type: "error",
      seq,
      phase: typeof phase === "string" ? phase : "presenter",
      message: error instanceof Error ? error.message : String(error),
      timing,
    });
  }

  function receiptFor(request, receivedAt) {
    return {
      mainThreadReceiptMs: Number.isFinite(request.sentAt) && Number.isFinite(clock.timeOrigin)
        ? Math.max(0, clock.timeOrigin + receivedAt - request.sentAt)
        : null,
    };
  }

  function elapsedSince(startedAt) {
    return Math.max(0, clock.now() - startedAt);
  }

  function isActive(ticket) {
    return !disposed && ticket === generation;
  }

  function ensureActive(ticket) {
    if (!isActive(ticket)) throw STOPPED;
  }

  function postMessage(request) {
    if (disposed || !request || !Number.isSafeInteger(request.seq) || request.seq < 0) return;

    const receivedAt = clock.now();
    if (request.seq <= lastSequence) return;
    lastSequence = request.seq;
    if (request.type === "patch") clock.mark?.(`vision-main-received-${request.seq}`);

    const receipt = receiptFor(request, receivedAt);
    if (request.type === "patch" && !hasSubmittedFrame) {
      postError(request.seq, "patch", withContext(new Error("State patches are unavailable until the first GPU submission."), "patch", receipt), receipt);
      return;
    }

    const ticket = generation;
    if (request.type === "init" || request.type === "init-empty") initialRequest = request;
    queue = queue.then(() => handle(request, receipt, ticket)).catch((error) => {
      postError(request.seq, error?.phase ?? request.type, error, error?.timing ?? receipt);
    });
  }

  async function handle(request, receipt, ticket) {
    ensureActive(ticket);
    if (request.type === "init" || request.type === "init-empty") {
      await initialize(request, receipt, ticket);
      return;
    }

    if (!engine) throw withContext(new Error("The Rust GPU engine is not ready."), request.type, receipt);

    if (request.type === "preload-fonts") {
      if (!Array.isArray(request.fonts) || request.fonts.some(f => !(f instanceof Uint8Array))) throw new Error("Font preload requires byte arrays.");
      if (typeof engine.preload_fonts !== "function") throw new Error("Rust engine does not support font preloading.");
      const info = parseJsonRecord(await engine.preload_fonts(request.fonts), "preload_fonts()");
      ensureActive(ticket);
      emit({type: "fonts-ready", seq: request.seq, fontRegistry: info});
      return;
    }

    if (request.type === "clear-scene") {
      if (typeof engine.clear_scene !== "function") throw new Error("Rust engine cannot release its scene.");
      engine.clear_scene();
      sceneLoaded = false;
      uploadedAssets.clear();
      hasSubmittedFrame = false;
      emit({ type: "scene-cleared", seq: request.seq });
      return;
    }

    if (request.type === "load") {
      await loadScene(request, receipt, ticket);
      return;
    }

    if (request.type === "resize") {
      await resize(request, receipt, ticket);
      return;
    }

    if (request.type === "patch") {
      await patch(request, receipt, ticket);
      return;
    }

    if (request.type === "media-frames") {
      await updateLiveFrames(request, receipt, ticket);
      return;
    }

    if (request.type === "media-clear") {
      await clearLiveFrames(request, receipt, ticket);
      return;
    }

    throw withContext(new Error(`Unknown presenter request: ${String(request.type)}`), "presenter", receipt);
  }

  async function initialize(request, receipt, ticket) {
    if (engine) throw withContext(new Error("The Rust GPU engine is already initialized for this canvas."), "init", receipt);
    if (request.canvas !== canvas || !canvas || typeof canvas.getContext !== "function") {
      throw withContext(new Error("The HTML canvas presenter did not receive its owned HTMLCanvasElement."), "init", receipt);
    }

    checkedSize(request.width, request.height);
    context = canvas.getContext("webgl2", WEBGL2_CONTEXT_ATTRIBUTES);
    if (!context) {
      throw withContext(new Error("This browser cannot create the requested WebGL2 canvas context."), "init", receipt);
    }

    const actualAttributes = typeof context.getContextAttributes === "function"
      ? context.getContextAttributes()
      : null;
    if (!actualAttributes || actualAttributes.desynchronized !== true) {
      throw withContext(new Error("The WebGL2 canvas context did not confirm desynchronized:true; the low-latency presenter cannot start."), "init", receipt);
    }

    emit({
      type: "presenter-info",
      seq: request.seq,
      presenterInfo: { name: "HTMLCanvas · WebGL2", desynchronized: true },
    });

    if (request.type !== "init-empty" && !packageBytes) {
      const sceneResponse = await fetchRequired("/scene", "Scene package", fetchResource);
      ensureActive(ticket);
      packageBytes = new Uint8Array(await sceneResponse.arrayBuffer());
    }
    if (request.type !== "init-empty" && !fontBytes) fontBytes = await fetchFonts(fetchResource);
    ensureActive(ticket);

    const wasm = await loadWasm();
    ensureActive(ticket);
    if (typeof wasm.default !== "function" || typeof wasm.VisionGpuEngine?.create_html_canvas !== "function") {
      throw withContext(new Error("The WASM package does not export init() and VisionGpuEngine.create_html_canvas()."), "init", receipt);
    }
    await wasm.default();
    ensureActive(ticket);

    const initialSize = checkedSize(request.width, request.height);
    if (request.type === "init-empty") {
      if (typeof wasm.VisionGpuEngine.create_empty_html_canvas !== "function") throw new Error("Rust engine cannot initialize independently of a scene.");
      const candidate = await wasm.VisionGpuEngine.create_empty_html_canvas(canvas, initialSize.width, initialSize.height);
      if (!isActive(ticket)) { candidate?.free?.(); throw STOPPED; }
      engine = candidate;
      validateEngine(engine);
      latestSize = initialSize;
      emit({ type: "engine-ready", seq: request.seq });
      return;
    }
    const sceneByteLength = packageBytes.byteLength;
    const candidate = await fontFactory(wasm.VisionGpuEngine, "create_html_canvas", fontBytes)(
      packageBytes,
      canvas,
      initialSize.width,
      initialSize.height,
    );
    if (!isActive(ticket)) {
      candidate?.free?.();
      throw STOPPED;
    }
    engine = candidate;
    validateEngine(engine);
    packageBytes = null;
    fontBytes = null;
    lastAppliedSequence = request.seq;
    sceneLoaded = true;

    const info = readEngineInfo(engine);
    const assetStartedAt = clock.now();
    await registerRequiredImages(engine, { Blob: BlobType, createImageBitmap: createBitmap });
    ensureActive(ticket);
    const assetDecodeUploadMs = elapsedSince(assetStartedAt);

    latestSize = authoredSurfaceSize(info);
    emit({
      type: "ready",
      seq: request.seq,
      info,
      mediaSources: readMediaSources(engine),
      width: latestSize.width,
      height: latestSize.height,
      sceneBytes: sceneByteLength,
      presenterInfo: { name: "HTMLCanvas · WebGL2", desynchronized: true },
      timing: { ...receipt, assetDecodeUploadMs },
    });

    try {
      await submit(request.seq, latestSize, receipt, ticket);
    } catch (error) {
      throw withContext(error, "init", error?.timing ?? receipt);
    }
  }

  async function loadScene(request, receipt, ticket) {
    if (!(request.packageBytes instanceof Uint8Array) || !Array.isArray(request.fonts)
        || request.fonts.some(font => !(font instanceof Uint8Array))) {
      throw new Error("Scene load requires fresh package bytes and explicit fonts.");
    }
    if (contextLost || context?.isContextLost?.()) throw new Error("GPU context unavailable during scene load.");
    if (typeof engine.load_scene !== "function") throw new Error("Rust engine does not support persistent scene loading.");
    const startedAt = clock.now();
    if (request.assets !== undefined) {
      if (!Array.isArray(request.assets) || request.assets.some(asset =>
          typeof asset.path !== "string" || !(asset.bytes instanceof Uint8Array))
          || request.fonts.length !== 0 || typeof engine.load_scene_parts !== "function") {
        throw new Error("Scene parts require bounded assets and an admitted font bank.");
      }
      await engine.load_scene_parts(request.packageBytes,
        request.assets.map(asset => asset.path), request.assets.map(asset => asset.bytes));
    } else {
      await engine.load_scene(request.packageBytes, request.fonts);
    }
    sceneLoaded = true;
    ensureActive(ticket);
    hasSubmittedFrame = false;
    uploadedAssets.clear();
    const sceneLoadMs = elapsedSince(startedAt);
    const assetStartedAt = clock.now();
    await registerRequiredImages(engine, { Blob: BlobType, createImageBitmap: createBitmap }, () => ensureActive(ticket));
    const info = readEngineInfo(engine);
    latestSize = authoredSurfaceSize(info);
    lastAppliedSequence = request.seq;
    const timing = { ...receipt, sceneLoadMs, assetDecodeUploadMs: elapsedSince(assetStartedAt) };
    emit({ type: "ready", seq: request.seq, info, mediaSources: readMediaSources(engine),
      width: latestSize.width, height: latestSize.height, sceneBytes: request.packageBytes.byteLength, timing });
    await submit(request.seq, latestSize, timing, ticket);
  }

  async function registerRequiredImages(candidate, { Blob: BlobClass, createImageBitmap: decodeBitmap }, checkContext = () => {}) {
    if (typeof BlobClass !== "function" || typeof decodeBitmap !== "function") {
      throw new Error("This browser cannot decode the scene's required image assets.");
    }

    const paths = parseJson(candidate.required_images_json(), "required_images_json()");
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string" || path.length === 0)) {
      throw new Error("The Rust engine returned an invalid required image path list.");
    }

    const unique = [...new Set(paths)];
    const decoded = await Promise.allSettled(unique.map(async (path) => {
      checkContext();
      const encoded = candidate.asset_bytes(path);
      if (!(encoded instanceof Uint8Array)) throw new Error(`Image asset ${path} was not returned as Uint8Array.`);
      const bitmap = await decodeBitmap(new BlobClass([encoded]), IMAGE_BITMAP_OPTIONS);
      if (!bitmap || typeof bitmap.close !== "function") throw new Error(`Image asset ${path} did not decode to an ImageBitmap.`);
      return { path, bitmap };
    }));
    try {
      const failed = decoded.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
      for (const result of decoded) {
        const { path, bitmap } = result.value;
        checkContext();
        await candidate.register_image(path, bitmap);
        checkContext();
        uploadedAssets.add(path);
      }
    } finally {
      for (const result of decoded) if (result.status === "fulfilled") result.value.bitmap.close();
    }
  }

  async function registerPatchImages(images, ticket) {
    if (images === undefined) return;
    if (!Array.isArray(images) || images.length > 128 || images.some(image =>
      !image || typeof image.path !== "string" || !(image.bytes instanceof Uint8Array)
      || image.bytes.length === 0 || image.bytes.length > 8 * 1024 * 1024)) {
      throw new Error("Invalid bounded image asset patch.");
    }
    const unique = new Map(images.filter(image => !uploadedAssets.has(image.path)).map(image => [image.path, image]));
    if (unique.size === 0) return;
    if (typeof engine.register_image_asset !== "function") throw new Error("Rust GPU engine does not support retained image admission.");
    const decoded = await Promise.allSettled([...unique.values()].map(async image => {
      ensureActive(ticket);
      const bitmap = await createBitmap(new BlobType([image.bytes]), IMAGE_BITMAP_OPTIONS);
      if (!bitmap || typeof bitmap.close !== "function") throw new Error(`Image asset ${image.path} did not decode to an ImageBitmap.`);
      return { ...image, bitmap };
    }));
    try {
      const failed = decoded.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
      for (const result of decoded) {
        ensureActive(ticket);
        if (contextLost || context?.isContextLost?.()) throw new Error("GPU context unavailable during image admission.");
        const { path, bytes, bitmap } = result.value;
        await engine.register_image_asset(path, bytes, bitmap);
        uploadedAssets.add(path);
      }
    } finally {
      for (const result of decoded) if (result.status === "fulfilled") result.value.bitmap.close();
    }
  }

  async function resize(request, receipt, ticket) {
    const size = checkedSize(request.width, request.height);
    if (latestSize && latestSize.width === size.width && latestSize.height === size.height) {
      emit({ type: "resize-unchanged", seq: request.seq, width: size.width, height: size.height });
      return;
    }

    try {
      await submit(request.seq, size, receipt, ticket);
      latestSize = size;
    } catch (error) {
      throw withContext(error, "resize", error?.timing ?? receipt);
    }
  }

  async function patch(request, receipt, ticket) {
    if (typeof request.patchJson !== "string") {
      throw withContext(new Error("A state patch must be serialized JSON."), "patch", receipt);
    }

    const applyStartedAt = clock.now();
    let rawMetadata;
    try {
      await registerPatchImages(request.images, ticket);
      rawMetadata = await engine.apply_patch(request.patchJson);
      ensureActive(ticket);
    } catch (error) {
      throw withContext(error, "patch", { ...receipt, engineApplyCallMs: elapsedSince(applyStartedAt) });
    }

    const engineApplyCallMs = elapsedSince(applyStartedAt);
    let metadata;
    try {
      metadata = parseJsonRecord(rawMetadata, "apply_patch()");
    } catch (error) {
      throw withContext(error, "patch", { ...receipt, engineApplyCallMs });
    }

    const patchTiming = { ...receipt, engineApplyCallMs };
    lastAppliedSequence = request.seq;
    emit({
      type: "patch-applied",
      seq: request.seq,
      metadata: { ...metadata, seq: request.seq, engineApplyCallMs },
      mediaSources: readMediaSources(engine),
      timing: patchTiming,
    });

    if (!latestSize) return;
    try {
      await submit(request.seq, latestSize, patchTiming, ticket);
    } catch (error) {
      throw withContext(error, "patch", error?.timing ?? patchTiming);
    }
  }

  async function updateLiveFrames(request, receipt, ticket) {
    if (!hasSubmittedFrame) {
      throw withContext(new Error("Live media updates are unavailable until the first GPU submission."), "media-frames", receipt);
    }
    if (!Array.isArray(request.frames) || request.frames.length === 0) {
      throw withContext(new Error("A live media update must contain at least one frame."), "media-frames", receipt);
    }
    try {
      for (const frame of request.frames) {
        if (!frame || typeof frame.path !== "string" || !frame.bitmap || typeof frame.bitmap.close !== "function") {
          throw new Error("A live media frame needs a path and an owned ImageBitmap.");
        }
        await engine.update_live_image(frame.path, frame.bitmap);
        ensureActive(ticket);
      }
      if (latestSize) await submit(request.seq, latestSize, receipt, ticket);
      lastAppliedSequence = request.seq;
      emit({ type: "media-applied", seq: request.seq, mediaSources: readMediaSources(engine), timing: receipt });
    } catch (error) {
      throw withContext(error, "media-frames", receipt);
    } finally {
      for (const frame of request.frames) frame?.bitmap?.close?.();
    }
  }

  async function clearLiveFrames(request, receipt, ticket) {
    if (!Array.isArray(request.paths) || request.paths.some((path) => typeof path !== "string" || path.length === 0)) {
      throw withContext(new Error("A live media clear must contain valid image paths."), "media-clear", receipt);
    }
    try {
      let changed = false;
      for (const path of new Set(request.paths)) {
        // Rust knows whether this active texture actually held live pixels.
        // Legacy engines return void; keep their conservative render behavior.
        changed = (await engine.clear_live_image(path)) !== false || changed;
        ensureActive(ticket);
      }
      if (changed && latestSize) await submit(request.seq, latestSize, receipt, ticket);
      lastAppliedSequence = request.seq;
      emit({ type: "media-cleared", seq: request.seq, paths: [...new Set(request.paths)], timing: receipt });
    } catch (error) {
      throw withContext(error, "media-clear", receipt);
    }
  }

  async function submit(seq, size, timing, ticket) {
    if (contextLost || context?.isContextLost?.()) {
      contextLost = true;
      emit({ type: "frame-deferred", seq, phase: "context", timing, message: "State accepted; rendering awaits GPU context restoration." });
      return;
    }
    const info = readEngineInfo(engine);
    const startedAt = clock.now();
    let rawStats;
    try {
      rawStats = await engine.render(size.width, size.height);
      ensureActive(ticket);
    } catch (error) {
      throw withContext(error, "render", { ...timing, gpuSubmitCallMs: elapsedSince(startedAt) });
    }

    const gpuSubmitCallMs = elapsedSince(startedAt);
    if (contextLost || context?.isContextLost?.()) {
      contextLost = true;
      emit({ type: "frame-deferred", seq, phase: "context", timing, message: "GPU context interrupted the submission." });
      return;
    }
    clock.mark?.(`vision-main-submitted-${seq}`);

    let stats;
    try {
      stats = parseJsonRecord(rawStats, "render()");
    } catch (error) {
      throw withContext(error, "render", { ...timing, gpuSubmitCallMs });
    }

    emit({
      type: "frame-submitted",
      seq,
      width: size.width,
      height: size.height,
      stats,
      info,
      presenterInfo: { name: "HTMLCanvas · WebGL2", desynchronized: true },
      timing: { ...timing, gpuSubmitCallMs },
    });
    hasSubmittedFrame = true;
  }

  function addEventListener(type, listener) {
    if (typeof listener !== "function") return;
    const entries = listeners.get(type) ?? new Set();
    entries.add(listener);
    listeners.set(type, entries);
  }

  function terminate() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const ownedEngine = engine;
    engine = null;
    latestSize = null;
    hasSubmittedFrame = false;
    // wasm-bindgen holds a mutable Rust borrow across asynchronous restoration.
    // Release the engine only after that call and all queued work have settled.
    queue = queue.catch(() => {}).then(() => ownedEngine?.free?.());
    canvas?.removeEventListener?.("webglcontextlost", onContextLost);
    canvas?.removeEventListener?.("webglcontextrestored", onContextRestored);
    packageBytes = null;
    fontBytes = null;
    initialRequest = null;
  }

  return {
    addEventListener,
    postMessage,
    terminate,
    flush: () => queue,
  };
}

async function fetchRequired(url, label, fetcher) {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}.`);
  return response;
}

function validateEngine(candidate) {
  const methods = [
    "info_json",
    "required_images_json",
    "asset_bytes",
    "live_media_sources_json",
    "register_image",
    "update_live_image",
    "clear_live_image",
    "render",
    "apply_patch",
  ];
  if (!candidate || methods.some((method) => typeof candidate[method] !== "function")) {
    throw new Error("VisionGpuEngine is missing a required typed WASM method.");
  }
}

function readMediaSources(instance) {
  const sources = parseJson(instance.live_media_sources_json(), "live_media_sources_json()");
  if (!Array.isArray(sources)) throw new Error("The Rust GPU engine returned an invalid live media source list.");
  return sources;
}

function readEngineInfo(instance) {
  const info = parseJsonRecord(instance.info_json(), "info_json()");
  if (!Number.isFinite(info.width) || info.width <= 0 || !Number.isFinite(info.height) || info.height <= 0) {
    throw new Error("The Rust GPU engine did not report valid authored scene dimensions.");
  }
  return info;
}

function authoredSurfaceSize(info) {
  return checkedSize(Math.ceil(info.width), Math.ceil(info.height));
}

function checkedSize(width, height) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error("Requested GPU surface dimensions are invalid.");
  }
  if (!Number.isSafeInteger(width * height)) throw new Error("Requested GPU surface dimensions exceed the supported range.");
  return { width, height };
}

function parseJson(value, label) {
  if (typeof value !== "string") throw new Error(`Rust ${label} did not return JSON text.`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Rust ${label} returned invalid JSON.`);
  }
}

function parseJsonRecord(value, label) {
  const result = parseJson(value, label);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`Rust ${label} did not return a JSON object.`);
  }
  return result;
}

function withContext(value, phase, timing) {
  const error = value instanceof Error ? value : new Error(String(value));
  error.phase = phase;
  error.timing = timing;
  return error;
}
