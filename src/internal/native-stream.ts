import type { Operation } from "fast-json-patch";
import { NativeState } from "./native-state";

export interface NativeChange {
  kind: string;
  sequence: number;
  mutation: {
    format: string;
    id: string;
    target: string;
    beforeHash: string;
    afterHash?: string;
    operations: Operation[];
  };
  receipt: { transactionId: string; target: string; stateHash?: string };
}
export function nativeChange(
  state: NativeState,
  value: NativeChange,
  target: string,
  sequence: number | null,
): NativeState {
  const { mutation, receipt } = value;
  if (
    !["change", "applied_change"].includes(value.kind) ||
    !mutation ||
    mutation.beforeHash !== state.stateHash ||
    mutation.target !== target ||
    receipt?.target !== target ||
    receipt.transactionId !== mutation.id ||
    mutation.format !==
      (value.kind === "applied_change" ? "lsdp.apply/1" : "lsdp.tree/1") ||
    !Number.isSafeInteger(value.sequence) ||
    (sequence !== null && value.sequence <= sequence)
  )
    throw new Error(
      "Invalid native event or resource requires resynchronization.",
    );
  const next = state.patch(mutation.operations);
  if (
    value.kind === "change" &&
    (next.stateHash !== mutation.afterHash ||
      next.stateHash !== receipt.stateHash)
  )
    throw new Error("Native event integrity check failed.");
  return next;
}
export function scalarOperations(operations: Operation[]): boolean {
  return (
    operations.length > 0 &&
    operations.every(
      (op) =>
        op.op === "test" ||
        (["add", "replace"].includes(op.op) &&
          /^\/defaults\/[^/]+$/.test(op.path) &&
          !/^\/defaults\/__(?:cam|animation)\./.test(op.path)),
    )
  );
}
