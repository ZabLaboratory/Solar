export const NATIVE_COMPOSITION_ROOT_ID = "prism.native-composition.root.v1";

export interface NativeCompositionAffine {
  m00: number;
  m01: number;
  tx: number;
  m10: number;
  m11: number;
  ty: number;
}

export interface NativeCompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type NativeCompositionChild =
  | { kind: "solarBand"; band: number }
  | {
      kind: "capture";
      componentId: string;
      sourceComponentId: string;
      localSize: { width: number; height: number };
      affine: NativeCompositionAffine;
      localOpacity: number;
      visible: boolean;
      /** /2 appearance is applied once to this occurrence in native composition. */
      blendMode?: string;
      mask?: { surface: number } | null;
      cropPercent: { left: number; top: number; right: number; bottom: number };
      sourceFraming: {
        fit: string | null;
        contentBox: {
          x: number | null;
          y: number | null;
          width: number | null;
          height: number | null;
        } | null;
        sourceZoom: number | null;
        objectPosition: { x: number | null; y: number | null } | null;
        authoredSize: [number | null, number | null];
        sourceSize: [number, number];
      };
    }
  | { kind: "group"; id: string };

export interface NativeCompositionGroup {
  id: string;
  parentId: string | null;
  order: number;
  opacity: number;
  visible: boolean;
  blendMode: string;
  bounds: NativeCompositionRect;
  affine: NativeCompositionAffine;
  children: NativeCompositionChild[];
  mask: Record<string, unknown> | null;
}

export interface NativeCompositionSurface {
  band: number;
  ownerId: string;
  ownerPath: string[];
  coordinateSpace: "scene-root" | "group-local" | "global-scene-texels";
  rect: NativeCompositionRect;
  atlasRect: NativeCompositionRect;
  affine: NativeCompositionAffine;
}

export interface NativeCompositionCoverageSurface {
  targetId: string;
  coordinateSpace: "global-scene-texels";
  rect: NativeCompositionRect;
  atlasRect: NativeCompositionRect;
}

export interface NativeCompositionProjection {
  coordinateSpace: "global-scene-texels";
  /** Actual CEF canvas size, including atlas gutters or a transparent 1px canvas. */
  atlasSize: { width: number; height: number };
  width: number;
  height: number;
  viewport: { width: number; height: number };
  groups: NativeCompositionGroup[];
  surfaces: NativeCompositionSurface[];
  /** Present only for /2, including an empty list for blend-only plans. */
  coverageSurfaces?: NativeCompositionCoverageSurface[];
}

export interface NativeCompositionSource {
  resource: string;
  selector?: string;
  scene_id: string;
  scene_version: string;
  stateHash: string;
}

export interface NativeCompositionPlan {
  schema: "solar.native-composition.plan/1" | "solar.native-composition.plan/2";
  coordinateSpace: "global-scene-texels";
  atlasSize: { width: number; height: number };
  producer_id: string;
  source: NativeCompositionSource;
  planHash: string;
  viewport: { width: number; height: number };
  groups: NativeCompositionGroup[];
  surfaces: NativeCompositionSurface[];
  /** Present only for /2, including an empty list for blend-only plans. */
  coverageSurfaces?: NativeCompositionCoverageSurface[];
}
