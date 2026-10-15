export const NATIVE_COMPOSITION_ROOT_ID = "prism.native-composition.root.v1";
export const NATIVE_COMPOSITION_AUTHORED_ROOT_ID =
  "solar.native-composition.authored-root.v1";

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
      localSize: { width: number; height: number };
      affine: NativeCompositionAffine;
      localOpacity: number;
      visible: boolean;
      cropPercent: { left: number; top: number; right: number; bottom: number };
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
  coordinateSpace: "scene-root" | "group-local";
  rect: NativeCompositionRect;
  atlasRect: NativeCompositionRect;
  affine: NativeCompositionAffine;
}

export interface NativeCompositionProjection {
  width: number;
  height: number;
  viewport: { width: number; height: number };
  groups: NativeCompositionGroup[];
  surfaces: NativeCompositionSurface[];
  /** Default paths that affect a compositor transform or local surface size. */
  geometryBindings: string[];
  /** Default paths whose value changes require rerendering the atlas pages. */
  rebuildBindings: string[];
}

export interface NativeCompositionSource {
  resource: string;
  selector?: string;
  scene_id: string;
  scene_version: string;
  stateHash: string;
}

export interface NativeCompositionPlan {
  schema: "solar.native-composition.plan/1";
  producer_id: string;
  source: NativeCompositionSource;
  planHash: string;
  viewport: { width: number; height: number };
  groups: NativeCompositionGroup[];
  surfaces: NativeCompositionSurface[];
}
