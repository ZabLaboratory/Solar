// Solar's public mount() — a thin adapter over @lumencast/runtime.
//
// Since ADR 007 (Lumencast convergence, sub-chantier B), Solar no longer
// carries its own render tree, LSDP transport or leaf-grain state. Those
// were duplicates of what `@lumencast/runtime` already ships to spec
// (LSML 1.1 render + LSDP/1.1 wire). Solar's reason to exist is now the
// Zab-facing contract : a stable `mount()` + `SolarError` taxonomy the
// three hosts (Pulsar CEF / Prism webview / editor preview) depend on,
// mapped onto the runtime's `mount()`.
//
// Contract mapping (Solar → runtime) :
//   - `orionUrl`            → `serverUrl`   (Zab keeps the Orion-named field)
//   - `token` (SolarToken)  → `token`       (structurally identical)
//   - `mode`                → `mode`        (same broadcast/control/test union)
//   - `testSession`/`scene` → idem          (only meaningful in test mode)
//   - `onStatus`            → `onStatus`    (identical disconnected/connecting/live)
//   - `onError`             → `onError`     (LumencastError ≡ SolarError ; the
//                                            protocol ErrorCode union is byte-
//                                            equal to SolarErrorCode)
//   - return SolarHandle    ← LumencastHandle ({ disconnect, setToken } same shape)
//
// The runtime owns the lifecycle (subscribe → snapshot → bundle fetch →
// delta → scene_changed → crossfade → token rotation → teardown). Solar
// validates options up-front (host-friendly errors with the `solar.mount:`
// prefix the hosts assert on) and delegates.

import {
  createPeerViewerFromInjection,
  mount as mountRuntime,
  type PeerViewer,
  type PeerViewerInjection,
} from "@lumencast/runtime";
import type {
  LumencastError,
  LumencastStatus,
  MountOptions as RuntimeMountOptions,
} from "@lumencast/runtime";
import { orionBundleUrl } from "./internal/orion-bundle-url";
import { validateOptions } from "./internal/validate-options";
import type {
  MountOptions,
  ResolveCaptureDevice,
  SolarError,
  SolarHandle,
  SolarStatus,
} from "./types";

// Contract with the Prism preview host : the scene-server's bootstrap script
// pins a `deviceRef → deviceId` map on the page before Solar mounts. ACQUIRE
// (the capture-capable webview) reads it to map a bundle's LOGICAL deviceRef
// onto a physical Electron media device. The name is shared verbatim with
// Prism's `injectBootstrap` (scene-server.ts) — change it in BOTH places.
const ZAB_CAPTURE_DEVICES_GLOBAL = "__ZAB_CAPTURE_DEVICES__";

// Default resolver : look the logical deviceRef up in the host-injected map.
// Absent/empty map → null → the runtime calls getUserMedia WITHOUT a deviceId
// constraint (the host's default cam). Solar never calls getUserMedia itself ;
// the runtime owns acquisition.
const captureDeviceResolver: ResolveCaptureDevice = (deviceRef, sourceKind) => {
  const map = (
    globalThis as { [ZAB_CAPTURE_DEVICES_GLOBAL]?: Record<string, string> }
  )[ZAB_CAPTURE_DEVICES_GLOBAL];
  const id = map?.[deviceRef];
  if (id === undefined || id === "") return null;
  // A screen/window id is a desktopCapturer source id (→ chromeMediaSource:
  // desktop), a cam id is a getUserMedia deviceId. The runtime applies each
  // accordingly in `acquireStream`.
  return sourceKind === "media.screen" || sourceKind === "media.window"
    ? { captureSourceId: id }
    : { deviceId: id };
};

// Contract with the Prism return-webview host (ADR 006 #3↔#4 glue) : when the
// page is showing a multi-publisher show, the scene-server pins the room's
// viewer credentials on the page before Solar mounts. Solar then joins the Meet
// room as a VIEWER (no capture) and feeds the runtime's LIVE `media` primitive
// (`meet.peer` node) the peer streams keyed by `peer_label`. Absent → Solar
// mounts exactly as before (no viewer, the `meet.peer` box stays stream-less).
// Shared verbatim with Prism's scene-server injection — change it in BOTH.
const ZAB_PEER_VIEWER_GLOBAL = "__ZAB_PEER_VIEWER__";

/** One room's credentials the scene-server pins so Solar can join it as a
 *  viewer. Mirrors the ZabCam room credentials (#6) ; the token is the
 *  room-level Meet token, NOT an antenne JWT. */
interface PeerViewerRoom {
  signalingUrl: string;
  roomId: string;
  token: string;
}

/** Read the host-injected viewer config (FINAL MODEL : multi-room
 *  `{ rooms: [...] }`). Returns the normalised injection the runtime's
 *  `createPeerViewerFromInjection` consumes, or `null` when no usable room is
 *  present. The legacy single-room shape is still tolerated (back-compat) and
 *  normalised by the runtime. */
function readPeerViewerInjection(): PeerViewerInjection | null {
  const isUsableRoom = (r: unknown): r is PeerViewerRoom =>
    typeof r === "object" &&
    r !== null &&
    typeof (r as PeerViewerRoom).signalingUrl === "string" &&
    typeof (r as PeerViewerRoom).roomId === "string" &&
    typeof (r as PeerViewerRoom).token === "string" &&
    (r as PeerViewerRoom).signalingUrl !== "" &&
    (r as PeerViewerRoom).roomId !== "";

  const cfg = (
    globalThis as {
      [ZAB_PEER_VIEWER_GLOBAL]?: { rooms?: unknown } | PeerViewerRoom;
    }
  )[ZAB_PEER_VIEWER_GLOBAL];
  if (cfg === undefined) return null;

  // Multi-room shape `{ rooms: [...] }` — keep only usable rooms.
  if ("rooms" in cfg && Array.isArray(cfg.rooms)) {
    const rooms = cfg.rooms.filter(isUsableRoom);
    return rooms.length > 0 ? { rooms } : null;
  }
  // Legacy single-room shape — pass through if usable.
  return isUsableRoom(cfg) ? { rooms: [cfg] } : null;
}

export function mount(options: MountOptions): SolarHandle {
  // Host-friendly validation with Solar's own message prefix. The runtime
  // validates too, but its messages say "Lumencast" — hosts assert on
  // "solar.mount:".
  validateOptions(options);

  // ADR 006 #3 — if the host pinned room viewer credentials, join the Meet room
  // as a viewer and bridge its peer streams into the runtime's LIVE `media`
  // primitive. The viewer OWNS the peer connections + track lifecycle ; the
  // primitive is a pure consumer (RC-ReadOnly : it never mutates the scene, and
  // RC-Geo is enforced inside the primitive — the stream fills the node's box).
  const peerViewerInjection = readPeerViewerInjection();
  let peerViewer: PeerViewer | null = null;
  if (peerViewerInjection !== null) {
    // FINAL MODEL — join EVERY pinned room and aggregate the peers into one
    // `peer_label → stream` registry (first-connected-wins). The `meet.peer`
    // renderer resolves a label to its stream regardless of which room it
    // published in. The viewer announce name is set per-room by the runtime
    // (default `solar-viewer`), distinct from any publisher's `peer_label`.
    peerViewer = createPeerViewerFromInjection(peerViewerInjection);
    // Join is async ; a `meet.peer` node that mounts before a peer connects
    // shows a stream-less box and re-renders via `subscribePeerStream` on
    // arrival. A join failure must not take the whole scene down — surface it
    // through `onError` (broadcast hosts log, control/test overlay it) and let
    // the rest of the scene render.
    void peerViewer.join().catch((err: unknown) => {
      options.onError?.({
        code: "INTERNAL",
        message: `peer-viewer join failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        recoverable: true,
      });
    });

    // A webview reload/close doesn't run `disconnect()` (the host owns that),
    // so leave the mesh explicitly on unload: the server then removes the peer
    // immediately (a {type:"leave"} is sent + the socket closes) instead of
    // waiting for the heartbeat / TCP timeout. This is what stops `solar-viewer`
    // ghosts from piling up in a room across reloads.
    window.addEventListener("beforeunload", () => peerViewer?.leave());
  }

  const runtimeOptions: RuntimeMountOptions = {
    target: options.target,
    serverUrl: options.orionUrl,
    token: options.token,
    mode: options.mode,
    // Orion lives behind ZabGate (`/orion/api/v1`) and serves the bundle at
    // `/scenes/{id}/render-bundle?v={hash}`, not the runtime's default
    // host-root LSDP layout. Derive the gateway-prefixed bundle URL from the
    // WS `orionUrl` so the runtime fetches the right artefact (ADR 007 —
    // adapter owns Orion's URL contract).
    resolveBundleUrl: orionBundleUrl(options.orionUrl),
    ...(options.testSession !== undefined
      ? { testSession: options.testSession }
      : {}),
    ...(options.scene !== undefined ? { scene: options.scene } : {}),
    ...(options.onStatus
      ? { onStatus: (status: LumencastStatus): void => options.onStatus?.(toSolarStatus(status)) }
      : {}),
    ...(options.onError
      ? { onError: (err: LumencastError): void => options.onError?.(toSolarError(err)) }
      : {}),
    // ACQUIRE device mapping : a host-supplied resolver wins ; otherwise the
    // default reads the Prism-injected page global. Either way the runtime
    // only uses the result as a live getUserMedia constraint.
    resolveCaptureDevice: options.resolveCaptureDevice ?? captureDeviceResolver,
    // ADR 006 #4 — when a viewer is active, thread its peer-stream resolvers so
    // LIVE `media` nodes render the matching peer's MediaStream in `srcObject`.
    ...(peerViewer !== null
      ? {
          resolvePeerStream: peerViewer.resolvePeerStream,
          subscribePeerStream: peerViewer.subscribePeerStream,
        }
      : {}),
  };

  const handle = mountRuntime(runtimeOptions);

  return {
    disconnect: () => {
      // Tear the viewer down with the scene : leave the room and drop the peer
      // connections (the viewer owns them) so a webview reload doesn't leak a
      // ghost peer into the mesh.
      peerViewer?.leave();
      handle.disconnect();
    },
    setToken: (token) => handle.setToken(token),
  };
}

// --- contract mapping helpers -----------------------------------------

// The two status unions are identical ("disconnected" | "connecting" |
// "live") ; this keeps the boundary explicit and would fail to compile if
// either side drifted.
function toSolarStatus(status: LumencastStatus): SolarStatus {
  return status;
}

// `LumencastError` and `SolarError` are structurally identical and the
// protocol `ErrorCode` union is byte-equal to `SolarErrorCode`, so the
// forward is lossless. The explicit object construction documents the
// contract boundary and pins it at compile time.
function toSolarError(err: LumencastError): SolarError {
  return {
    code: err.code,
    message: err.message,
    recoverable: err.recoverable,
  };
}
