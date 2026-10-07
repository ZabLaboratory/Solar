// Public surface of @zablab/solar: LSDP, validated ZabCanvas source delivery,
// and the Vision-backed renderer.

export { mount } from "./mount";
export { createCanvasSceneSourceProvider } from "./scenes/canvas";
export { createCachedSceneSourceProvider } from "./scenes/cache";
export {
  BrowserSceneSourceStore,
  sceneCacheNamespace,
} from "./scenes/browser-store";
export {
  createStartupSceneSourceProvider,
  synchronizeSceneSources,
} from "./scenes/startup";
export type { SceneCacheSync } from "./scenes/startup";
export type { SceneSourceStore } from "./scenes/cache";
export type { CanvasSceneSourceOptions } from "./scenes/canvas";
export { SceneSourceError } from "./scenes/types";
export type {
  SceneBlueManifest,
  SceneSourceProvider,
  SceneSourceRequest,
  SceneSourceDelivery,
  SceneSourceErrorCode,
} from "./scenes/types";
export type {
  MountOptions,
  NativeLSDPOptions,
  SolarHandle,
  SolarMode,
  SolarStatus,
  SolarToken,
  SolarTokenProvider,
  SolarError,
  SolarErrorCode,
  ResolveCaptureDevice,
} from "./types";
