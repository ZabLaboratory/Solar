// Public surface of @zablab/solar.

export { mount } from "./mount";
export type {
  MountOptions,
  SolarHandle,
  SolarMode,
  SolarStatus,
  SolarToken,
  SolarTokenProvider,
  SolarError,
  SolarErrorCode,
} from "./types";

// --- chantier Solar action runner ------------------------------------

export { PrismScene } from "./scene/prism-scene";
export type {
  PrismSceneOptions,
  PrismSceneEvent,
  SceneJson,
  AnimationDef,
  AnimationEventPayload,
  AnimationHandler,
  OrionConnectOptions,
} from "./scene/prism-scene";

export type {
  Patch,
  Transition,
  TweenTransition,
  SpringTransition,
  CrossfadeTransition,
  NoTransition,
  ActionDescriptor,
  ActionKind,
  EasingRef,
} from "./transport/protocol";

// Action-runner pieces — exported for hosts that want to build on
// the same primitives (Prism preview, custom integrations).
export {
  runAction,
  hasAction,
  registerActionRunner,
  UnknownActionKindError,
} from "./animate/action-runner";
export type {
  ActionContext,
  ActionRunner,
} from "./animate/action-runner";

// FLIP — single source of truth shared with Prism preview.
export { captureFlip, playFlip, withFlip } from "./animate/flip";
export type { FlipSnapshot, FlipPlayOptions } from "./animate/flip";
