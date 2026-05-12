// Dispatcher smoke — the action-runner routes on `kind` and throws
// a typed error for unknown kinds. Per-runner behaviour lives in
// dedicated suites (count-up, text-reveal, reorder-flip).

import { describe, expect, it } from "vitest";

import { createStore } from "../../src/state/store";
import {
  runAction,
  hasAction,
  registerActionRunner,
  UnknownActionKindError,
} from "../../src/animate/action-runner";
import type { Patch } from "../../src/transport/protocol";

describe("action-runner / dispatcher", () => {
  it("hasAction returns true only when `action` is set", () => {
    expect(hasAction({ path: "p", value: 1 })).toBe(false);
    expect(
      hasAction({
        path: "p",
        value: 1,
        action: { kind: "count-up", params: {} },
      }),
    ).toBe(true);
  });

  it("throws UnknownActionKindError for an unregistered kind", async () => {
    const store = createStore();
    const patch = {
      path: "p",
      value: 1,
      action: { kind: "does-not-exist" as never, params: {} },
    } as Patch;
    await expect(runAction({ store, patch })).rejects.toBeInstanceOf(
      UnknownActionKindError,
    );
  });

  it("allows custom runners to be registered", async () => {
    const store = createStore();
    let called = false;
    registerActionRunner("custom-test", async () => {
      called = true;
    });
    const patch = {
      path: "p",
      value: 1,
      action: { kind: "custom-test" as never, params: {} },
    } as Patch;
    await runAction({ store, patch });
    expect(called).toBe(true);
  });

  it("is a no-op when patch has no action", async () => {
    const store = createStore();
    await runAction({ store, patch: { path: "p", value: 5 } });
    // store untouched — runAction with no action descriptor returns
    // immediately. Setting the value is the caller's responsibility.
    expect(store.toRecord()).toEqual({});
  });
});
