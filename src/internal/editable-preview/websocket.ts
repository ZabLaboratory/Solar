import { applyEditableFastPatch } from "./dom";
import { EditablePreviewDeltaGate } from "./delta-gate";

/**
 * Preview-only WebSocket adapter. It does not invent state: it applies only a
 * sequence-valid `__editable.*.translate` patch received on the real LSDP
 * Preview wire, directly to the matching Solar compositor wrapper. Program
 * never opts into this adapter.
 */
export function createEditablePreviewWebSocket(
  NativeWebSocket: typeof WebSocket = globalThis.WebSocket,
  root: ParentNode = document,
): typeof WebSocket {
  class EditablePreviewWebSocket extends NativeWebSocket {
    private readonly editableGate = new EditablePreviewDeltaGate();

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      super.addEventListener("message", (event) => {
        for (const patch of this.editableGate.accept(event.data)) {
          applyEditableFastPatch(patch, root);
        }
      });
    }
  }
  return EditablePreviewWebSocket as unknown as typeof WebSocket;
}
