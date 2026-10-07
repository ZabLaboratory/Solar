import type {
  SceneSourceProvider,
  LocalSceneSourceProvider,
} from "../scenes/types";

export type SolarMode = "broadcast" | "control" | "test";
export type SolarStatus = "disconnected" | "connecting" | "live";

export interface SolarTokenProvider {
  fetch: () => Promise<string>;
}

export type SolarToken = string | SolarTokenProvider;

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
  | "SOURCE_REQUEST_FAILED"
  | "SOURCE_DESCRIPTOR_INVALID"
  | "SOURCE_RESOURCE_LIMIT"
  | "SOURCE_INTEGRITY_FAILED"
  | "VISION_INIT_FAILED"
  | "VISION_PATCH_FAILED"
  | "CAMERA_CAPTURE_FAILED";

export interface SolarError {
  code: SolarErrorCode;
  message: string;
  recoverable: boolean;
}

export interface MountOptions {
  /** Trusted native compositor viewport; local capture pixels remain host-owned. */
  nativeComposition?: { width: number; height: number };
  /** Trusted host-supplied font bytes; source identity and assets stay pinned. */
  fontAssetsProvider?: (signal: AbortSignal) => Promise<Uint8Array[]>;
  target: HTMLElement;
  /** Native Lumencast LSDP resource containing the complete LSML document. */
  nativeLSDP: NativeLSDPOptions;
  /** Fetches exact published LSML/LSMLZ revisions from ZabCanvas. */
  sceneSourceProvider: SceneSourceProvider;
  /** Trusted local authoring only; never saved in the published/offline cache. */
  localSceneSourceProvider?: LocalSceneSourceProvider;
  token: SolarToken;
  mode: SolarMode;
  onError?: (error: SolarError) => void;
  onStatus?: (status: SolarStatus) => void;
  /** Unmute receive-only peer audio in the on-air/recording page mix. */
  liveAudio?: boolean;
  /** Maps validated local LSML device references to host-owned capture IDs. */
  resolveCaptureDevice?: ResolveCaptureDevice;
}

export interface NativeLSDPOptions {
  url: string;
  resource: string;
  /** Exact entry of a native generation/session collection, never a role fallback. */
  selector?: string;
}

export type ResolveCaptureDevice = (
  deviceRef: string,
  sourceKind: string,
) =>
  | { deviceId?: string; captureSourceId?: string }
  | null
  | Promise<{ deviceId?: string; captureSourceId?: string } | null>;

export interface SolarHandle {
  disconnect: () => void;
  setToken: (token: SolarToken) => void;
}
