import type { VerifiedFont } from "../scenes/verified-font";
import type {
  SceneSourceProvider,
  SceneImageAssetsProvider,
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
  | "BUNDLE_FETCH_FAILED"
  | "INSTANCE_CYCLE"
  | "INSTANCE_RESOURCE_LIMIT"
  | "INSTANCE_SOURCE_INVALID"
  | "VISION_INIT_FAILED"
  | "VISION_PATCH_FAILED"
  | "NATIVE_COMPOSITION_FAILED"
  | "SOUND_FAILED"
  | "CAMERA_CAPTURE_FAILED";

export interface SolarError {
  code: SolarErrorCode;
  message: string;
  recoverable: boolean;
}

export interface MountOptions {
  /** Trusted physical compositor viewport; capture pixels remain host-owned. */
  nativeComposition?: { width: number; height: number };
  /** Optional derived-plan channel, valid only for a physical A/B lane host. */
  nativeCompositionLSDP?: NativeCompositionLSDPOptions;
  /** Trusted host-supplied font bytes; source identity and assets stay pinned. */
  fontAssetsProvider?: (
    signal: AbortSignal,
  ) => Promise<Array<Uint8Array | VerifiedFont>>;
  installationFonts?: () => AsyncIterable<Uint8Array[]>;
  /** Optional trusted local image authority; LSML's original host allowlist still applies. */
  sceneImageAssetsProvider?: SceneImageAssetsProvider;
  target: HTMLElement;
  /** Native Lumencast LSDP resource containing the complete LSML document. */
  nativeLSDP: NativeLSDPOptions;
  /** Fetches exact published LSML/LSMLZ revisions from ZabCanvas. */
  sceneSourceProvider: SceneSourceProvider;
  token: SolarToken;
  mode: SolarMode;
  onError?: (error: SolarError) => void;
  onStatus?: (status: SolarStatus) => void;
  /** Unmute receive-only peer audio in the on-air/recording page mix. */
  liveAudio?: boolean;
  /** Enable LSML scene sound. Control hosts remain silent unless explicitly enabled. */
  sceneAudio?: boolean;
  /** Maps validated local LSML device references to host-owned capture IDs. */
  resolveCaptureDevice?: ResolveCaptureDevice;
}

export interface NativeLSDPOptions {
  url: string;
  resource: string;
  /** Exact entry of a native generation/session collection, never a role fallback. */
  selector?: string;
}

export interface NativeCompositionLSDPOptions {
  url: string;
  resource: "solar/composition";
  /** Physical lane slot, not a Preview/Program role. */
  graph: "A" | "B";
  /** Main-assigned nonce claimed in `producers[graph]` before this host publishes. */
  producer_id: string;
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
  audio?: {
    resume: () => Promise<void>;
    stream: () => MediaStream | null;
    status: () => import("../engine/sound/controller").SoundStatus;
    render: (animationId: string) => Promise<AudioBuffer>;
  };
}
