import type { SolarSceneRosterEntry } from "../types";

/** Read the host's immutable artifact hint, never scene state or Blue instances. */
export function previewRenderRoster(
  value: unknown,
  preview: boolean,
): SolarSceneRosterEntry[] {
  if (!preview || !Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const { scene_id, scene_version } = entry as Record<string, unknown>;
    return typeof scene_id === "string" &&
      scene_id.length > 0 &&
      typeof scene_version === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(scene_version)
      ? [{ scene_id, scene_version }]
      : [];
  });
}
