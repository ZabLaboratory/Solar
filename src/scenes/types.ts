/** Engine-independent acquisition boundary, shared by online and verified cached providers. */
export interface SceneSourceProvider {
  get(
    sceneId: string,
    options?: SceneSourceRequest,
  ): Promise<SceneSourceDelivery>;
}

export interface SceneSourceRequest {
  format?: "lsml" | "lsmlz";
  /** Exact LSDP scene_version advertised by the snapshot. */
  sceneVersion?: string;
  signal?: AbortSignal;
}

/** Read-only preparation metadata for reusing a validated scene offline. */
export interface SceneBlueManifest {
  schema_version: "zabcanvas.scene-blue-manifest.v1";
  scene_id: string;
  scene_revision: number;
  revision_id: string;
  scene_version: string;
  validation: Record<string, unknown>;
  declarations: Record<string, unknown>;
  binding_closure: readonly Record<string, unknown>[];
  readiness: {
    program_ready: boolean;
    binding_closure_complete: boolean;
    offline_ready: boolean;
    missing_binding_ids: readonly string[];
    missing_scene_blueprint_keys: readonly string[];
  };
  manifest_digest: string;
}

export interface SceneSourceDelivery {
  /** Canvas identifier used to request this scene. */
  sceneId: string;
  revision: number;
  sceneVersion: string;
  /** Digest of exact LSML bytes, including scene_version (not the LSML address). */
  sourceDigest: string;
  format: "lsml" | "lsmlz";
  data: Uint8Array;
  /** Plain LSML's local assets; LSMLZ contains them in data instead. */
  assets: ReadonlyMap<string, Uint8Array>;
  /** Validation-pinned declarations and Blue binding closure for local reuse. */
  blueManifest: SceneBlueManifest;
}

export type SceneSourceErrorCode =
  | "SOURCE_REQUEST_FAILED"
  | "SOURCE_DESCRIPTOR_INVALID"
  | "SOURCE_RESOURCE_LIMIT"
  | "SOURCE_INTEGRITY_FAILED";

export class SceneSourceError extends Error {
  constructor(public readonly code: SceneSourceErrorCode) {
    super(code);
    this.name = "SceneSourceError";
  }
}
