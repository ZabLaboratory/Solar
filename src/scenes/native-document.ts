import { canonicalRender } from "./canonical-render";
import { VerifiedFont } from "./verified-font";
import type { Operation } from "fast-json-patch";
import { unzipSync, zipSync } from "fflate";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { SceneRenderDelivery, SceneImageAssetsProvider } from "./types";
import { prepareAnimationBindings } from "../engine/animations";
import { compileSound } from "../engine/sound/catalogue";
import {
  prepareEditableBindings,
  prepareNativeComposition,
} from "./editable-bindings";

export type LSMLDocument = Record<string, unknown> & {
  scene_id: string;
  scene_version: string;
  defaults?: Record<string, unknown>;
};

export function requireLSML(value: unknown): LSMLDocument {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Native resource must contain an LSML document.");
  const document = value as LSMLDocument;
  if (!["1.0", "1.1", "1.2"].includes(String(document.lsml)))
    throw new Error("Native resource LSML version is unsupported.");
  if (
    typeof document.scene_id !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(document.scene_version) ||
    !document.layout
  ) {
    throw new Error("Native resource LSML identity/layout is missing.");
  }
  compileSound(document);
  return document;
}

export function defaultsPatch(
  operations: Operation[],
  next: LSMLDocument,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  for (const operation of operations) {
    if (operation.op === "test") continue;
    if (operation.path === "/x-orion" || operation.path.startsWith("/x-orion/"))
      continue;
    if (
      !["replace", "add"].includes(operation.op) ||
      !/^\/defaults\/[^/]+$/.test(operation.path)
    )
      return null;
    const key = operation.path
      .slice(10)
      .replace(/~1/g, "/")
      .replace(/~0/g, "~");
    if (
      key.startsWith("__cam.") ||
      key.startsWith("__animation.") ||
      key === "__audio.mix"
    )
      continue;
    patch[key] = next.defaults?.[key];
  }
  return patch;
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value))
    return String(value);
  throw new Error("LSML text binding requires a scalar value.");
}

// An unresolved/cleared image binding is a transparent image, as in the
// authoring scene. Vision requires an effective asset path even in that state.
const EMPTY_IMAGE_PATH = "assets/__solar-empty-image.png";
const EMPTY_IMAGE = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const MAX_REMOTE_IMAGE_URLS = 128;
const MAX_RUNTIME_IMAGE_ASSETS = 128;
const MAX_RUNTIME_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_RUNTIME_IMAGE_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT_IMAGE_REQUESTS = 8;

type DynamicImageEntry = {
  path: string;
  bytes: Uint8Array;
  references: number;
  used: number;
};

type ImageResolution = {
  path: string;
  bytes?: Uint8Array;
  release: () => void;
};

type RemoteImageEntry = {
  path?: string;
  pending?: Promise<ImageResolutionRecord>;
  waiters: number;
  used: number;
};

type ImageResolutionRecord = {
  path: string;
  bytes?: Uint8Array;
  cached?: DynamicImageEntry;
};

function imageResolution(record: ImageResolutionRecord): ImageResolution {
  let released = false;
  return {
    path: record.path,
    ...(record.bytes ? { bytes: record.bytes } : {}),
    release: () => {
      if (released) return;
      released = true;
      if (record.cached)
        record.cached.references = Math.max(0, record.cached.references - 1);
    },
  };
}

export function visionImageValue(
  value: unknown,
  assets: Record<string, string>,
): unknown {
  return value == null || value === ""
    ? EMPTY_IMAGE_PATH
    : typeof value === "string"
      ? (assets[value] ?? value)
      : value;
}

/** Keep shared numeric variables intact while projecting their textual use. */
export function visionTextPatch(
  state: Record<string, unknown>,
  bindings: Record<string, string>,
): Record<string, unknown> {
  const result = { ...state };
  for (const [path, alias] of Object.entries(bindings)) {
    if (Object.hasOwn(state, path)) result[alias] = textValue(state[path]);
  }
  return result;
}

function prepareTextBindings(variant: LSMLDocument): Record<string, string> {
  const bindings: Record<string, string> = Object.create(null);
  const defaults = { ...variant.defaults };
  let sequence = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.kind === "text" || node.type === "text") {
      const bind = node.bind as Record<string, unknown> | undefined;
      const path = bind?.value;
      // Repeater row bindings belong to the row context, not scene defaults.
      if (typeof path === "string" && Object.hasOwn(defaults, path)) {
        let alias = bindings[path];
        if (!alias) {
          do {
            alias = `__solar.text.${sequence++}`;
          } while (Object.hasOwn(defaults, alias));
          bindings[path] = alias;
          defaults[alias] = textValue(defaults[path]);
        }
        bind!.value = alias;
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(variant.layout);
  variant.defaults = defaults;
  return bindings;
}

/** Runtime package only. Published source bytes and Blue validation pins are immutable. */
export class NativeSceneAssets {
  private readonly files: Record<string, Uint8Array>;
  private readonly remote = new Map<string, RemoteImageEntry>();
  private readonly dynamicImages = new Map<string, DynamicImageEntry>();
  private dynamicImageBytes = 0;
  private pendingImageAssets = 0;
  private pendingImageBytes = 0;
  private queuedImageRequestCount = 0;
  private activeImageRequestCount = 0;
  private readonly queuedImageRequests: Array<() => void> = [];
  private imageUseSequence = 0;
  private readonly fonts = new Map<string, Promise<VerifiedFont>>();

  soundAssets(): ReadonlyMap<string, Uint8Array> {
    return new Map(Object.entries(this.files));
  }

  get byteLength(): number {
    return Object.values(this.files).reduce(
      (total, bytes) => total + bytes.byteLength,
      0,
    );
  }
  constructor(
    readonly origin: SceneRenderDelivery,
    private readonly fetchResource: typeof fetch = globalThis.fetch.bind(
      globalThis,
    ),
    private readonly hostImages?: SceneImageAssetsProvider,
    private readonly onImages?: (started: number) => void,
  ) {
    if (
      !("provenance" in origin) &&
      (origin.sceneId !== origin.blueManifest.scene_id ||
        origin.sceneVersion !== origin.blueManifest.scene_version ||
        origin.revision !== origin.blueManifest.scene_revision)
    ) {
      throw new Error("Native source Blue manifest identity mismatch.");
    }
    this.files =
      origin.format === "lsmlz"
        ? unzipSync(origin.data)
        : Object.fromEntries(
            [...origin.assets].map(([path, bytes]) => [
              path,
              new Uint8Array(bytes),
            ]),
          );
    delete this.files["scene.lsml"];
    if (
      this.files[EMPTY_IMAGE_PATH] &&
      this.files[EMPTY_IMAGE_PATH].some((byte, i) => byte !== EMPTY_IMAGE[i])
    )
      throw new Error(
        "Scene contains a conflicting reserved empty image asset.",
      );
    this.files[EMPTY_IMAGE_PATH] = EMPTY_IMAGE;
  }

  private async imagePath(
    value: unknown,
    document: LSMLDocument,
    signal?: AbortSignal,
  ): Promise<ImageResolution> {
    if (value == null || value === "")
      return {
        path: EMPTY_IMAGE_PATH,
        bytes: this.files[EMPTY_IMAGE_PATH],
        release: () => {},
      };
    if (typeof value === "string" && value.startsWith("data:")) {
      const match =
        /^data:image\/(png|jpeg|webp|gif|svg\+xml|avif);base64,([A-Za-z0-9+/=]+)$/.exec(
          value,
        );
      const format = match?.[1];
      if (!format || !match?.[2] || match[2].length > 12 * 1024 * 1024)
        throw new Error("Scene inline image is invalid or too large.");
      const bytes = Uint8Array.from(atob(match[2]), (char) =>
        char.charCodeAt(0),
      );
      if (!bytes.length || bytes.length > MAX_RUNTIME_IMAGE_ASSET_BYTES)
        throw new Error("Scene inline image exceeds 8 MiB.");
      const extension =
        format === "svg+xml" ? "svg" : format === "jpeg" ? "jpg" : format;
      return this.admitDynamicImage(bytes, extension);
    }
    if (typeof value !== "string" || !/^https?:\/\//.test(value)) {
      const bytes = typeof value === "string" ? this.files[value] : undefined;
      return {
        path: String(value),
        ...(bytes ? { bytes } : {}),
        release: () => {},
      };
    }
    const url = new URL(value);
    const hosts =
      (document.assets as { allowedHosts?: string[] } | undefined)
        ?.allowedHosts ?? [];
    if (url.username || url.password || !hosts.includes(url.hostname))
      throw new Error(`Scene image host is not allowed: ${url.hostname}`);
    const cached = this.remote.get(value);
    if (cached) {
      cached.used = ++this.imageUseSequence;
      if (cached.pending) {
        cached.waiters++;
        try {
          return imageResolution(await cached.pending);
        } finally {
          cached.waiters = Math.max(0, cached.waiters - 1);
        }
      }
      if (cached.path) {
        const dynamic = this.dynamicImages.get(cached.path);
        const source = this.files[cached.path];
        if (dynamic) {
          dynamic.references++;
          dynamic.used = ++this.imageUseSequence;
          return imageResolution({
            path: dynamic.path,
            bytes: dynamic.bytes,
            cached: dynamic,
          });
        }
        if (source)
          return imageResolution({ path: cached.path, bytes: source });
      }
      this.remote.delete(value);
    }
    this.makeRemoteCacheSpace();
    const entry: RemoteImageEntry = {
      waiters: 1,
      used: ++this.imageUseSequence,
    };
    this.remote.set(value, entry);
    entry.pending = (async () => {
      let releaseRequest: (() => void) | undefined;
      let reservation = false;
      let reservedBytes = 0;
      let response: Response | null = null;
      try {
        releaseRequest = await this.acquireImageRequest();
        this.reserveDynamicImage();
        reservation = true;
        const hosted = this.hostImages
          ? await this.hostImages.get(url.href, { signal })
          : null;
        response = hosted
          ? null
          : await this.fetchResource(url.href, {
              credentials: "omit",
              signal,
            });
        if (response && !response.ok)
          throw new Error(
            `Scene image fetch failed (${response.status}): ${url.hostname}`,
          );
        const finalURL = new URL(response?.url || url.href);
        if (
          !hosts.includes(finalURL.hostname) ||
          !["http:", "https:"].includes(finalURL.protocol)
        )
          throw new Error("Scene image redirect host is not allowed.");
        const type =
          hosted?.contentType ??
          response?.headers.get("content-type")?.split(";")[0];
        const extensions: Record<string, string> = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
          "image/svg+xml": "svg",
          "image/avif": "avif",
        };
        if (!type || !extensions[type])
          throw new Error(
            "Scene image response has an unsupported content type.",
          );
        const maximum = MAX_RUNTIME_IMAGE_ASSET_BYTES;
        if (Number(response?.headers.get("content-length") ?? 0) > maximum)
          throw new Error("Scene image exceeds 8 MiB.");
        const bytes = hosted
          ? new Uint8Array(hosted.data)
          : await this.readRemoteImageBytes(response!, (amount) => {
              reservedBytes += amount;
            });
        if (hosted) {
          this.reserveDynamicImageBytes(bytes.byteLength);
          reservedBytes += bytes.byteLength;
        }
        if (!bytes.length || bytes.length > maximum)
          throw new Error("Scene image exceeds the accepted byte limits.");
        reservation = false;
        const record = this.storeDynamicImage(
          bytes,
          extensions[type]!,
          entry.waiters,
          reservedBytes,
        );
        reservedBytes = 0;
        entry.path = record.path;
        delete entry.pending;
        return record;
      } catch (error) {
        if (reservation) this.releaseDynamicReservation(reservedBytes);
        try {
          await response?.body?.cancel();
        } catch {
          // A stream may already be errored or cancelled by readRemoteImageBytes.
        }
        if (this.remote.get(value) === entry) this.remote.delete(value);
        throw error;
      } finally {
        releaseRequest?.();
      }
    })();
    try {
      return imageResolution(await entry.pending);
    } finally {
      entry.waiters = Math.max(0, entry.waiters - 1);
    }
  }

  private admitDynamicImage(
    bytes: Uint8Array,
    extension: string,
  ): ImageResolution {
    if (!bytes.length || bytes.length > MAX_RUNTIME_IMAGE_ASSET_BYTES)
      throw new Error("Scene image exceeds the accepted byte limits.");
    const record = this.storeDynamicImage(bytes, extension, 1, null);
    return imageResolution(record);
  }

  private storeDynamicImage(
    bytes: Uint8Array,
    extension: string,
    references: number,
    reservedBytes: number | null,
  ): ImageResolutionRecord {
    if (reservedBytes !== null) this.releaseDynamicReservation(reservedBytes);
    const path = `assets/solar-${bytesToHex(sha256(bytes))}.${extension}`;
    const source = this.files[path];
    if (source) return { path, bytes: source };
    const existing = this.dynamicImages.get(path);
    if (existing) {
      existing.references += references;
      existing.used = ++this.imageUseSequence;
      return { path, bytes: existing.bytes, cached: existing };
    }
    this.makeDynamicImageSpace(bytes.byteLength, 1);
    const entry: DynamicImageEntry = {
      path,
      bytes,
      references,
      used: ++this.imageUseSequence,
    };
    this.dynamicImages.set(path, entry);
    this.dynamicImageBytes += entry.bytes.byteLength;
    return { path, bytes: entry.bytes, cached: entry };
  }

  private reserveDynamicImage(): void {
    this.makeDynamicImageSpace(0, 1);
    this.pendingImageAssets++;
  }

  private reserveDynamicImageBytes(bytes: number): void {
    if (!bytes) return;
    this.makeDynamicImageSpace(bytes, 0);
    this.pendingImageBytes += bytes;
  }

  private async readRemoteImageBytes(
    response: Response,
    onReserved: (bytes: number) => void,
  ): Promise<Uint8Array> {
    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_RUNTIME_IMAGE_ASSET_BYTES)
        throw new Error("Scene image exceeds the accepted byte limits.");
      this.reserveDynamicImageBytes(bytes.byteLength);
      onReserved(bytes.byteLength);
      return bytes;
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        if (totalBytes + value.byteLength > MAX_RUNTIME_IMAGE_ASSET_BYTES)
          throw new Error("Scene image exceeds the accepted byte limits.");
        this.reserveDynamicImageBytes(value.byteLength);
        onReserved(value.byteLength);
        totalBytes += value.byteLength;
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
    if (!totalBytes)
      throw new Error("Scene image exceeds the accepted byte limits.");
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunks.length = 0;
    return bytes;
  }

  private acquireImageRequest(): Promise<() => void> {
    if (this.queuedImageRequestCount >= MAX_REMOTE_IMAGE_URLS)
      return Promise.reject(
        new Error("Scene image request queue limit reached."),
      );
    this.queuedImageRequestCount++;
    return new Promise((resolve) => {
      const acquire = (): void => {
        this.queuedImageRequestCount--;
        this.activeImageRequestCount++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.activeImageRequestCount = Math.max(
            0,
            this.activeImageRequestCount - 1,
          );
          const next = this.queuedImageRequests.shift();
          next?.();
        });
      };
      if (this.activeImageRequestCount < MAX_CONCURRENT_IMAGE_REQUESTS) {
        acquire();
      } else {
        this.queuedImageRequests.push(acquire);
      }
    });
  }

  private releaseDynamicReservation(bytes: number): void {
    this.pendingImageAssets = Math.max(0, this.pendingImageAssets - 1);
    this.pendingImageBytes = Math.max(0, this.pendingImageBytes - bytes);
  }

  private makeDynamicImageSpace(
    requiredBytes: number,
    requiredAssets: number,
  ): void {
    while (
      this.dynamicImages.size + this.pendingImageAssets + requiredAssets >
        MAX_RUNTIME_IMAGE_ASSETS ||
      this.dynamicImageBytes + this.pendingImageBytes + requiredBytes >
        MAX_RUNTIME_IMAGE_BYTES
    ) {
      let candidate: DynamicImageEntry | undefined;
      for (const image of this.dynamicImages.values())
        if (
          image.references === 0 &&
          (!candidate || image.used < candidate.used)
        )
          candidate = image;
      if (!candidate)
        throw new Error(
          "Scene dynamic image cache is at its active/pending limit.",
        );
      this.dynamicImages.delete(candidate.path);
      this.dynamicImageBytes -= candidate.bytes.byteLength;
    }
  }

  private makeRemoteCacheSpace(): void {
    while (this.remote.size >= MAX_REMOTE_IMAGE_URLS) {
      let candidate: [string, RemoteImageEntry] | undefined;
      for (const item of this.remote)
        if (
          !item[1].pending &&
          (!candidate || item[1].used < candidate[1].used)
        )
          candidate = item;
      if (!candidate)
        throw new Error(
          "Scene remote image request limit reached (all slots pending).",
        );
      this.remote.delete(candidate[0]);
    }
  }

  private async prepareImageBindings(
    variant: LSMLDocument,
    document: LSMLDocument,
    signal?: AbortSignal,
  ): Promise<{
    bindings: Record<string, string>;
    imageAssets: Record<string, string>;
    assets: Array<{ path: string; bytes: Uint8Array }>;
  }> {
    const bindings: Record<string, string> = Object.create(null);
    const imageAssets: Record<string, string> = Object.create(null);
    const files = new Map<string, Uint8Array>();
    const acquired: ImageResolution[] = [];
    const defaults = variant.defaults ?? {};
    let sequence = 0;
    const pending: Promise<void>[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.kind === "image" || node.type === "image") {
        const bind = node.bind as Record<string, unknown> | undefined;
        const path = bind?.src;
        if (typeof path === "string" && Object.hasOwn(defaults, path)) {
          let alias = bindings[path];
          if (!alias) {
            do {
              alias = `__solar.image.${sequence++}`;
            } while (Object.hasOwn(defaults, alias));
            bindings[path] = alias;
            const imageAlias = alias;
            pending.push(
              this.imagePath(defaults[path], document, signal).then((image) => {
                acquired.push(image);
                defaults[imageAlias] = image.path;
                if (typeof defaults[path] === "string")
                  imageAssets[defaults[path] as string] = image.path;
                if (image.bytes) files.set(image.path, image.bytes);
              }),
            );
          }
          bind!.src = alias;
        } else if (typeof node.src === "string") {
          pending.push(
            this.imagePath(node.src, document, signal).then((image) => {
              acquired.push(image);
              imageAssets[node.src as string] = image.path;
              node.src = image.path;
              if (image.bytes) files.set(image.path, image.bytes);
            }),
          );
        }
      }
      Object.values(node).forEach(visit);
    };
    visit(variant.layout);
    const results = await Promise.allSettled(pending);
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed) {
      acquired.forEach((image) => image.release());
      throw failed.reason;
    }
    variant.defaults = defaults;
    acquired.forEach((image) => image.release());
    return {
      bindings,
      imageAssets,
      assets: [...files].map(([path, bytes]) => ({ path, bytes })),
    };
  }

  /** Resolve changed image leaves before one retained Vision state submission. */
  async prepareImagePatch(
    patch: Record<string, unknown>,
    bindings: Record<string, string>,
    document: LSMLDocument,
    signal?: AbortSignal,
  ): Promise<{
    values: Record<string, unknown>;
    assets: Array<{ path: string; bytes: Uint8Array }>;
    release: () => void;
  }> {
    const started = performance.now();
    const values: Record<string, unknown> = {};
    const files = new Map<string, Uint8Array>();
    const resolutions = await Promise.allSettled(
      Object.entries(bindings)
        .filter(([path]) => Object.hasOwn(patch, path))
        .map(async ([path]) => {
          const image = await this.imagePath(patch[path], document, signal);
          if (!image.bytes) {
            image.release();
            throw new Error(`Scene image asset is unavailable: ${path}`);
          }
          return { key: path, image };
        }),
    );
    const acquired = resolutions.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.image] : [],
    );
    const failed = resolutions.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed) {
      acquired.forEach((image) => image.release());
      throw failed.reason;
    }
    for (const result of resolutions) {
      if (result.status !== "fulfilled") continue;
      values[result.value.key] = result.value.image.path;
      files.set(result.value.image.path, result.value.image.bytes!);
    }
    this.onImages?.(started);
    return {
      values,
      assets: [...files].map(([path, bytes]) => ({ path, bytes })),
      release: () => acquired.forEach((image) => image.release()),
    };
  }

  async renderPackage(
    document: LSMLDocument,
    signal?: AbortSignal,
    nativeComposition?: { width: number; height: number },
    separateFonts = false,
    directParts = false,
  ): Promise<{
    data: Uint8Array;
    assets?: Array<{ path: string; bytes: Uint8Array }>;
    sceneVersion: string;
    lsmlDefaults: true;
    initialDefaults: Record<string, unknown>;
    textBindings: Record<string, string>;
    imageBindings: Record<string, string>;
    imageAssets: Record<string, string>;
    imageValues: Record<string, unknown>;
    animationBindings: Record<string, string>;
    geometryBindings: Record<string, [string, string]>;
    hostFonts?: VerifiedFont[];
    surface?: { width: number; height: number };
  }> {
    if (
      document.scene_id !== this.origin.sceneId ||
      document.scene_version !== this.origin.sceneVersion
    ) {
      throw new Error(
        "Native document does not match its pinned source origin.",
      );
    }
    // Native resource identity stays pinned to its origin. Vision requires the
    // content address of the edited render variant; compute it on this clone.
    const rendering = { ...document };
    delete rendering["x-solar-authoring"];
    const variant = structuredClone(rendering);
    // Camera credentials and slot names belong to the host, not Vision's
    // variable grammar. Positional refs such as @0 remain valid slot keys;
    // forwarding __cam.slots.@0 as a render default makes Vision reject LSML.
    variant.defaults = Object.fromEntries(
      Object.entries(variant.defaults ?? {}).filter(
        ([key]) => !key.startsWith("__cam."),
      ),
    );
    const geometryBindings = prepareEditableBindings(variant);
    const animationBindings = prepareAnimationBindings(variant);
    const surface = nativeComposition
      ? prepareNativeComposition(variant, nativeComposition)
      : undefined;
    const textBindings = prepareTextBindings(variant);
    const preparedImages = await this.prepareImageBindings(
      variant,
      document,
      signal,
    );
    const imageBindings = preparedImages.bindings;
    const canonical = await canonicalRender(variant);
    variant.scene_version = canonical.sceneVersion;
    // Runtime-only transfer: source/import/export files stay intact. Fonts are
    // admitted to the persistent engine bank before this fresh scene is loaded.
    const fonts: VerifiedFont[] = [];
    const files = { ...this.files };
    for (const { path, bytes } of preparedImages.assets)
      if (!Object.hasOwn(files, path)) files[path] = bytes;
    const fontEntries = await Promise.all(
      Object.entries(this.files).map(async ([path, source]) => {
        // Other paths remain in the archive, where Vision's package validator
        // owns path admission. Preserve its SHA-1/SHA-256 address checks here.
        const match =
          /^assets\/([a-zA-Z0-9_-]+)\.(ttf|otf|ttc|woff|woff2)$/.exec(path);
        if (!separateFonts || !match) return null;
        const address = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(match[1]!)
          ? match[1]
          : undefined;
        let prepared = this.fonts.get(path);
        if (!prepared) {
          prepared = VerifiedFont.admit(source, address);
          this.fonts.set(path, prepared);
        }
        const font = await prepared;
        return { path, font };
      }),
    );
    for (const entry of fontEntries) {
      if (!entry) continue;
      fonts.push(entry.font);
      delete files[entry.path];
    }
    return {
      data: directParts
        ? canonical.data
        : zipSync({ ...files, "scene.lsml": canonical.data }, { level: 0 }),
      ...(directParts
        ? {
            assets: Object.entries(files).map(([path, bytes]) => ({
              path,
              bytes,
            })),
          }
        : {}),
      sceneVersion: variant.scene_version,
      lsmlDefaults: true,
      initialDefaults: { ...variant.defaults },
      textBindings,
      imageBindings,
      imageAssets: preparedImages.imageAssets,
      imageValues: Object.fromEntries(
        Object.entries(imageBindings).map(([path, alias]) => [
          path,
          variant.defaults?.[alias],
        ]),
      ),
      animationBindings,
      geometryBindings,
      ...(separateFonts ? { hostFonts: fonts } : {}),
      ...(surface ? { surface } : {}),
    };
  }
}
