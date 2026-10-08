import type { SceneBlueManifest } from "../../src/scenes/types";
export function nativeManifest(
  sceneId: string,
  version: string,
): SceneBlueManifest {
  return {
    schema_version: "zabcanvas.scene-blue-manifest.v1",
    scene_id: sceneId,
    scene_version: version,
    scene_revision: 1,
    revision_id: "unit-source",
    validation: { status: "unit-fixture" },
    declarations: {},
    binding_closure: [],
    readiness: {
      program_ready: false,
      binding_closure_complete: false,
      offline_ready: false,
      missing_binding_ids: [],
      missing_scene_blueprint_keys: [],
    },
    manifest_digest: version,
  };
}
