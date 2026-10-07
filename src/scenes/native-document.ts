import { bundleAddress, canonicalize } from "@lumencast/canonical";
import type { Operation } from "fast-json-patch";
import { strToU8, unzipSync, zipSync } from "fflate";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { SceneRenderDelivery } from "./types";
import { prepareAnimationBindings } from "../engine/animations";
import { prepareEditableBindings } from "./editable-bindings";

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
    if (key.startsWith("__cam.") || key.startsWith("__animation.")) continue;
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
  private readonly remote = new Map<string, Promise<string>>();
  private readonly imageAssets: Record<string, string> = Object.create(null);
  constructor(
    readonly origin: SceneRenderDelivery,
    private readonly fetchResource: typeof fetch = globalThis.fetch.bind(
      globalThis,
    ),
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
        : Object.fromEntries(origin.assets);
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
  ): Promise<unknown> {
    if (value == null || value === "") return EMPTY_IMAGE_PATH;
    if (typeof value === "string" && value.startsWith("data:")) {
      const match =
        /^data:image\/(png|jpeg|webp|gif|svg\+xml|avif);base64,([A-Za-z0-9+/=]+)$/.exec(
          value,
        );
      if (!match?.[2] || match[2].length > 12 * 1024 * 1024)
        throw new Error("Scene inline image is invalid or too large.");
      const bytes = Uint8Array.from(atob(match[2]), (char) =>
        char.charCodeAt(0),
      );
      if (!bytes.length || bytes.length > 8 * 1024 * 1024)
        throw new Error("Scene inline image exceeds 8 MiB.");
      const extension =
        match[1] === "svg+xml" ? "svg" : match[1] === "jpeg" ? "jpg" : match[1];
      const path = `assets/solar-${bytesToHex(sha256(bytes))}.${extension}`;
      this.files[path] = bytes;
      this.imageAssets[value] = path;
      return path;
    }
    if (typeof value !== "string" || !/^https?:\/\//.test(value)) return value;
    const url = new URL(value);
    const hosts =
      (document.assets as { allowedHosts?: string[] } | undefined)
        ?.allowedHosts ?? [];
    if (url.username || url.password || !hosts.includes(url.hostname))
      throw new Error(`Scene image host is not allowed: ${url.hostname}`);
    const cached = this.remote.get(value);
    if (cached) return cached;
    if (this.remote.size >= 128)
      throw new Error("Scene remote image cache limit reached.");
    const run = (async () => {
      const response = await this.fetchResource(url.href, {
        credentials: "omit",
        signal,
      });
      if (!response.ok)
        throw new Error(
          `Scene image fetch failed (${response.status}): ${url.hostname}`,
        );
      const finalURL = new URL(response.url || url.href);
      if (
        !hosts.includes(finalURL.hostname) ||
        !["http:", "https:"].includes(finalURL.protocol)
      )
        throw new Error("Scene image redirect host is not allowed.");
      const type = response.headers.get("content-type")?.split(";")[0];
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
      const maximum = 8 * 1024 * 1024;
      if (Number(response.headers.get("content-length") ?? 0) > maximum)
        throw new Error("Scene image exceeds 8 MiB.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > maximum)
        throw new Error("Scene image exceeds the accepted byte limits.");
      const path = `assets/solar-${bytesToHex(sha256(bytes))}.${extensions[type]}`;
      this.files[path] = bytes;
      this.imageAssets[value] = path;
      return path;
    })();
    this.remote.set(value, run);
    try {
      return await run;
    } catch (error) {
      this.remote.delete(value);
      throw error;
    }
  }

  private async prepareImageBindings(
    variant: LSMLDocument,
    document: LSMLDocument,
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    const bindings: Record<string, string> = Object.create(null);
    const defaults = variant.defaults ?? {};
    let sequence = 0;
    const visit = async (value: unknown): Promise<void> => {
      if (Array.isArray(value)) {
        for (const child of value) await visit(child);
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
            defaults[alias] = await this.imagePath(
              defaults[path],
              document,
              signal,
            );
          }
          bind!.src = alias;
        } else if (typeof node.src === "string") {
          node.src = await this.imagePath(node.src, document, signal);
        }
      }
      for (const child of Object.values(node)) await visit(child);
    };
    await visit(variant.layout);
    variant.defaults = defaults;
    return bindings;
  }

  async renderPackage(
    document: LSMLDocument,
    signal?: AbortSignal,
  ): Promise<{
    data: Uint8Array;
    sceneVersion: string;
    lsmlDefaults: true;
    textBindings: Record<string, string>;
    imageBindings: Record<string, string>;
    imageAssets: Record<string, string>;
    imageValues: Record<string, unknown>;
    animationBindings: Record<string, string>;
    geometryBindings: string[];
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
    const variant = structuredClone(document);
    // Camera credentials and slot names belong to the host, not Vision's
    // variable grammar. Positional refs such as @0 remain valid slot keys;
    // forwarding __cam.slots.@0 as a render default makes Vision reject LSML.
    variant.defaults = Object.fromEntries(
      Object.entries(variant.defaults ?? {}).filter(
        ([key]) => !key.startsWith("__cam."),
      ),
    );
    const animationBindings = prepareAnimationBindings(variant);
    const geometryBindings = prepareEditableBindings(variant);
    const textBindings = prepareTextBindings(variant);
    const imageBindings = await this.prepareImageBindings(
      variant,
      document,
      signal,
    );
    variant.scene_version = await bundleAddress(variant);
    return {
      data: zipSync(
        { ...this.files, "scene.lsml": strToU8(canonicalize(variant)) },
        { level: 0 },
      ),
      sceneVersion: variant.scene_version,
      lsmlDefaults: true,
      textBindings,
      imageBindings,
      imageAssets: { ...this.imageAssets },
      imageValues: Object.fromEntries(
        Object.entries(imageBindings).map(([path, alias]) => [
          path,
          variant.defaults?.[alias],
        ]),
      ),
      animationBindings,
      geometryBindings,
    };
  }
}
