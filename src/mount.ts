// Solar's public mount() — a thin adapter over @lumencast/runtime.
//
// Since ADR 007 (Lumencast convergence, sub-chantier B), Solar no longer
// carries its own render tree, LSDP transport or leaf-grain state. Those
// were duplicates of what `@lumencast/runtime` already ships to spec
// (LSML 1.1 render + LSDP/1.1 wire). Solar's reason to exist is now the
// Zab-facing contract : a stable `mount()` + `SolarError` taxonomy the
// three hosts (Pulsar CEF / Prism webview / editor preview) depend on,
// mapped onto the runtime's `mount()`.
//
// Contract mapping (Solar → runtime) :
//   - `orionUrl`            → `serverUrl`   (Zab keeps the Orion-named field)
//   - `token` (SolarToken)  → `token`       (structurally identical)
//   - `mode`                → `mode`        (same broadcast/control/test union)
//   - `testSession`/`scene` → idem          (only meaningful in test mode)
//   - `onStatus`            → `onStatus`    (identical disconnected/connecting/live)
//   - `onError`             → `onError`     (LumencastError ≡ SolarError ; the
//                                            protocol ErrorCode union is byte-
//                                            equal to SolarErrorCode)
//   - return SolarHandle    ← LumencastHandle ({ disconnect, setToken } same shape)
//
// The runtime owns the lifecycle (subscribe → snapshot → bundle fetch →
// delta → scene_changed → crossfade → token rotation → teardown). Solar
// validates options up-front (host-friendly errors with the `solar.mount:`
// prefix the hosts assert on) and delegates.

import { mount as mountRuntime } from "@lumencast/runtime";
import type {
  LumencastError,
  LumencastStatus,
  MountOptions as RuntimeMountOptions,
} from "@lumencast/runtime";
import { validateOptions } from "./internal/validate-options";
import type { MountOptions, SolarError, SolarHandle, SolarStatus } from "./types";

export function mount(options: MountOptions): SolarHandle {
  // Host-friendly validation with Solar's own message prefix. The runtime
  // validates too, but its messages say "Lumencast" — hosts assert on
  // "solar.mount:".
  validateOptions(options);

  const runtimeOptions: RuntimeMountOptions = {
    target: options.target,
    serverUrl: options.orionUrl,
    token: options.token,
    mode: options.mode,
    ...(options.testSession !== undefined
      ? { testSession: options.testSession }
      : {}),
    ...(options.scene !== undefined ? { scene: options.scene } : {}),
    ...(options.onStatus
      ? { onStatus: (status: LumencastStatus): void => options.onStatus?.(toSolarStatus(status)) }
      : {}),
    ...(options.onError
      ? { onError: (err: LumencastError): void => options.onError?.(toSolarError(err)) }
      : {}),
  };

  const handle = mountRuntime(runtimeOptions);

  return {
    disconnect: () => handle.disconnect(),
    setToken: (token) => handle.setToken(token),
  };
}

// --- contract mapping helpers -----------------------------------------

// The two status unions are identical ("disconnected" | "connecting" |
// "live") ; this keeps the boundary explicit and would fail to compile if
// either side drifted.
function toSolarStatus(status: LumencastStatus): SolarStatus {
  return status;
}

// `LumencastError` and `SolarError` are structurally identical and the
// protocol `ErrorCode` union is byte-equal to `SolarErrorCode`, so the
// forward is lossless. The explicit object construction documents the
// contract boundary and pins it at compile time.
function toSolarError(err: LumencastError): SolarError {
  return {
    code: err.code,
    message: err.message,
    recoverable: err.recoverable,
  };
}
