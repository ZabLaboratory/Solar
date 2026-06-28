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
} from "@lumencast/runtime";
import type {
  LumencastError,
  LumencastStatus,
  MountOptions as RuntimeMountOptions,
} from "@lumencast/runtime";
import { orionBundleUrl } from "./internal/orion-bundle-url";
import { readPeerViewerInjection } from "./peer-viewer/injection";
import { createSlotBindingRegistry } from "./peer-viewer/slot-binding";
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

// One host-injected entry: a PORTABLE label + the picker-origin deviceId (NOT
// reusable here) for cams, or an origin-independent captureSourceId for screens.
interface ZabCaptureEntry {
  label?: string;
  deviceId?: string;
  captureSourceId?: string;
  kind?: string;
}

// Per-origin label → deviceId, resolved ONCE and shared across capture nodes.
// getUserMedia deviceIds are salted per origin/partition, so the picker-origin
// id is useless in this webview; the LABEL is the portable key. enumerateDevices
// only exposes labels after a getUserMedia grant in THIS origin, so we warm one
// up first (auto-granted in the preview webview), best-effort.
let originLabelMapPromise: Promise<Record<string, string>> | null = null;
function originLabelMap(): Promise<Record<string, string>> {
  if (originLabelMapPromise !== null) return originLabelMapPromise;
  originLabelMapPromise = (async () => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (md?.enumerateDevices === undefined) return {};
    try {
      if (md.getUserMedia !== undefined) {
        const warm = await md.getUserMedia({ video: true });
        for (const t of warm.getTracks()) t.stop();
      }
    } catch {
      /* permission denied → labels stay blank, resolve to {} (PLACEHOLDER) */
    }
    const out: Record<string, string> = {};
    try {
      for (const d of await md.enumerateDevices()) {
        if (d.label.length > 0) out[d.label] = d.deviceId;
      }
    } catch {
      /* best-effort */
    }
    return out;
  })();
  return originLabelMapPromise;
}

// Default resolver (ADR 004 §A1.3, async per 2026-06-27 amendment). A declared
// deviceRef with no resolvable device → `null` → PLACEHOLDER (the runtime no
// longer falls back to the host default cam). The runtime AWAITS this, so there
// is no race against a late global mutation.
const captureDeviceResolver: ResolveCaptureDevice = async (
  deviceRef,
  sourceKind,
) => {
  const map = (
    globalThis as {
      [ZAB_CAPTURE_DEVICES_GLOBAL]?: Record<string, ZabCaptureEntry>;
    }
  )[ZAB_CAPTURE_DEVICES_GLOBAL];
  const entry = map?.[deviceRef];
  if (entry === undefined) {
    return null;
  }
  // Screen/window: a desktopCapturer source id is origin-independent → verbatim.
  if (sourceKind === "media.screen" || sourceKind === "media.window") {
    return entry.captureSourceId !== undefined && entry.captureSourceId !== ""
      ? { captureSourceId: entry.captureSourceId }
      : null;
  }
  // Cam/mic: re-resolve the PORTABLE label against this origin's devices. No
  // label / no match → null → PLACEHOLDER, never the wrong default cam.
  if (entry.label === undefined || entry.label === "") {
    return null;
  }
  const byLabel = await originLabelMap();
  const local = byLabel[entry.label];
  return local !== undefined ? { deviceId: local } : null;
};

// The peer-viewer injection sources (preview `__ZAB_PEER_VIEWER__` + antenne
// LSDP `__ZAB_LSDP_PEER_VIEWER__`) and the slotRef re-keying registry live in
// `./peer-viewer/*` (ADR Blue 009 §3.2–3.3). `mount()` reads both sources, joins
// every pinned room as a VIEWER (no capture), and feeds the runtime the peer
// streams keyed by `peer_label`. On the antenne, slot→peer assignments re-key
// `x-zab.meet-peer` nodes by `slotRef` ; on the preview path nothing changes.

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
  const { injection: peerViewerInjection, slotBindings, fromLsdp } =
    readPeerViewerInjection();
  let peerViewer: PeerViewer | null = null;
  // Peer-stream resolvers threaded into the runtime. On the antenne (LSDP creds
  // effectively present) they are the slotRef-aware view that re-keys
  // `x-zab.meet-peer` nodes through the `__cam.slots.*` assignments ; on the
  // preview-only path they are the viewer's raw `peer_label` resolvers, BYTE-
  // IDENTICAL to the prior wiring (ADR Blue 009 §3.2 — gated by cred presence).
  let resolvePeerStream: PeerViewer["resolvePeerStream"] | undefined;
  let subscribePeerStream: PeerViewer["subscribePeerStream"] | undefined;
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

    if (fromLsdp) {
      // ANTENNE — slotRef re-keying (ADR Blue 009 §3.1–3.3). `x-zab.meet-peer`
      // nodes carry only a `slotRef` ; the slot→peer binding lives in the LSDP
      // `__cam.slots.*` deltas. The slot-aware registry maps slotRef→peer_label→
      // stream over the viewer's raw `peer_label` registry, re-keying a slot
      // instantly on reassignment. A bare `peer_label` (legacy `meet.peer`) key
      // passes straight through, so this is a strict superset.
      //
      // ⚠️ Chaining debt : the active render only flows once the vendored
      // Lumencast runtime renders `x-zab.meet-peer` and feeds these resolvers a
      // `slotRef` key (and surfaces the `__cam.slots.*` deltas via `assign()`).
      // The v0.9.0 runtime does neither, and `fromLsdp` is false until Orion #261
      // pins LSDP viewer creds — so this path is INERT today (preview unchanged).
      const slots = createSlotBindingRegistry(peerViewer.registry, slotBindings);
      resolvePeerStream = slots.resolve;
      subscribePeerStream = slots.subscribe;
    } else {
      // PREVIEW — raw `peer_label` resolvers, byte-identical to the prior wiring.
      resolvePeerStream = peerViewer.resolvePeerStream;
      subscribePeerStream = peerViewer.subscribePeerStream;
    }
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
    // On the antenne these are slotRef-aware (ADR Blue 009 §3.3).
    ...(resolvePeerStream !== undefined && subscribePeerStream !== undefined
      ? { resolvePeerStream, subscribePeerStream }
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
