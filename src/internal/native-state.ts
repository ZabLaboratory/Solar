import jsonPatch from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { strictJSON } from "../../vendor/lsdp-native-browser/src/strict-json.js";
import { NativeTreeHasher } from "./native-tree";

type Container = Record<string, unknown> | unknown[];
const container = (value: unknown): value is Container =>
  value !== null && typeof value === "object";
const immutableValues = new WeakSet<object>();
export function isImmutableNativeValue(value: unknown): value is object {
  return container(value) && immutableValues.has(value);
}

/** Freeze a freshly decoded or structured-cloned JSON value owned by this realm. */
export function freezeNativeValue(value: unknown): unknown {
  if (container(value) && !immutableValues.has(value)) {
    Object.values(value).forEach(freezeNativeValue);
    Object.freeze(value);
    immutableValues.add(value);
  }
  return value;
}
function portable(value: unknown): unknown {
  const text = JSON.stringify(value);
  strictJSON(text);
  return freezeNativeValue(JSON.parse(text));
}

/** Atomic immutable JSON Patch and incremental draft2 hash; never weakens integrity checks. */
export class NativeState {
  private constructor(
    readonly value: unknown,
    readonly stateHash: string,
    private readonly hasher: NativeTreeHasher,
  ) {}

  static from(value: unknown, hasher = new NativeTreeHasher()): NativeState {
    const owned = portable(value);
    return new NativeState(owned, hasher.hash(owned), hasher);
  }

  patch(operations: Operation[]): NativeState {
    const state = patchNativeValue(this.value, operations, this.hasher);
    const hash = this.hasher.hash(state);
    return new NativeState(state, hash, this.hasher);
  }
}

/** Apply a verified patch without copying unchanged JSON branches. The worker
 * supplies the hash when this operation is mirrored into its render realm. */
export function patchNativeValue(
  state: unknown,
  operations: Operation[],
  hasher?: NativeTreeHasher,
): unknown {
  if (!Array.isArray(operations))
    throw new Error("Unsupported native operation.");
  for (const input of operations) {
    if (
      !input ||
      !["add", "remove", "replace", "test"].includes(input.op) ||
      typeof input.path !== "string" ||
      /~(?:[^01]|$)/.test(input.path)
    )
      throw new Error("Unsupported native operation.");
    // Validate only incoming bytes. Unchanged frozen subtrees retain validation,
    // while their cached node/depth budgets still enforce the whole resource limit.
    const operation = portable(input) as Operation;
    if (operation.op === "test") {
      jsonPatch.applyOperation(state, operation, true, true, true);
      continue;
    }
    const copies: object[] = [];
    const copy = (original: Container): Container => {
      const next = Array.isArray(original) ? original.slice() : { ...original };
      hasher?.copied(next, original);
      copies.push(next);
      return next;
    };
    let candidate = state;
    if (operation.path !== "" && container(state)) {
      candidate = copy(state);
      let before: unknown = state,
        after = candidate as Record<string, unknown>;
      const keys = operation.path
        .slice(1)
        .split("/")
        .map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
      for (const key of keys.slice(0, -1)) {
        if (!container(before) || !Object.hasOwn(before, key)) break;
        const child: unknown = (before as Record<string, unknown>)[key];
        if (!container(child)) break;
        const next = copy(child);
        // Define a data property, including keys that collide with Object.prototype.
        Object.defineProperty(after, key, {
          value: next,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        before = child;
        after = next as Record<string, unknown>;
      }
    }
    state = jsonPatch.applyOperation(
      candidate,
      operation,
      true,
      true,
      true,
    ).newDocument;
    for (const next of copies.reverse()) freezeNativeValue(next);
  }
  return state;
}
