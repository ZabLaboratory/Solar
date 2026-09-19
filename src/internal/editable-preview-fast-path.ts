// Stable entry point for editable Preview rendering. Implementations are grouped
// by responsibility; the existing imports and exported contracts stay unchanged.
export type {
  EditableTranslatePatch,
  EditableScalarPatch,
  EditableFastPatch,
} from "./editable-preview/patch";
export {
  parseEditableTranslatePatch,
  parseEditableFastPatch,
} from "./editable-preview/patch";
export { EditablePreviewDeltaGate } from "./editable-preview/delta-gate";
export {
  applyEditableTranslatePatch,
  applyEditableFastPatch,
} from "./editable-preview/dom";
export {
  editablePreviewFastPathEnabled,
  readEditablePreviewSidebandUrl,
  parseAcceptedEditablePatches,
  installEditablePreviewSideband,
} from "./editable-preview/sideband";
export { createEditablePreviewWebSocket } from "./editable-preview/websocket";
