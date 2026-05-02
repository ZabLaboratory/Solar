import type { SnapshotMsg } from "../transport/protocol";
import type { Store } from "./store";

/** Apply a snapshot to the store. Replaces the entire state — paths
 *  not present in the snapshot are reset to `undefined`. */
export function applySnapshot(store: Store, msg: SnapshotMsg): void {
  store.reset(msg.state);
}
