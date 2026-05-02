// Top-level React component for a mounted Solar instance. Reads the
// runtime signals (bundle / status) and dispatches to the right mode.
//
// Per-mode code splitting : the BroadcastMode / ControlMode / TestMode
// components live in separate chunks loaded only when the
// corresponding mode is requested. A broadcast-mode mount never
// downloads the overlay or test code — the broadcast chunk is the
// bare minimum Pulsar CEF needs to render the scene. This realises
// the "tree-shakable overlay" guarantee from chantier-solar.md
// criterion 6 (a.k.a. 5b in the working summary) at the bundle-stat
// level, not just at the runtime level.
//
// Crossfade-correctness note : AnimatePresence freezes the props of
// an exiting child so its render tree keeps using the values it held
// at the moment it started exiting. We embed `SolarRuntimeProvider`
// inside the motion.div so the exiting view keeps its OLD bundle
// while AnimatePresence animates it out.

import { useSignals } from "@preact/signals-react/runtime";
import type { Signal } from "@preact/signals-react";
import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense } from "react";
import type { Store } from "./state/store";
import type { RenderBundle } from "./render/bundle";
import type { ConnectionStatus } from "./transport/ws";
import { SolarRuntimeProvider } from "./overlay/runtime-context";
import type { SolarMode } from "./types";

const LazyBroadcastMode = lazy(() =>
  import("./modes/broadcast").then((m) => ({ default: m.BroadcastMode })),
);
const LazyControlMode = lazy(() =>
  import("./modes/control").then((m) => ({ default: m.ControlMode })),
);
const LazyTestMode = lazy(() =>
  import("./modes/test").then((m) => ({ default: m.TestMode })),
);

export interface SolarAppProps {
  mode: SolarMode;
  store: Store;
  bundleSignal: Signal<RenderBundle | null>;
  statusSignal: Signal<ConnectionStatus>;
  crossfadeKeySignal: Signal<string>;
  sendInput: (path: string, value: unknown, clientMsgId?: string) => void;
}

export function SolarApp({
  mode,
  store,
  bundleSignal,
  statusSignal,
  crossfadeKeySignal,
  sendInput,
}: SolarAppProps) {
  useSignals();

  const bundle = bundleSignal.value;
  const status = statusSignal.value;
  const trackKey = crossfadeKeySignal.value;
  if (!bundle) return null;

  const ModeComponent =
    mode === "broadcast"
      ? LazyBroadcastMode
      : mode === "control"
        ? LazyControlMode
        : LazyTestMode;

  return (
    <AnimatePresence mode="sync">
      <motion.div
        key={trackKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        style={{ position: "absolute", inset: 0 }}
      >
        <SolarRuntimeProvider
          value={{
            mode,
            store,
            bundle,
            status,
            sendInput,
          }}
        >
          <Suspense fallback={null}>
            <ModeComponent />
          </Suspense>
        </SolarRuntimeProvider>
      </motion.div>
    </AnimatePresence>
  );
}
