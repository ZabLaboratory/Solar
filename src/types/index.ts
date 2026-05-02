// Public types exported from @zablab/solar.
// Stable surface — changes here are breaking changes for Prism, Pulsar
// CEF wrappers, and any future host. Match ADR 003 § 2.

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

// Subset of ADR 002 § 5 error codes that surface up to the host plus
// Solar-internal failure modes (bundle fetch, schema mismatch).
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
  /** wss://<gate>/orion/api/v1/show/stream (live) or
   *  wss://<gate>/orion/api/v1/scenes/{id}/test (test). */
  orionUrl: string;
  token: SolarToken;
  mode: SolarMode;
  /** Required when mode === "test" — the test session UUID handed back by
   *  Orion's `POST /show/test-sessions`. Ignored otherwise. */
  testSession?: string;
  /** Required when mode === "test" — the scene id that the test session
   *  cloned. Ignored otherwise. */
  scene?: string;
  onError?: (err: SolarError) => void;
  onStatus?: (status: SolarStatus) => void;
}

export interface SolarHandle {
  /** Tear down the WS, unmount the React tree, release timers. Idempotent. */
  disconnect: () => void;
  /** Swap the auth token without reconnecting (operator token rotation). */
  setToken: (token: SolarToken) => void;
}
