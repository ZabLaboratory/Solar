// PrismScene — public JS class that lets any web host embed a Solar
// scene without going through React, Pulsar, or Electron. Three
// consumers share this surface :
//
//   1. Prism preview (webview)
//   2. Pulsar CEF broadcast (browser source)
//   3. Arbitrary site embed (the host page imports `@zablab/solar`
//      and calls `new PrismScene(...)`)
//
// The class owns three things and only three :
//
//   - A `Store` (one signal per leaf path) — the same store the live
//     `mount()` API uses.
//   - A React render tree mounted into the host's `target` element,
//     plus a data-binder for hosts that author static HTML and bind
//     via `data-anim-path` markers.
//   - An optional Orion WS connection for live triggers, attached on
//     `connectToOrion()` and torn down on `disconnectFromOrion()`.
//
// Animation playback dispatches each patch through the action-runner
// when `patch.action` is present, otherwise straight to the store.
// Concurrent plays of the same `assetId` are forbidden — the second
// call rejects with an "already-playing" error. Stopping aborts the
// in-flight run and resolves it without firing `animation:completed`.

import type { Patch } from "../transport/protocol";
import { createStore, type Store } from "../state/store";
import { runAction, UnknownActionKindError } from "../animate/action-runner";
import { bindScene, type SceneBinder } from "./binder";
import { renderScene, type SceneRoot } from "./mount";

export type PrismSceneEvent =
  | "animation:start"
  | "animation:completed"
  | "animation:error";

export interface AnimationDef {
  /** Patches replayed in order. Each one is dispatched through the
   *  action-runner when it carries an `action` descriptor, otherwise
   *  written straight to the store. */
  patches: Patch[];
  duration_ms?: number;
}

export interface SceneJson {
  scene_id?: string;
  scene_version?: string;
  /** Initial state for every leaf path the scene reads. */
  state?: Record<string, unknown>;
  /** Static HTML rendered into the mount target (optional). Hosts
   *  that prefer to author their own DOM should leave this empty and
   *  populate `target` themselves before calling `mount()`. */
  html?: string;
  /** Named animations playable via `playAnimation(id, …)`. */
  animations?: Record<string, AnimationDef>;
}

export interface PrismSceneOptions {
  sceneJson: SceneJson;
  /** When true, no Orion WS connection is established even if
   *  `connectToOrion()` is later called. Useful for offline previews
   *  in CI. Default false. */
  mockMode?: boolean;
}

export type AnimationHandler = (payload: AnimationEventPayload) => void;

export interface AnimationEventPayload {
  asset_id: string;
  params?: Record<string, unknown>;
  error?: unknown;
}

export interface OrionConnectOptions {
  url: string;
  token: string;
}

const ALREADY_PLAYING_CODE = "ALREADY_PLAYING";

export class PrismScene {
  private sceneJson: SceneJson;
  private readonly mockMode: boolean;
  private readonly store: Store;
  private root: SceneRoot | null = null;
  private binder: SceneBinder | null = null;
  private target: HTMLElement | null = null;
  private orionSocket: WebSocket | null = null;
  private readonly handlers = new Map<PrismSceneEvent, Set<AnimationHandler>>();
  private readonly active = new Map<string, AbortController>();

  constructor(opts: PrismSceneOptions) {
    if (!opts || !opts.sceneJson) {
      throw new TypeError("PrismScene: `sceneJson` is required");
    }
    this.sceneJson = opts.sceneJson;
    this.mockMode = opts.mockMode ?? false;
    this.store = createStore();
    if (this.sceneJson.state) this.store.reset(this.sceneJson.state);
  }

  mount(target: HTMLElement): void {
    if (!target || typeof target.appendChild !== "function") {
      throw new TypeError("PrismScene.mount: `target` must be an HTMLElement");
    }
    if (this.root) {
      throw new Error("PrismScene: already mounted; call unmount() first");
    }
    this.target = target;
    if (typeof this.sceneJson.html === "string") {
      target.innerHTML = this.sceneJson.html;
    }
    this.root = renderScene(target, this.store);
    this.binder = bindScene(target, this.store);
  }

  unmount(): void {
    for (const ctrl of this.active.values()) ctrl.abort();
    this.active.clear();
    this.binder?.dispose();
    this.binder = null;
    this.root?.dispose();
    this.root = null;
    this.target = null;
    this.disconnectFromOrion();
  }

  async playAnimation(
    assetId: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const anim = this.sceneJson.animations?.[assetId];
    if (!anim) {
      const error = new Error(
        `PrismScene: animation '${assetId}' not found in sceneJson.animations`,
      );
      this.emit("animation:error", { asset_id: assetId, params, error });
      throw error;
    }
    if (this.active.has(assetId)) {
      const error = new Error(
        `PrismScene: animation '${assetId}' is already playing`,
      );
      (error as { code?: string }).code = ALREADY_PLAYING_CODE;
      this.emit("animation:error", { asset_id: assetId, params, error });
      throw error;
    }

    const controller = new AbortController();
    this.active.set(assetId, controller);
    this.emit("animation:start", { asset_id: assetId, params });

    try {
      for (const rawPatch of anim.patches) {
        if (controller.signal.aborted) break;
        const patch = applyParams(rawPatch, params);
        if (patch.action) {
          await runAction({
            store: this.store,
            patch,
            root: this.target,
            signal: controller.signal,
          });
        } else {
          this.store.set(patch.path, patch.value, patch.transition);
        }
      }
      if (!controller.signal.aborted) {
        this.emit("animation:completed", { asset_id: assetId, params });
      }
    } catch (error) {
      this.emit("animation:error", { asset_id: assetId, params, error });
      if (error instanceof UnknownActionKindError) throw error;
      throw error;
    } finally {
      this.active.delete(assetId);
    }
  }

  stopAnimation(assetId: string): void {
    const ctrl = this.active.get(assetId);
    if (!ctrl) return;
    ctrl.abort();
    this.active.delete(assetId);
  }

  on(event: PrismSceneEvent, handler: AnimationHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: PrismSceneEvent, handler: AnimationHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  connectToOrion(opts: OrionConnectOptions): void {
    if (this.mockMode) return;
    if (typeof WebSocket === "undefined") {
      throw new Error(
        "PrismScene.connectToOrion: WebSocket is not available in this runtime",
      );
    }
    if (!opts?.url || !opts.token) {
      throw new TypeError(
        "PrismScene.connectToOrion: `url` and `token` are required",
      );
    }
    this.disconnectFromOrion();
    const ws = new WebSocket(opts.url);
    this.orionSocket = ws;
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          v: 1,
          since_sequence: null,
          token: opts.token,
        }),
      );
    });
    ws.addEventListener("message", (ev: MessageEvent) => {
      this.onOrionMessage(ev.data);
    });
  }

  disconnectFromOrion(): void {
    if (!this.orionSocket) return;
    try {
      this.orionSocket.close();
    } catch {
      /* noop */
    }
    this.orionSocket = null;
  }

  setScene(sceneJson: SceneJson): void {
    this.sceneJson = sceneJson;
    if (sceneJson.state) this.store.reset(sceneJson.state);
    if (this.target && typeof sceneJson.html === "string") {
      this.target.innerHTML = sceneJson.html;
      // Re-bind against the new DOM.
      this.binder?.dispose();
      this.binder = bindScene(this.target, this.store);
    }
  }

  // --- introspection (test-only / debug) ----------------------------

  /** @internal */
  _getStoreSnapshot(): Record<string, unknown> {
    return this.store.toRecord();
  }

  // --- private ------------------------------------------------------

  private emit(event: PrismSceneEvent, payload: AnimationEventPayload): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        h(payload);
      } catch {
        /* swallow handler errors — never break the playback loop */
      }
    }
  }

  private onOrionMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const m = msg as { type?: string; patches?: Patch[]; state?: Record<string, unknown> };
    if (m.type === "snapshot" && m.state) {
      this.store.reset(m.state);
    } else if (m.type === "delta" && Array.isArray(m.patches)) {
      for (const patch of m.patches) {
        if (patch.action) {
          void runAction({
            store: this.store,
            patch,
            root: this.target,
          });
        } else {
          this.store.set(patch.path, patch.value, patch.transition);
        }
      }
    }
  }
}

/** Interpolate `${param.foo}` placeholders inside the patch value/path
 *  with the supplied params, and merge a `${param.foo}` reference in
 *  `action.params` if present. Keeps the data-flow obvious without
 *  pulling a templating dependency. */
function applyParams(
  patch: Patch,
  params: Record<string, unknown> | undefined,
): Patch {
  if (!params) return patch;
  return {
    ...patch,
    path: substituteString(patch.path, params),
    value: substituteValue(patch.value, params),
    action: patch.action
      ? {
          ...patch.action,
          params: substituteRecord(patch.action.params, params),
        }
      : undefined,
  };
}

function substituteValue(
  v: unknown,
  params: Record<string, unknown>,
): unknown {
  if (typeof v === "string") return substituteString(v, params);
  if (Array.isArray(v)) return v.map((x) => substituteValue(x, params));
  if (v && typeof v === "object") {
    return substituteRecord(v as Record<string, unknown>, params);
  }
  return v;
}

function substituteRecord(
  rec: Record<string, unknown>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = substituteValue(v, params);
  }
  return out;
}

const PARAM_TOKEN = /\$\{param\.([a-zA-Z0-9_]+)\}/g;

function substituteString(
  s: string,
  params: Record<string, unknown>,
): string {
  if (!s.includes("${param.")) return s;
  // If the entire string is a single token, return the raw param so
  // numbers and objects round-trip without being stringified.
  const single = s.match(/^\$\{param\.([a-zA-Z0-9_]+)\}$/);
  if (single) {
    const key = single[1]!;
    if (key in params) {
      const v = params[key];
      return v as unknown as string;
    }
    return s;
  }
  return s.replace(PARAM_TOKEN, (_m, key: string) => {
    return key in params ? String(params[key]) : `\${param.${key}}`;
  });
}
