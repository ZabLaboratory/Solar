import { describe, expect, it } from "vitest";
import { NativeState } from "../../src/internal/native-state";
import {
  nativeChange,
  scalarOperations,
  type NativeChange,
} from "../../src/internal/native-stream";

describe("worker native LSML integrity", () => {
  const state = NativeState.from({ defaults: { counter: 0 } });
  const operations = [
    { op: "replace" as const, path: "/defaults/counter", value: 1 },
  ];
  const after = state.patch(operations);
  const event = (): NativeChange => ({
    kind: "change",
    sequence: 1,
    mutation: {
      format: "lsdp.tree/1",
      id: "mutation",
      target: "scene",
      beforeHash: state.stateHash,
      afterHash: after.stateHash,
      operations,
    },
    receipt: {
      transactionId: "mutation",
      target: "scene",
      stateHash: after.stateHash,
    },
  });
  it("accepts only the correct ordered before/after state and receipt identity", () => {
    expect(nativeChange(state, event(), "scene", null).stateHash).toBe(
      after.stateHash,
    );
    const wrongHash = event();
    wrongHash.receipt.stateHash = state.stateHash;
    expect(() => nativeChange(state, wrongHash, "scene", null)).toThrow(
      "integrity",
    );
    const wrongIdentity = event();
    wrongIdentity.receipt.transactionId = "other";
    expect(() => nativeChange(state, wrongIdentity, "scene", null)).toThrow(
      "Invalid",
    );
    expect(() => nativeChange(state, event(), "scene", 1)).toThrow("Invalid");
    expect(() => nativeChange(after, event(), "scene", null)).toThrow(
      "Invalid",
    );
    expect(state.value).toEqual({ defaults: { counter: 0 } });
  });
  it("recognizes application events while preserving before-state and operation checks", () => {
    const application = event();
    application.kind = "applied_change";
    application.mutation.format = "lsdp.apply/1";
    delete application.mutation.afterHash;
    delete application.receipt.stateHash;
    expect(nativeChange(state, application, "scene", null).stateHash).toBe(
      after.stateHash,
    );
    application.mutation.operations.push({
      op: "test",
      path: "/defaults/counter",
      value: 7,
    });
    expect(() => nativeChange(state, application, "scene", null)).toThrow();
    expect(state.value).toEqual({ defaults: { counter: 0 } });
  });
  it("keeps camera, animation, structural and removal effects outside scalar batching", () => {
    expect(scalarOperations(operations)).toBe(true);
    for (const path of [
      "/defaults/__cam.slot",
      "/defaults/__animation.target",
      "/layout/children",
      "/defaults/nested/x",
    ])
      expect(scalarOperations([{ op: "replace", path, value: 1 }])).toBe(false);
    expect(
      scalarOperations([{ op: "remove", path: "/defaults/counter" }]),
    ).toBe(false);
  });
});
