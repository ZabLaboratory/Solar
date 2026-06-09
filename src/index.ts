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

// Authored "wipe-cover" overlay element (M10 — Pulsar ADR 003 §A4.2). A
// leaf-driven, in-DOM opaque overlay animation rendered by our engine, NOT
// an OBS-native transition nor the runtime `<Crossfade>`. Canvas/Orion and
// the M10 probe compose a scene with `buildWipeCoverNode(...)`.
export { buildWipeCoverNode, parseWipeCoverOverlay } from "./overlay/wipe-cover";
export type {
  WipeCoverOverlay,
  BuildWipeCoverNodeOptions,
} from "./overlay/wipe-cover";
