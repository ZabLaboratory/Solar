// Render bundle — ADR 003 § 3.
//
// The bundle is content-addressed by `scene_version` (sha256 of the
// canonical graph + bundle bytes — see ADR 004 § 7). Solar fetches it
// once per `scene_version` and caches forever ; Orion serves it with
// long-TTL immutable cache headers.

import type { Transition } from "../transport/protocol";

// --- bundle shape ----------------------------------------------------

export type RenderKind =
  | "stack"
  | "grid"
  | "frame"
  | "text"
  | "image"
  | "shape"
  | "media"
  | "repeat";

export interface RenderNode {
  kind: RenderKind;
  /** Stable identifier for keyed reconciliation. Compiler-assigned. */
  id?: string;
  /** Static props (frozen at compile time). */
  props?: Record<string, unknown>;
  /** Prop name → state path. The render layer subscribes the path's
   *  signal and applies the value to the named prop on each change. */
  bindings?: Record<string, string>;
  /** Default transition per bound prop. Overridden by a per-delta
   *  transition on the same path. */
  transitions?: Record<string, Transition>;
  /** Children — already-inlined primitives only (user components are
   *  resolved by Orion's compiler). */
  children?: RenderNode[];
}

export type OperatorInputType =
  | "boolean"
  | "number"
  | "text"
  | "select"
  | "enum"
  | "path-ref"
  | "colour"
  | "duration";

export interface OperatorInput {
  path: string;
  label: string;
  type: OperatorInputType;
  default?: unknown;
  group?: string;
  writable_by?: string[];
  // Type-specific extras (kept open — the editor and compiler are the
  // canonical source of truth ; Solar just renders form controls).
  [extra: string]: unknown;
}

export interface ExternalAdapter {
  key: string;
  label: string;
  kind: string;
  target_paths: string[];
  [extra: string]: unknown;
}

export interface Asset {
  id: string;
  url: string;
  kind: string;
  [extra: string]: unknown;
}

export interface RenderBundle {
  scene_version: string;
  root: RenderNode;
  operator_inputs?: OperatorInput[];
  external_adapters?: ExternalAdapter[];
  assets?: Asset[];
}

// --- fetch + cache ---------------------------------------------------

export interface BundleFetcher {
  /** Fetch the bundle for a scene version. Cached forever by hash. */
  get(sceneId: string, sceneVersion: string): Promise<RenderBundle>;
  /** Inject a bundle directly — used by tests and for the "scene
   *  already in flight" handoff path. */
  preload(bundle: RenderBundle): void;
}

export interface BundleFetcherOptions {
  /** Base URL of Orion's static / API host. The fetcher constructs
   *  `${baseUrl}/orion/api/v1/scenes/{id}/render-bundle?v={hash}`. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

class FetcherImpl implements BundleFetcher {
  private readonly cache = new Map<string, RenderBundle>();
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BundleFetcherOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  preload(bundle: RenderBundle): void {
    this.cache.set(bundle.scene_version, bundle);
  }

  async get(sceneId: string, sceneVersion: string): Promise<RenderBundle> {
    const cached = this.cache.get(sceneVersion);
    if (cached) return cached;
    const url = `${this.baseUrl}/orion/api/v1/scenes/${encodeURIComponent(
      sceneId,
    )}/render-bundle?v=${encodeURIComponent(sceneVersion)}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(
        `bundle fetch failed : ${response.status} ${response.statusText}`,
      );
    }
    const json = (await response.json()) as RenderBundle;
    if (json.scene_version !== sceneVersion) {
      throw new Error(
        `bundle scene_version mismatch : expected ${sceneVersion}, got ${json.scene_version}`,
      );
    }
    this.cache.set(sceneVersion, json);
    return json;
  }
}

export function createBundleFetcher(
  opts: BundleFetcherOptions,
): BundleFetcher {
  return new FetcherImpl(opts);
}
