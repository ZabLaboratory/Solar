import { InstanceSourceError } from "../scenes/instances";
import { requireLSML, type LSMLDocument } from "../scenes/native-document";
import type { MountOptions } from "../types";

export function selectNativeDocument(
  state: unknown,
  selector?: string,
): LSMLDocument | null {
  if (!selector) {
    if (state === null) return null;
    const document = requireLSML(state);
    if (!document["x-solar-transition"]) return document;
    const clean = structuredClone(document);
    delete clean["x-solar-transition"];
    return clean;
  }
  if (!state || typeof state !== "object" || Array.isArray(state))
    throw new Error("Native scene collection required.");
  const value = Object.hasOwn(state, selector)
    ? (state as Record<string, unknown>)[selector]
    : null;
  return value === null ? null : requireLSML(value);
}

export function reportNativeLsdpError(
  onError: MountOptions["onError"],
  error: unknown,
): void {
  onError?.({
    code: error instanceof InstanceSourceError ? error.code : "INTERNAL",
    message: `Native LSDP: ${error instanceof Error ? error.message : String(error)}`,
    recoverable: true,
  });
}

export function measureNativeLsdpStage(
  stage: string,
  start: number,
  sceneId: string | undefined,
  resource: string,
  extra: Record<string, unknown> = {},
): void {
  if (performance.getEntriesByName("solar:native-stage").length >= 64)
    performance.clearMeasures("solar:native-stage");
  performance.measure("solar:native-stage", {
    start,
    detail: { stage, sceneId, resource, ...extra },
  });
}
