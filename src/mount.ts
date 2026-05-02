import { signal } from "@preact/signals-react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { MountOptions, SolarHandle, SolarError, SolarToken } from "./types";
import { createStore } from "./state/store";
import { applySnapshot } from "./state/apply-snapshot";
import { applyDelta } from "./state/apply-delta";
import {
  createBundleFetcher,
  type BundleFetcher,
  type RenderBundle,
} from "./render/bundle";
import { TransportError, WsClient, type ConnectionStatus } from "./transport/ws";
import { SolarApp } from "./app";
import { validateOptions } from "./internal/validate-options";

/**
 * Mount Solar against an Orion WS endpoint and render the active scene
 * (or a test session's scene) into `target`.
 *
 * Lifecycle :
 *   1. Open the WS, send subscribe (handled by WsClient).
 *   2. On snapshot : fetch render bundle by `scene_version`, seed
 *      store, render React tree.
 *   3. On delta : apply patches to store ; bound signals update,
 *      bound primitives re-render.
 *   4. On scene_changed : fetch new bundle, swap tree (the Crossfade
 *      wrapper fades old → new based on `crossfadeKey` change).
 *   5. setToken() rotates the WS auth without re-mounting React.
 *   6. disconnect() tears down the WS, unmounts the React root.
 */
export function mount(options: MountOptions): SolarHandle {
  validateOptions(options);
  options.onStatus?.("disconnected");

  const store = createStore();
  const baseUrl = deriveBaseUrl(options.orionUrl);
  const bundleFetcher = createBundleFetcher({ baseUrl });

  const bundleSignal = signal<RenderBundle | null>(null);
  const statusSignal = signal<ConnectionStatus>("disconnected");
  const crossfadeKeySignal = signal<string>("__initial__");

  // Forward status to the host without dropping the operator-overlay
  // signal-driven updates.
  const setStatus = (status: ConnectionStatus): void => {
    statusSignal.value = status;
    options.onStatus?.(status);
  };

  // Plumb the host's onError through to a typed SolarError.
  const reportError = (err: SolarError): void => {
    options.onError?.(err);
  };

  let active = true;

  const ws = new WsClient({
    url: options.orionUrl,
    token: options.token,
    onStatus: setStatus,
    onSnapshot: (msg) => {
      if (!active) return;
      void onSnapshot(
        bundleFetcher,
        store,
        bundleSignal,
        crossfadeKeySignal,
        msg.scene_id,
        msg.scene_version,
        () => {
          applySnapshot(store, msg);
        },
        reportError,
      );
    },
    onDelta: (msg) => {
      if (!active) return;
      applyDelta(store, msg);
    },
    onSceneChanged: (_msg) => {
      if (!active) return;
      // The fresh snapshot that follows will carry the new
      // scene_version, drive the bundle fetch, and flip the
      // crossfade key. We don't act eagerly here — the snapshot is
      // always the source of truth (ADR 002 § 11). Server-declared
      // transition duration is honoured by Crossfade's default for
      // v1 ; per-event duration override lands in a follow-up.
    },
    onServerError: (msg) => {
      reportError({
        code: msg.code,
        message: msg.message,
        recoverable: msg.recoverable,
      });
    },
    onTransportError: (err) => {
      reportError(transportToSolarError(err));
    },
  });

  void (async function bootstrap() {
    if (options.mode === "test") {
      // Test sessions are scene-scoped — their WS URL already
      // identifies the scene, so the server's first snapshot fixes
      // the active scene.
    }
    ws.start();
  })();

  // React root.
  const root: Root = createRoot(options.target);
  root.render(
    createElement(SolarApp, {
      mode: options.mode,
      store,
      bundleSignal,
      statusSignal,
      crossfadeKeySignal,
      sendInput: (path, value, clientMsgId) =>
        ws.sendInput(path, value, clientMsgId),
    }),
  );

  return {
    disconnect() {
      if (!active) return;
      active = false;
      ws.close();
      root.unmount();
    },
    setToken(token: SolarToken) {
      if (!active) return;
      ws.setToken(token);
    },
  };

  // --- helpers (closures over outer scope) ----------------------

  async function onSnapshot(
    fetcher: BundleFetcher,
    _store: typeof store,
    bSignal: typeof bundleSignal,
    cSignal: typeof crossfadeKeySignal,
    sceneId: string,
    sceneVersion: string,
    applyState: () => void,
    onErr: (err: SolarError) => void,
  ): Promise<void> {
    let bundle: RenderBundle;
    try {
      bundle = await fetcher.get(sceneId, sceneVersion);
    } catch (err) {
      onErr({
        code: "BUNDLE_FETCH_FAILED",
        message:
          err instanceof Error ? err.message : "render bundle fetch failed",
        recoverable: true,
      });
      return;
    }
    if (!active) return;
    applyState();
    bSignal.value = bundle;
    // Trigger the crossfade : a fresh key drives AnimatePresence to
    // mount the new tree with an opacity tween.
    cSignal.value = `${sceneId}::${sceneVersion}`;
  }
}

// --- error mapping --------------------------------------------

function transportToSolarError(err: TransportError): SolarError {
  // The transport reports its own typed reason ; we map a few well-
  // known cases to dedicated Solar codes and fall back to INTERNAL.
  return {
    code: "INTERNAL",
    message: err.message,
    recoverable: err.recoverable,
  };
}

// --- URL helpers ----------------------------------------------

function deriveBaseUrl(wsUrl: string): string {
  // wss://<host>/orion/api/v1/show/stream → https://<host>
  // ws://<host>/orion/api/v1/show/stream  → http://<host>
  try {
    const u = new URL(wsUrl);
    const httpScheme = u.protocol === "wss:" ? "https:" : "http:";
    return `${httpScheme}//${u.host}`;
  } catch {
    return "";
  }
}
