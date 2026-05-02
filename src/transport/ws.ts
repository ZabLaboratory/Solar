// WS client wiring transport pieces together.
//
// Lifecycle :
//   1. open() — opens the WS using the supplied URL + token
//   2. server replies handshake-style ; we send `subscribe`
//   3. server replies `snapshot` → we emit `onSnapshot`
//   4. subsequent `delta` / `scene_changed` / `error` / `pong`
//      messages are emitted to the host
//   5. on close (clean or not) we reschedule via the backoff
//   6. setToken() closes + reopens with the new token
//   7. close() shuts down for good ; no further reconnect

import type { SolarToken } from "../types";
import {
  CodecError,
  decode,
  encode,
} from "./codec";
import {
  type ClientMessage,
  type DeltaMsg,
  type ErrorMsg,
  type ServerMessage,
  type SnapshotMsg,
  type SceneChangedMsg,
  PROTOCOL_VERSION,
} from "./protocol";
import {
  createReconnectSchedule,
  type ReconnectSchedule,
  type ReconnectScheduleOptions,
} from "./reconnect";
import {
  createSequenceTracker,
  type SequenceTracker,
} from "./sequence";

export type ConnectionStatus = "disconnected" | "connecting" | "live";

export interface WsClientOptions {
  url: string;
  token: SolarToken;
  /** Override WebSocket constructor (for tests / non-browser hosts). */
  webSocketImpl?: typeof WebSocket;
  /** Reconnect tuning (defaults in reconnect.ts). */
  reconnect?: ReconnectScheduleOptions;
  /** Replaces the global setTimeout / clearTimeout for tests. */
  scheduler?: {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
  };

  onStatus?: (status: ConnectionStatus) => void;
  onSnapshot?: (msg: SnapshotMsg) => void;
  onDelta?: (msg: DeltaMsg) => void;
  onSceneChanged?: (msg: SceneChangedMsg) => void;
  onServerError?: (msg: ErrorMsg) => void;
  /** Wire-level / codec / unrecoverable errors. */
  onTransportError?: (err: TransportError) => void;
}

export class TransportError extends Error {
  public readonly recoverable: boolean;
  public override readonly cause?: unknown;
  constructor(message: string, recoverable: boolean, cause?: unknown) {
    super(message);
    this.name = "TransportError";
    this.recoverable = recoverable;
    this.cause = cause;
  }
}

type Timer = ReturnType<typeof setTimeout>;

interface InternalScheduler {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

export class WsClient {
  private status: ConnectionStatus = "disconnected";
  private socket: WebSocket | null = null;
  private token: SolarToken;
  private readonly url: string;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly schedule: ReconnectSchedule;
  private readonly seq: SequenceTracker = createSequenceTracker();
  private readonly opts: WsClientOptions;
  private readonly scheduler: InternalScheduler;

  private reconnectTimer: Timer | null = null;
  private active = true;
  private currentSceneId: string | null = null;

  constructor(opts: WsClientOptions) {
    this.opts = opts;
    this.url = opts.url;
    this.token = opts.token;
    const ctor = opts.webSocketImpl ?? globalThis.WebSocket;
    if (!ctor) {
      throw new TypeError(
        "Solar WsClient : no WebSocket implementation found in this environment",
      );
    }
    this.WebSocketCtor = ctor;
    this.schedule = createReconnectSchedule(opts.reconnect);
    this.scheduler = opts.scheduler ?? {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
  }

  /** Open and start the connection lifecycle. Idempotent. */
  start(): void {
    if (!this.active) return;
    if (this.socket || this.status === "connecting") return;
    void this.openSocket();
  }

  /** Send an input message to the server. No-op if not connected ;
   *  the caller is expected to re-send on reconnect if it matters. */
  sendInput(path: string, value: unknown, clientMsgId?: string): void {
    if (!this.socket || this.socket.readyState !== this.WebSocketCtor.OPEN) {
      return;
    }
    const msg: ClientMessage = {
      type: "input",
      v: PROTOCOL_VERSION,
      path,
      value,
      ...(clientMsgId ? { client_msg_id: clientMsgId } : {}),
    };
    this.socket.send(encode(msg));
  }

  /** Replace the auth token. Closes and reopens so the new token is
   *  carried on the next handshake. */
  setToken(token: SolarToken): void {
    this.token = token;
    if (!this.active) return;
    if (this.socket) {
      this.closeSocket();
      this.scheduleReconnect(/* immediate */ true);
    }
  }

  /** Tear down for good. No more reconnect attempts. */
  close(): void {
    if (!this.active) return;
    this.active = false;
    this.cancelReconnect();
    this.closeSocket();
    this.setStatus("disconnected");
  }

  /** Last known sequence — used for resume on reconnect. */
  get lastSequence(): number {
    return this.seq.last;
  }

  /** Current scene id from the most recent snapshot, if any. */
  get sceneId(): string | null {
    return this.currentSceneId;
  }

  // --- internals --------------------------------------------------

  private async openSocket(): Promise<void> {
    if (!this.active) return;
    this.setStatus("connecting");

    let resolvedToken: string;
    try {
      resolvedToken = await resolveToken(this.token);
    } catch (err) {
      this.opts.onTransportError?.(
        new TransportError(
          `failed to resolve token : ${(err as Error).message}`,
          true,
          err,
        ),
      );
      this.scheduleReconnect();
      return;
    }
    if (!this.active) return;

    const url = appendTokenIfNeeded(this.url, resolvedToken);
    let socket: WebSocket;
    try {
      socket = new this.WebSocketCtor(url);
    } catch (err) {
      this.opts.onTransportError?.(
        new TransportError(
          `failed to open WebSocket : ${(err as Error).message}`,
          true,
          err,
        ),
      );
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = (event) => this.handleMessage(event);
    socket.onerror = (event) => this.handleError(event);
    socket.onclose = (event) => this.handleClose(event);
  }

  private handleOpen(): void {
    if (!this.socket) return;
    const since =
      this.seq.last >= 0 ? this.seq.last : null;
    const subscribe: ClientMessage = {
      type: "subscribe",
      v: PROTOCOL_VERSION,
      since_sequence: since,
    };
    this.socket.send(encode(subscribe));
  }

  private handleMessage(event: MessageEvent): void {
    const data = typeof event.data === "string" ? event.data : "";
    if (!data) return;
    let msg: ServerMessage;
    try {
      msg = decode(data);
    } catch (err) {
      const detail =
        err instanceof CodecError ? err.message : (err as Error).message;
      this.opts.onTransportError?.(
        new TransportError(`codec : ${detail}`, true, err),
      );
      this.closeSocket();
      this.scheduleReconnect();
      return;
    }

    switch (msg.type) {
      case "snapshot":
        this.seq.reset(msg.sequence);
        this.currentSceneId = msg.scene_id;
        this.schedule.reset();
        this.setStatus("live");
        this.opts.onSnapshot?.(msg);
        return;
      case "delta": {
        const observation = this.seq.observe(msg.sequence);
        if (observation.kind === "gap") {
          this.opts.onTransportError?.(
            new TransportError(
              `sequence gap : expected ${observation.expected}, got ${observation.got}`,
              true,
            ),
          );
          this.closeSocket();
          this.scheduleReconnect();
          return;
        }
        this.opts.onDelta?.(msg);
        return;
      }
      case "scene_changed":
        // The next snapshot reseeds the sequence — we do not advance
        // the tracker here.
        this.opts.onSceneChanged?.(msg);
        return;
      case "error":
        this.opts.onServerError?.(msg);
        if (!msg.recoverable) {
          this.close();
        }
        return;
      case "pong":
        // ignored by Solar — we don't currently send pings
        return;
    }
  }

  private handleError(_event: Event): void {
    // The browser does not give us a real reason on `error` — `close`
    // will follow with a code we surface to the host.
  }

  private handleClose(event: CloseEvent): void {
    this.socket = null;
    if (!this.active) {
      this.setStatus("disconnected");
      return;
    }
    if (event.code === 4401 || event.code === 4403) {
      // Auth-related close codes : not recoverable without operator
      // intervention.
      this.opts.onTransportError?.(
        new TransportError(`server closed : ${event.code} ${event.reason}`, false),
      );
      this.close();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(immediate = false): void {
    if (!this.active) return;
    this.cancelReconnect();
    const attempt = (this.schedule.attempt || 0) + 1;
    const delay = immediate ? 0 : this.schedule.delayFor(attempt);
    this.setStatus("disconnected");
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      this.scheduler.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    if (this.socket) {
      try {
        this.socket.close(1000, "client closing");
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.opts.onStatus?.(next);
  }
}

async function resolveToken(token: SolarToken): Promise<string> {
  if (typeof token === "string") return token;
  return await token.fetch();
}

function appendTokenIfNeeded(url: string, token: string): string {
  // Pulsar CEF browser sources cannot set Authorization headers ;
  // ZabGate accepts `?token=` on /orion/api/v1/show/stream only.
  // For the operator (Prism) flow, the JWT travels via headers — but
  // browser WebSocket APIs don't let userland set an Authorization
  // header either, so the show-token-in-URL form is also how Prism
  // hands its operator token over. ZabGate is responsible for
  // rejecting non-viewer tokens via query string outside the
  // show-stream endpoint.
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
