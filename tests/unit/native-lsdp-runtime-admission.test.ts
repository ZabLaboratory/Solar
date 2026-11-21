import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeTreeHash } from "../../src/internal/native-tree";
import {
  mocks,
  setup,
  document,
  change,
  turn,
} from "../helpers/native-runtime-composition";

describe("native received/presented admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.peers.length = 0;
    mocks.compositionPublishers.length = 0;
  });
  it("acknowledges identical scalar events without GPU work or native publication", async () => {
    const ready = await setup(document);
    const applied = vi.fn();
    ready.options.target.addEventListener("solar:lsdp-applied", applied);
    const publications = mocks.composition.publish.mock.calls.length;
    try {
      for (let index = 1; index <= 5; index++) {
        const event = change();
        event.sequence = index;
        event.mutation.beforeHash = nativeTreeHash(document);
        event.mutation.operations = [
          {
            op: "replace",
            path: "/defaults/__lit.text.title",
            value: "before",
          },
        ];
        await ready.receive(event, ready.context("lsdp.state.subscription/1"));
      }
      expect(ready.scene.applyPatch).not.toHaveBeenCalled();
      expect(mocks.composition.publish).toHaveBeenCalledTimes(publications);
      expect(applied).toHaveBeenCalledTimes(5);
    } finally {
      ready.runtime.disconnect();
    }
  });
  it("keeps duplicate receipts behind the pending covering frame", async () => {
    const ready = await setup(document);
    const applied = vi.fn();
    ready.options.target.addEventListener("solar:lsdp-applied", applied);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r));
    ready.scene.applyPatch.mockImplementationOnce(async () => {
      enter();
      await gate;
    });
    const first = change();
    first.mutation.beforeHash = nativeTreeHash(document);
    const firstReceipt = ready.receive(
      first,
      ready.context("lsdp.state.subscription/1"),
    );
    await entered;
    const second = change();
    second.sequence = 2;
    second.mutation.beforeHash = nativeTreeHash({
      ...document,
      defaults: { "__lit.text.title": "edited" },
    });
    const secondReceipt = ready.receive(
      second,
      ready.context("lsdp.state.subscription/1"),
    );
    await turn();
    expect(applied).not.toHaveBeenCalled();
    release();
    try {
      await Promise.all([firstReceipt, secondReceipt]);
      expect(applied).toHaveBeenCalledTimes(2);
      expect(ready.scene.applyPatch).toHaveBeenCalledOnce();
    } finally {
      ready.runtime.disconnect();
    }
  });
  it("does not publish an aborted non-scalar patch", async () => {
    const ready = await setup(document);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r));
    ready.scene.applyPatch.mockImplementationOnce(async () => {
      enter();
      await gate;
    });
    const before = mocks.composition.publish.mock.calls.length;
    const event = change();
    event.mutation.beforeHash = nativeTreeHash(document);
    event.mutation.operations = [
      { op: "add", path: "/x-orion", value: { test: 1 } },
      { op: "replace", path: "/defaults/__lit.text.title", value: "cancelled" },
    ];
    const abort = new AbortController();
    const receiving = ready.receive(event, {
      ...ready.context("lsdp.state.subscription/1"),
      signal: abort.signal,
    });
    const rejected = expect(receiving).rejects.toThrow("cancelled");
    await entered;
    abort.abort(new Error("cancelled"));
    release();
    try {
      await rejected;
      expect(mocks.composition.publish).toHaveBeenCalledTimes(before);
    } finally {
      ready.runtime.disconnect();
    }
  });
  it("publishes animation using the presented document while a newer scalar is pending", async () => {
    const initial = {
      ...structuredClone(document),
      layout: {
        kind: "x-zab.capture",
        id: "camera",
        position: { x: 30, y: 20 },
        size: { w: 100, h: 50 },
      },
      animations: {
        move: {
          target: "camera",
          keyframes: {
            duration_ms: 100,
            easing: "linear",
            steps: [
              { at: 0, translateX: 0 },
              { at: 1, translateX: 40 },
            ],
          },
        },
      },
    };
    const ready = await setup(initial);
    let rendered = "before";
    const records: Array<{ declared: string; rendered: string }> = [];
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r));
    const apply = ready.scene.applyPatch.getMockImplementation()!;
    let count = 0;
    ready.scene.applyPatch.mockImplementation(async (patch) => {
      if (++count === 1) {
        enter();
        await gate;
      }
      if (typeof patch["__lit.text.title"] === "string")
        rendered = patch["__lit.text.title"] as string;
      await apply(patch);
    });
    mocks.composition.publish.mockImplementation(
      async (_projection: unknown, doc: unknown) => {
        records.push({
          declared: (doc as typeof initial).defaults["__lit.text.title"],
          rendered,
        });
        return "completed";
      },
    );
    const first = change();
    first.mutation.beforeHash = nativeTreeHash(initial);
    first.mutation.operations = [
      { op: "replace", path: "/defaults/__lit.text.title", value: "first" },
    ];
    const receivingFirst = ready.receive(
      first,
      ready.context("lsdp.state.subscription/1"),
    );
    await entered;
    const second = change();
    second.sequence = 2;
    second.mutation.beforeHash = nativeTreeHash({
      ...initial,
      defaults: { "__lit.text.title": "first" },
    });
    second.mutation.operations = [
      { op: "replace", path: "/defaults/__lit.text.title", value: "second" },
    ];
    const receivingSecond = ready.receive(
      second,
      ready.context("lsdp.state.subscription/1"),
    );
    await Promise.resolve();
    await Promise.resolve();
    const animations = (
      ready.runtime as unknown as {
        animations: { apply: (frames: unknown[]) => Promise<void> };
      }
    ).animations;
    const animating = animations.apply([
      { target: "camera", values: { translateX: 40 } },
    ]);
    release();
    try {
      await Promise.all([receivingFirst, receivingSecond, animating]);
      expect(records).toHaveLength(3);
      expect(records.every((row) => row.declared === row.rendered)).toBe(true);
    } finally {
      mocks.composition.publish.mockImplementation(async () => "completed");
      ready.runtime.disconnect();
    }
  });
  const unsupported = () =>
    Object.assign(
      new Error(
        "Vision render: unsupported GPU effect: Difference after native capture",
      ),
      { phase: "render" },
    );
  it("keeps a deterministic rejection subscribed until a changed hash can be admitted", async () => {
    const ready = await setup(document);
    const blocked = vi.fn(),
      unblocked = vi.fn();
    ready.options.target.addEventListener("solar:lsdp-blocked", blocked);
    ready.options.target.addEventListener("solar:lsdp-unblocked", unblocked);
    const before = mocks.composition.publish.mock.calls.length;
    const event = change();
    event.mutation.beforeHash = nativeTreeHash(document);
    const next = {
      ...document,
      layout: { type: "frame", children: [{ type: "text", value: "new" }] },
    };
    event.mutation.operations = [{ op: "replace", path: "", value: next }];
    mocks.mount.mockRejectedValueOnce(unsupported());
    try {
      expect(
        await ready.receive(event, ready.context("lsdp.state.subscription/1")),
      ).toEqual({ level: "received", stateHash: nativeTreeHash(next) });
      expect(ready.options.onStatus).toHaveBeenLastCalledWith("blocked");
      expect(ready.options.onError).toHaveBeenLastCalledWith(
        expect.objectContaining({
          code: "VISION_EFFECT_UNSUPPORTED",
          recoverable: false,
        }),
      );
      expect(ready.scene.dispose).not.toHaveBeenCalled();
      expect(mocks.composition.publish).toHaveBeenCalledTimes(before);
      const mounts = mocks.mount.mock.calls.length;
      event.sequence = 2;
      event.mutation.beforeHash = nativeTreeHash(next);
      await ready.receive(event, ready.context("lsdp.state.subscription/1"));
      expect(mocks.mount).toHaveBeenCalledTimes(mounts);
      expect(blocked).toHaveBeenCalledOnce();
      const fixed = { ...next, defaults: { "__lit.text.title": "fixed" } };
      event.sequence = 3;
      event.mutation.operations = [{ op: "replace", path: "", value: fixed }];
      await ready.receive(event, ready.context("lsdp.state.subscription/1"));
      expect(mocks.mount).toHaveBeenCalledTimes(mounts + 1);
      expect(ready.options.onStatus).toHaveBeenLastCalledWith("live");
      expect(unblocked).toHaveBeenCalledOnce();
      expect(mocks.composition.publish).toHaveBeenCalledTimes(before + 1);
      expect(mocks.peers).toHaveLength(1);
    } finally {
      ready.runtime.disconnect();
    }
  });
  it("does not unblock a rejected selected document when only another entry changes", async () => {
    const initial = { selected: document, other: 1 };
    const ready = await setup(initial, "", "selected");
    const rejected = {
      selected: {
        ...document,
        layout: { type: "frame", children: [{ type: "text", value: "new" }] },
      },
      other: 1,
    };
    const event = change();
    event.mutation.beforeHash = nativeTreeHash(initial);
    event.mutation.operations = [
      { op: "replace", path: "/selected", value: rejected.selected },
    ];
    const publications = mocks.composition.publish.mock.calls.length;
    mocks.mount
      .mockRejectedValueOnce(unsupported())
      .mockRejectedValueOnce(unsupported());
    try {
      await ready.receive(event, ready.context("lsdp.state.subscription/1"));
      const mounts = mocks.mount.mock.calls.length;
      event.sequence = 2;
      event.mutation.beforeHash = nativeTreeHash(rejected);
      event.mutation.operations = [{ op: "replace", path: "/other", value: 2 }];
      expect(
        await ready.receive(event, ready.context("lsdp.state.subscription/1")),
      ).toMatchObject({ level: "received" });
      expect(mocks.mount).toHaveBeenCalledTimes(mounts + 1);
      expect(ready.options.onStatus).toHaveBeenLastCalledWith("blocked");
      expect(mocks.composition.publish).toHaveBeenCalledTimes(publications);
    } finally {
      ready.runtime.disconnect();
    }
  });
  it("subscribes after a blocked cold snapshot without claiming it applied", async () => {
    const ready = await setup(document, "", undefined, false, unsupported());
    try {
      expect(ready.options.onStatus).toHaveBeenLastCalledWith("blocked");
      expect(ready.options.onError).toHaveBeenLastCalledWith(
        expect.objectContaining({
          code: "VISION_EFFECT_UNSUPPORTED",
          recoverable: false,
        }),
      );
      expect(mocks.composition.publish).not.toHaveBeenCalled();
      expect(mocks.peers).toHaveLength(1);
      expect(
        (
          ready.peer as unknown as { transaction: ReturnType<typeof vi.fn> }
        ).transaction.mock.calls.some(
          (call) => (call[0] as { kind: string }).kind === "subscribe",
        ),
      ).toBe(true);
    } finally {
      ready.runtime.disconnect();
    }
  });
});
