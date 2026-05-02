// Mock Orion server for tests. Speaks ADR 002 over WS and serves
// render bundles over HTTP. Designed to be embedded by Vitest tests
// (programmatic start / stop) and by Playwright E2E (started in a
// global setup hook).
//
// Behaviour parity with real Orion is intentional :
//  - Same envelope (`type`, `v`, ...).
//  - Same sequence semantics (snapshot reseeds, deltas increment).
//  - Same scene_changed flow (scene_changed → fresh snapshot).
//  - Same backpressure rule isn't simulated (mock is single-client).
//
// What it doesn't do : auth, real scene compilation, polling
// adapters. Tests inject scenes as `RenderBundle` objects directly.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../../src/transport/protocol";
import type { RenderBundle } from "../../src/render/bundle";
import type { Patch, Transition } from "../../src/transport/protocol";

export interface MockOrionConfig {
  /** Listening port (0 = random). */
  port?: number;
  /** Initial scene id served when a client subscribes. */
  initialSceneId: string;
  /** Bundle for the initial scene. */
  initialBundle: RenderBundle;
  /** Initial state (paths → values). */
  initialState: Record<string, unknown>;
}

export interface MockOrion {
  readonly url: string;
  readonly httpUrl: string;
  /** Add (or replace) a bundle by scene_version — served via HTTP. */
  registerBundle(bundle: RenderBundle): void;
  /** Inject a delta to all subscribers of the active scene. */
  pushDelta(patches: Patch[], opts?: { transition?: Transition }): void;
  /** Switch the active scene. Emits scene_changed + snapshot. */
  switchScene(args: {
    sceneId: string;
    bundle: RenderBundle;
    state: Record<string, unknown>;
    transition?: { kind: "crossfade"; duration_ms?: number };
  }): void;
  /** Close every connection and stop listening. */
  close(): Promise<void>;
}

interface SubscriberState {
  ws: WebSocket;
  sceneId: string;
  sequence: number;
}

export async function startMockOrion(
  config: MockOrionConfig,
): Promise<MockOrion> {
  const initialSceneId = config.initialSceneId;
  const initialBundle = config.initialBundle;
  const initialState = config.initialState;
  let activeSceneId = initialSceneId;
  let activeBundle = initialBundle;
  let activeState: Record<string, unknown> = { ...initialState };
  const bundles = new Map<string, RenderBundle>();
  bundles.set(initialBundle.scene_version, initialBundle);

  const subscribers = new Set<SubscriberState>();

  const httpServer: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      // CORS — production Orion needs the same for Pulsar CEF and
      // Prism webview cross-origin fetches.
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET, OPTIONS");
      res.setHeader("access-control-allow-headers", "*");
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = req.url ?? "/";
      // GET /orion/api/v1/scenes/{id}/render-bundle?v={hash}
      const match = url.match(
        /^\/orion\/api\/v1\/scenes\/([^/?]+)\/render-bundle(?:\?v=([^&]+))?$/,
      );
      if (req.method === "GET" && match) {
        const versionParam = match[2] ? decodeURIComponent(match[2]) : undefined;
        const bundle = versionParam
          ? bundles.get(versionParam)
          : activeBundle;
        if (!bundle) {
          res.statusCode = 404;
          res.end("bundle not found");
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "public, max-age=31536000, immutable");
        res.end(JSON.stringify(bundle));
        return;
      }
      // GET /orion/api/v1/health
      if (req.method === "GET" && url === "/orion/api/v1/health") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      // --- mock-only control plane (used by Playwright e2e) -------
      if (req.method === "POST" && url === "/__mock/delta") {
        readJson(req)
          .then((body) => {
            const patches = (body as { patches: Patch[] }).patches;
            pushDelta(patches);
            res.statusCode = 204;
            res.end();
          })
          .catch((err) => {
            res.statusCode = 400;
            res.end(String(err));
          });
        return;
      }
      if (req.method === "POST" && url === "/__mock/scene-changed") {
        readJson(req)
          .then((body) => {
            const args = body as {
              sceneId: string;
              bundle: RenderBundle;
              state: Record<string, unknown>;
              transition?: { kind: "crossfade"; duration_ms?: number };
            };
            switchScene(args);
            res.statusCode = 204;
            res.end();
          })
          .catch((err) => {
            res.statusCode = 400;
            res.end(String(err));
          });
        return;
      }
      if (req.method === "POST" && url === "/__mock/register-bundle") {
        readJson(req)
          .then((body) => {
            registerBundle(body as RenderBundle);
            res.statusCode = 204;
            res.end();
          })
          .catch((err) => {
            res.statusCode = 400;
            res.end(String(err));
          });
        return;
      }
      if (req.method === "POST" && url === "/__mock/reset") {
        // Reset to the initial scene + state. Used by Playwright
        // beforeEach hooks so each test sees a clean slate.
        activeSceneId = initialSceneId;
        activeBundle = initialBundle;
        activeState = { ...initialState };
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    },
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("mock-orion : failed to bind HTTP server");
  }
  const port = address.port;

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket, req) => {
    const url = req.url ?? "";
    // Real Orion has two WS endpoints (live and test). The mock
    // accepts both — the test session URL even has a session= query
    // param that we don't validate here.
    const isLive = url.startsWith("/orion/api/v1/show/stream");
    const isTest = url.startsWith("/orion/api/v1/scenes/");
    if (!isLive && !isTest) {
      socket.close(1008, "unknown ws path");
      return;
    }
    const sub: SubscriberState = {
      ws: socket,
      sceneId: activeSceneId,
      sequence: 0,
    };
    subscribers.add(sub);

    socket.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as { type: unknown }).type !== "subscribe"
      ) {
        return;
      }
      const sequence = nextSequence();
      sub.sequence = sequence;
      sub.sceneId = activeSceneId;
      sendJson(socket, {
        type: "snapshot",
        v: PROTOCOL_VERSION,
        scene_id: activeSceneId,
        scene_version: activeBundle.scene_version,
        sequence,
        state: activeState,
      });
    });

    socket.on("close", () => {
      subscribers.delete(sub);
    });
  });

  let monotonic = 0;
  function nextSequence(): number {
    monotonic += 1;
    return monotonic;
  }

  function registerBundle(bundle: RenderBundle): void {
    bundles.set(bundle.scene_version, bundle);
  }

  function pushDelta(patches: Patch[]): void {
    for (const sub of subscribers) {
      if (sub.sceneId !== activeSceneId) continue;
      const sequence = nextSequence();
      sub.sequence = sequence;
      sendJson(sub.ws, {
        type: "delta",
        v: PROTOCOL_VERSION,
        scene_id: activeSceneId,
        sequence,
        patches,
      });
    }
    // Mirror patches into our state mirror so the next snapshot is
    // consistent — done once even with no subscribers, so a delta
    // pushed before the first connect is reflected.
    for (const p of patches) {
      activeState[p.path] = p.value;
    }
  }

  function switchScene(args: {
    sceneId: string;
    bundle: RenderBundle;
    state: Record<string, unknown>;
    transition?: { kind: "crossfade"; duration_ms?: number };
  }): void {
    activeSceneId = args.sceneId;
    activeBundle = args.bundle;
    activeState = { ...args.state };
    bundles.set(args.bundle.scene_version, args.bundle);
    for (const sub of subscribers) {
      sendJson(sub.ws, {
        type: "scene_changed",
        v: PROTOCOL_VERSION,
        from_scene_id: sub.sceneId,
        to_scene_id: args.sceneId,
        ...(args.transition ? { transition: args.transition } : {}),
      });
      const sequence = nextSequence();
      sub.sequence = sequence;
      sub.sceneId = args.sceneId;
      sendJson(sub.ws, {
        type: "snapshot",
        v: PROTOCOL_VERSION,
        scene_id: args.sceneId,
        scene_version: args.bundle.scene_version,
        sequence,
        state: activeState,
      });
    }
  }

  async function close(): Promise<void> {
    for (const sub of subscribers) {
      try {
        sub.ws.close(1000, "shutdown");
      } catch {
        // ignore
      }
    }
    subscribers.clear();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  const instance: MockOrion = {
    url: `ws://127.0.0.1:${port}/orion/api/v1/show/stream`,
    httpUrl: `http://127.0.0.1:${port}`,
    registerBundle,
    pushDelta,
    switchScene,
    close,
  };
  return instance;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (body.length === 0) return {};
  return JSON.parse(body);
}
