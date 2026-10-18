import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { canonicalize } from "@lumencast/canonical";
import type {
  NativeCompositionPlan,
  NativeCompositionProjection,
  NativeCompositionSource,
} from "./native-composition-contracts";

function planHash(value: unknown): string {
  const data = new TextEncoder().encode(canonicalize(value));
  return `sha256:${bytesToHex(sha256(data))}`;
}

/** Bind the active document identity to a deterministic, producer-free plan hash. */
export function withNativeCompositionSource(
  projection: NativeCompositionProjection,
  producerId: string,
  source: NativeCompositionSource,
): NativeCompositionPlan {
  if (!producerId || producerId.length > 256)
    throw new Error("NATIVE_COMPOSITION_PRODUCER_ID_INVALID");
  const content = {
    schema:
      projection.coverageSurfaces === undefined
        ? ("solar.native-composition.plan/1" as const)
        : ("solar.native-composition.plan/2" as const),
    coordinateSpace: projection.coordinateSpace,
    atlasSize: structuredClone(projection.atlasSize),
    source: structuredClone(source),
    viewport: structuredClone(projection.viewport),
    groups: structuredClone(projection.groups),
    surfaces: structuredClone(projection.surfaces),
    ...(projection.coverageSurfaces === undefined
      ? {}
      : {
          coverageSurfaces: structuredClone(projection.coverageSurfaces),
        }),
  };
  return {
    ...content,
    producer_id: producerId,
    planHash: planHash(content),
  };
}
