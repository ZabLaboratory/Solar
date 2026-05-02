import { Tree } from "../render/tree";
import { useSolarRuntime } from "../overlay/runtime-context";

/** Broadcast mode : pure scene render, no UI chrome. */
export function BroadcastMode() {
  const { store, bundle } = useSolarRuntime();
  return <Tree node={bundle.root} store={store} />;
}
