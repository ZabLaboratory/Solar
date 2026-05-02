import { batch } from "@preact/signals-react";
import type { DeltaMsg } from "../transport/protocol";
import type { Store } from "./store";

/** Apply a delta. All patches in the delta land in a single
 *  signals batch — components reading multiple paths see them flip
 *  in one render pass. */
export function applyDelta(store: Store, msg: DeltaMsg): void {
  batch(() => {
    for (const patch of msg.patches) {
      store.set(patch.path, patch.value, patch.transition);
    }
  });
}
