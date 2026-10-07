import { NativeLsdpRuntime } from "./engine/native-lsdp-runtime";
import { validateOptions } from "./internal/validate-options";
import type { MountOptions, SolarHandle } from "./types";

/** Mount Solar's single LSDP-to-Vision scene runtime. */
export function mount(options: MountOptions): SolarHandle {
  validateOptions(options);
  const runtime = new NativeLsdpRuntime(options);
  runtime.start();
  return {
    disconnect: () => runtime.disconnect(),
    setToken: (token) => runtime.setToken(token),
  };
}
