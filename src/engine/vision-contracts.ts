import type { VerifiedFont } from "../scenes/verified-font";

/** Host/presenter wire messages and scene ownership handles. Implementations remain in vision-presenter. */
export interface VisionLiveMediaSource {
  path: string;
  type: "capture" | "peer";
  source_kind?: string;
  device_ref?: string;
  slot_ref?: string;
  fit?: "cover" | "contain" | "fill" | string;
  /** Authored LSML image bounds before Vision caps the upload texture. */
  size?: { w: number; h: number };
  contentBox?: { x?: number; y?: number; width?: number; height?: number };
  sourceCrop?: { left?: number; top?: number; right?: number; bottom?: number };
  sourceZoom?: number;
  objectPosition?: { x?: number; y?: number };
  width: number;
  height: number;
}

export interface VisionPresenterMessage {
  type: string;
  seq?: number;
  message?: string;
  phase?: string;
  timing?: Record<string, unknown>;
  mediaSources?: VisionLiveMediaSource[];
}

export interface VisionMediaSubmitReceipt {
  /** True when the presenter returned frame-submitted for this frame queue batch. */
  frameSubmitted: boolean;
  /** Reported elapsed time around engine.render(); never GPU completion time. */
  renderSubmitCallMs: number | null;
}

export interface VisionSceneHandle {
  readonly sceneId: string;
  readonly sceneVersion: string;
  readonly mediaSources: readonly VisionLiveMediaSource[];
  applyPatch(patch: Record<string, unknown>): Promise<void>;
  canApplyPatch?(patch: Record<string, unknown>): boolean;
  resize(width: number, height: number): Promise<void>;
  activate(): void;
  deactivate?(): void;
  updateMedia(
    frames: Array<{ path: string; bitmap: ImageBitmap }>,
    onSubmission?: (receipt: VisionMediaSubmitReceipt) => void,
  ): Promise<void>;
  clearMedia(paths: string[]): Promise<void>;
  dispose(): void;
  /** Drain queued GPU work, including teardown after disposal. */
  flush?(): Promise<void>;
}

export interface VisionRenderPackage {
  data: Uint8Array;
  /** Exact, verified dependencies of the active source, admitted by Rust. */
  instances?: Array<{
    sceneId: string;
    sceneVersion: string;
    packageBytes: Uint8Array;
    assets?: Array<{ path: string; bytes: Uint8Array }>;
  }>;
  assets?: Array<{ path: string; bytes: Uint8Array }>;
  sceneVersion: string;
  /** Native defaults include LSML-owned __lit bindings. Camera control stays separate. */
  lsmlDefaults?: boolean;
  textBindings?: Record<string, string>;
  imageBindings?: Record<string, string>;
  imageAssets?: Record<string, string>;
  imageValues?: Record<string, unknown>;
  animationBindings?: Record<string, string>;
  geometryBindings?: Record<string, [string, string]>;
  hostFonts?: Array<Uint8Array | VerifiedFont>;
  requiredFontDigests?: readonly string[];
  surface?: { width: number; height: number };
  installationFonts?: () => AsyncIterable<Uint8Array[]>;
  resolveImages?: (patch: Record<string, unknown>) => Promise<{
    values: Record<string, unknown>;
    assets: Array<{ path: string; bytes: Uint8Array }>;
    /** Release Solar's staging pins after the frame queue accepts or rejects the patch. */
    release?: () => void;
  }>;
}
