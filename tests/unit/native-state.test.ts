import { describe, expect, it, vi } from "vitest";
import { NativeState } from "../../src/internal/native-state";
import {
  nativeTreeHash,
  NativeTreeHasher,
} from "../../src/internal/native-tree";
import rawVectors from "../../vendor/lsdp-native-browser/tree-vectors.json?raw";

const vectors = JSON.parse(rawVectors) as Array<{
  name: string;
  value: unknown;
  hash: string;
}>;

describe("immutable native state and incremental integrity", () => {
  it("reuses snapshot digests without trusting altered or nonportable input", () => {
    const hasher = new NativeTreeHasher();
    const snapshot = {
      layout: {
        nodes: Array.from({ length: 100 }, (_, id) => ({
          id,
          text: "snapshot",
        })),
      },
      defaults: { title: "old" },
    };
    const first = NativeState.from(snapshot, hasher);
    const second = NativeState.from(structuredClone(snapshot), hasher);
    expect(second.stateHash).toBe(first.stateHash);
    snapshot.layout.nodes[0]!.text = "new";
    const changed = NativeState.from(snapshot, hasher);
    expect(changed.stateHash).toBe(nativeTreeHash(snapshot));
    expect(changed.stateHash).not.toBe(first.stateHash);
    expect(() =>
      NativeState.from({ ...snapshot, invalid: 9007199254740992 }, hasher),
    ).toThrow();
    expect(first.value).not.toEqual(snapshot);
  });
  it.each(vectors)(
    "retains the normative hash for $name",
    ({ value, hash }) => {
      expect(NativeState.from(value).stateHash).toBe(hash);
    },
  );

  it("matches fresh normative hashing for 512 ordered leaf mutations", () => {
    let state = NativeState.from({
      defaults: { counter: 0 },
      layout: { children: [{ text: "fixed" }] },
    });
    const original = state;
    for (let index = 1; index <= 512; index++) {
      state = state.patch([
        { op: "replace", path: "/defaults/counter", value: index },
      ]);
      expect(state.stateHash).toBe(nativeTreeHash(state.value));
      expect(
        (state.value as typeof original.value & { layout: unknown }).layout,
      ).toBe((original.value as { layout: unknown }).layout);
    }
    expect(original.value).toMatchObject({ defaults: { counter: 0 } });
  });

  it("handles arrays, escaped keys, changing object treaps and root replacement", () => {
    const start = NativeState.from({
      "a/b~c": [1, 2],
      keep: { untouched: true },
    });
    const operations = [
      { op: "add" as const, path: "/a~1b~0c/1", value: { nested: [3] } },
      { op: "replace" as const, path: "/a~1b~0c/1/nested/0", value: 4 },
      { op: "remove" as const, path: "/a~1b~0c/0" },
      { op: "add" as const, path: "/added", value: "new" },
      { op: "remove" as const, path: "/keep" },
    ];
    let state = start;
    for (const operation of operations) {
      state = state.patch([operation]);
      expect(state.stateHash).toBe(nativeTreeHash(state.value));
    }
    expect(state.value).toEqual({
      "a/b~c": [{ nested: [4] }, 2],
      added: "new",
    });
    state = state.patch([{ op: "replace", path: "", value: [1, 2] }]);
    expect(state.stateHash).toBe(nativeTreeHash([1, 2]));
    state = state.patch([{ op: "remove", path: "" }]);
    expect(state.value).toBeNull();
    expect(state.stateHash).toBe(nativeTreeHash(null));
  });

  it("keeps normative integrity across copied LSML, changed leaves and subtree cache eviction", () => {
    const source = {
      defaults: { count: 0 },
      layout: {
        children: Array.from({ length: 80 }, (_, id) => ({
          id,
          text: "fixed content",
          size: { w: 300, h: 60 },
        })),
      },
    };
    let state = NativeState.from(source);
    for (let index = 0; index < 40; index++) {
      const copied = structuredClone(source);
      copied.defaults.count = index;
      copied.layout.children[index % 80]!.text = "variant " + index;
      state = state.patch([{ op: "replace", path: "", value: copied }]);
      expect(state.stateHash).toBe(nativeTreeHash(copied));
      state = state.patch([
        { op: "replace", path: "/defaults/count", value: index + 1 },
      ]);
      expect(state.stateHash).toBe(
        nativeTreeHash(structuredClone(state.value)),
      );
    }
    state = state.patch([{ op: "replace", path: "", value: source }]);
    state = state.patch([
      { op: "replace", path: "", value: structuredClone(source) },
    ]);
    state = state.patch([
      { op: "replace", path: "/layout/children/0/size/w", value: 800 },
    ]);
    expect(state.stateHash).toBe(nativeTreeHash(structuredClone(state.value)));
    expect(source.layout.children[0]!.size.w).toBe(300);
  });

  it("preserves full normative hashes while changing branches in a large defaults map", () => {
    const defaults = Object.fromEntries(
      Array.from({ length: 164 }, (_, index) => ["key" + index, index]),
    );
    let state = NativeState.from({ defaults });
    for (let index = 0; index < 512; index++) {
      state = state.patch([
        {
          op: "replace",
          path: "/defaults/key" + (index % 164),
          value: index % 3 ? index : { nested: [index] },
        },
      ]);
      expect(state.stateHash).toBe(nativeTreeHash(state.value));
    }
  });

  it("hashes path copies without serializing the unchanged LSML subtree", () => {
    const before = NativeState.from({
      defaults: { value: 0 },
      layout: { description: "unchanged".repeat(2048) },
    });
    const serialized: unknown[] = [];
    const original = JSON.stringify;
    const spy = vi.spyOn(JSON, "stringify").mockImplementation((...args) => {
      serialized.push(args[0]);
      return original(...args);
    });
    let after: NativeState;
    try {
      after = before.patch([
        { op: "replace", path: "/defaults/value", value: 1 },
      ]);
      expect(serialized).not.toContain(after.value);
      expect(serialized).not.toContain(before.value);
      expect(serialized).not.toContain(
        (after.value as { layout: unknown }).layout,
      );
    } finally {
      spy.mockRestore();
    }
    expect(after!.stateHash).toBe(nativeTreeHash(after!.value));
  });

  it("owns input values and prevents caller writes from invalidating cached hashes", () => {
    const input = { nested: { value: 0 } },
      value = { counter: 1 };
    const before = NativeState.from(input);
    const after = before.patch([{ op: "add", path: "/added", value }]);
    input.nested.value = 99;
    value.counter = 99;
    expect(after.value).toEqual({
      nested: { value: 0 },
      added: { counter: 1 },
    });
    expect(() => {
      (after.value as typeof input).nested.value = 99;
    }).toThrow();
    expect(after.stateHash).toBe(nativeTreeHash(after.value));
  });

  it("rejects the entire transaction after a failed test or invalid later operation", () => {
    const before = NativeState.from({ values: [1], counter: 0 });
    expect(() =>
      before.patch([
        { op: "replace", path: "/counter", value: 1 },
        { op: "test", path: "/counter", value: 2 },
      ]),
    ).toThrow();
    expect(() =>
      before.patch([{ op: "add", path: "/values/2", value: 2 }]),
    ).toThrow();
    expect(() =>
      before.patch([{ op: "replace", path: "/counter~2", value: 2 }]),
    ).toThrow();
    expect(() =>
      before.patch([{ op: "add", path: "/__proto__/polluted", value: true }]),
    ).toThrow();
    expect(before.value).toEqual({ values: [1], counter: 0 });
    expect(before.stateHash).toBe(nativeTreeHash(before.value));
  });

  it("enforces portable numbers and combined depth even when each new value is valid", () => {
    const before = NativeState.from({ outer: {} });
    expect(() =>
      before.patch([{ op: "add", path: "/unsafe", value: 9007199254740992 }]),
    ).toThrow();
    let deep: unknown = null;
    for (let index = 0; index < 128; index++) deep = { next: deep };
    expect(() =>
      before.patch([{ op: "add", path: "/outer/inner", value: deep }]),
    ).toThrow("JSON_LIMIT");
    expect(before.value).toEqual({ outer: {} });
  });
});
