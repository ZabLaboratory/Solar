// Public types exported from @zablab/solar.
//
// Stable surface — changes here are breaking changes for Prism, Pulsar
// CEF wrappers, and any future host. Match ADR 003 § 2.
//
// Since ADR 007 (Lumencast convergence), Solar is a thin adapter over
// `@lumencast/runtime` : the rendering, transport (LSDP/1.1) and state
// layers are the runtime's, not Solar's. These types are the Zab-facing
// projection of the runtime's public contract — kept byte-stable so the
// three hosts (Pulsar CEF / Prism webview / editor preview) need no
// change. The field name `orionUrl` is preserved (vs the runtime's
// `serverUrl`) because hosts pass it ; `mount()` maps it across.

export type SolarMode = "broadcast" | "control" | "test";

export type SolarStatus = "disconnected" | "connecting" | "live";

export interface SolarTokenProvider {
  fetch: () => Promise<string>;
}

export type SolarToken = string | SolarTokenProvider;

export interface SolarError {
  code: SolarErrorCode;
  message: string;
  recoverable: boolean;
}

// The LSDP/1.1 closed error taxonomy (LSDP-1.md §3.4) plus the two
// bundle-fetch / capability codes the runtime raises. This is byte-equal
// to `@lumencast/protocol`'s `ErrorCode` union — the adapter forwards a
// `LumencastError` straight through with no lossy mapping.
export type SolarErrorCode =
  | "AUTH_DENIED"
  | "SCENE_NOT_FOUND"
  | "VERSION_MISMATCH"
  | "VERSION_GAP"
  | "RATE_LIMIT"
  | "WRITE_FORBIDDEN"
  | "UNKNOWN_PATH"
  | "INVALID_VALUE"
  | "TEST_SESSION_EXPIRED"
  | "INTERNAL"
  | "BUNDLE_FETCH_FAILED"
  | "BUNDLE_INCOMPATIBLE";

export interface MountOptions {
  target: HTMLElement;
  /** WebSocket URL of the LSDP/1.1 server. In the Zab platform this is
   *  Orion behind ZabGate (`wss://<gate>/orion/api/v1/show/stream.lsdp` for
   *  live, or `.../scenes/{id}/test` for test mode). Maps to the runtime's
   *  `serverUrl`, and is also the source from which `mount()` derives the
   *  gateway-prefixed render-bundle URL (`resolveBundleUrl`). */
  orionUrl: string;
  token: SolarToken;
  mode: SolarMode;
  /** Required when mode === "test" — the test session UUID handed back by
   *  the server's test-session endpoint. Ignored otherwise. */
  testSession?: string;
  /** Required when mode === "test" — the scene id that the test session
   *  cloned. Ignored otherwise. */
  scene?: string;
  onError?: (err: SolarError) => void;
  onStatus?: (status: SolarStatus) => void;
  /** Host resolver for the `x-zab.capture` primitive's ACQUIRE mode (runtime
   *  ADR 004 §A1.3). Given the LOGICAL `(deviceRef, sourceKind)` from the
   *  bundle, return `{ deviceId }` to pin a physical device, or `null` for the
   *  host's default device. Forwarded verbatim to the runtime ; `deviceId`
   *  is only ever a live `getUserMedia` constraint, never enters the bundle
   *  or its content hash. Only consulted on a capture-capable host (the
   *  Electron preview webview) ; ignored on-air (CEF/Pulsar render the
   *  placeholder). */
  resolveCaptureDevice?: ResolveCaptureDevice;
}

/** `(deviceRef, sourceKind) → { deviceId } | null` — see
 *  {@link MountOptions.resolveCaptureDevice}. Structurally identical to the
 *  runtime's `ResolveCaptureDevice` ; re-declared here so the Zab-facing
 *  surface owns its own contract (no runtime type leaks across `mount()`). */
export type ResolveCaptureDevice = (
  deviceRef: string,
  sourceKind: string,
) => { deviceId?: string } | null;

export interface SolarHandle {
  /** Tear down the WS, unmount the React tree, release timers. Idempotent. */
  disconnect: () => void;
  /** Swap the auth token without reconnecting (operator token rotation). */
  setToken: (token: SolarToken) => void;
}
