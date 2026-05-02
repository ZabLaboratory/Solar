import { createContext, useContext, type ReactNode } from "react";
import type { Store } from "../state/store";
import type { RenderBundle } from "../render/bundle";
import type { ConnectionStatus } from "../transport/ws";
import type { SolarMode } from "../types";

export interface SolarRuntime {
  mode: SolarMode;
  store: Store;
  bundle: RenderBundle;
  status: ConnectionStatus;
  sendInput: (path: string, value: unknown, clientMsgId?: string) => void;
}

const Ctx = createContext<SolarRuntime | null>(null);

export function SolarRuntimeProvider({
  value,
  children,
}: {
  value: SolarRuntime;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSolarRuntime(): SolarRuntime {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "Solar overlay components must be rendered inside SolarRuntimeProvider",
    );
  }
  return v;
}
