// Wire protocol types — ADR 002. Internal to Solar.
//
// These mirror the JSON shapes Orion writes / reads on the WS.
// We hand-roll validation rather than pull in zod/io-ts ; the surface
// is small enough that a few type guards stay easier to audit than a
// schema library and keep the bundle weight off the broadcast hot path.

export const PROTOCOL_VERSION = 1;

// --- shared atoms -----------------------------------------------------

/** Recognised transition kinds. `none` means instantaneous (no
 *  animation). Solar's animate/ layer maps these to Framer Motion. */
export type TransitionKind = "none" | "tween" | "spring" | "crossfade";

export interface TweenTransition {
  kind: "tween";
  duration_ms: number;
  ease?: "linear" | "cubic-in" | "cubic-out" | "cubic-in-out";
}

export interface SpringTransition {
  kind: "spring";
  stiffness?: number;
  damping?: number;
}

export interface CrossfadeTransition {
  kind: "crossfade";
  duration_ms?: number;
}

export interface NoTransition {
  kind: "none";
}

export type Transition =
  | NoTransition
  | TweenTransition
  | SpringTransition
  | CrossfadeTransition;

/** A patch always targets a single leaf path. Replacement semantics —
 *  no nested operators (ADR 002 § 5 delta). */
export interface Patch {
  path: string;
  value: unknown;
  transition?: Transition;
  /** Optional Action descriptor (chantier Solar action runner).
   *  When present, Solar's action-runner reconstructs dense patches
   *  locally rather than receiving them frame-by-frame. Patches
   *  without `action` follow the existing transitions.ts pipeline
   *  untouched — fully backward compatible. */
  action?: ActionDescriptor;
}

// --- action descriptors (chantier Solar action runner) ---------------

export type ActionKind =
  | "count-up"
  | "curve-path"
  | "text-reveal"
  | "stagger-group"
  | "reorder"
  | "mask-reveal";

/** Easing reference resolved by `animate/easing-resolver.ts` — either
 *  a string id (`"ease-out"`, `"cubic-in-out"`, …) or an inline spring
 *  configuration. */
export type EasingRef =
  | string
  | { stiffness: number; damping: number };

/** A descriptor authored by Prism's Action compiler and consumed by
 *  Solar's action-runner. Inputs are intentionally permissive
 *  (`Record<string, unknown>`) — each runner validates its own params. */
export interface ActionDescriptor {
  kind: ActionKind;
  params: Record<string, unknown>;
  easing?: EasingRef;
  duration_ms?: number;
  stops?: Array<{ at_pct: number; value: unknown; easing?: string }>;
  curve?: {
    anchors: Array<{
      t_pct: number;
      value: number;
      in_tangent?: { dt: number; dv: number };
      out_tangent?: { dt: number; dv: number };
    }>;
    sample_hz: 30 | 60;
  };
  child_selector?: {
    kind: "index" | "all" | "css-selector";
    value: number | string;
  };
}

// --- server → client messages -----------------------------------------

export interface SnapshotMsg {
  type: "snapshot";
  v: number;
  scene_id: string;
  scene_version: string;
  sequence: number;
  state: Record<string, unknown>;
}

export interface DeltaMsg {
  type: "delta";
  v: number;
  scene_id: string;
  sequence: number;
  patches: Patch[];
  cause?: { source: string; input_id?: string };
}

export interface SceneChangedMsg {
  type: "scene_changed";
  v: number;
  from_scene_id: string;
  to_scene_id: string;
  transition?: CrossfadeTransition | TweenTransition;
}

export interface ErrorMsg {
  type: "error";
  v: number;
  code: ServerErrorCode;
  message: string;
  recoverable: boolean;
}

export interface PongMsg {
  type: "pong";
  v: number;
  nonce: string;
}

export type ServerMessage =
  | SnapshotMsg
  | DeltaMsg
  | SceneChangedMsg
  | ErrorMsg
  | PongMsg;

export type ServerErrorCode =
  | "AUTH_DENIED"
  | "SCENE_NOT_FOUND"
  | "VERSION_MISMATCH"
  | "VERSION_GAP"
  | "RATE_LIMIT"
  | "WRITE_FORBIDDEN"
  | "UNKNOWN_PATH"
  | "INVALID_VALUE"
  | "TEST_SESSION_EXPIRED"
  | "INTERNAL";

// --- client → server messages -----------------------------------------

export interface SubscribeMsg {
  type: "subscribe";
  v: number;
  since_sequence: number | null;
}

export interface InputMsg {
  type: "input";
  v: number;
  path: string;
  value: unknown;
  source?: string;
  client_msg_id?: string;
}

export interface UnsubscribeMsg {
  type: "unsubscribe";
  v: number;
}

export interface PingMsg {
  type: "ping";
  v: number;
  nonce: string;
}

export type ClientMessage =
  | SubscribeMsg
  | InputMsg
  | UnsubscribeMsg
  | PingMsg;
