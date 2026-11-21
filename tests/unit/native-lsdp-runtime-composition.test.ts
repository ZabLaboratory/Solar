import type { MountOptions } from "../../src/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeTreeHash } from "../../src/internal/native-tree";
import { NativeLsdpReconnect } from "../../src/engine/native-lsdp-reconnect";
import type { AnimationFrame } from "../../src/engine/animations";
import {
  NativeLsdpRuntime,
  mocks,
  setup,
  document,
  change,
} from "../helpers/native-runtime-composition";

describe("native Solar composition attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.peers.length = 0;
    mocks.compositionPublishers.length = 0;
    mocks.compositionPublisherOptions = null;
  });

  async function coordinated(varyProjection = false) {
    const initial = structuredClone(document);
    const candidate = {
      ...initial,
      defaults: { "__lit.text.title": "candidate" },
    };
    const ready = await setup(initial, "", undefined, varyProjection);
    let state: unknown = initial;
    let sequence = 0;
    const deliver = async (phase: string) => {
      const value =
        phase === "cleanup"
          ? candidate
          : {
              ...(phase === "commit" || phase === "finalize"
                ? candidate
                : initial),
              "x-solar-transition": {
                request_id: "composition-selection",
                phase,
                lane: "preview",
                ...(phase === "prepare" ? { source: candidate } : {}),
              },
            };
      const transactionId = String(++sequence).padStart(32, "0");
      const receipt = await ready.receive(
        {
          kind: "applied_change",
          sequence,
          mutation: {
            format: "lsdp.apply/1",
            id: transactionId,
            target: "solar/lane-a",
            beforeHash: nativeTreeHash(state),
            operations: [{ op: "replace", path: "", value }],
          },
          receipt: { target: "solar/lane-a", transactionId, level: "applied" },
        },
        ready.context("lsdp.state.subscription/1"),
      );
      state = value;
      expect(receipt).toEqual({ level: "applied", transactionId });
      return nativeTreeHash(value);
    };
    return { ...ready, initial, candidate, deliver };
  }

  it.each(["prepare", "commit", "finalize", "cleanup"])(
    "renews the source hash on coordinated %s with identical layout",
    async (acceptedPhase) => {
      const ready = await coordinated();
      const initialProjection =
        mocks.composition.publish.mock.calls.at(-1)?.[0];
      try {
        for (const phase of ["prepare", "commit", "finalize", "cleanup"]) {
          const hash = await ready.deliver(phase);
          if (phase !== acceptedPhase) continue;
          const accepted = mocks.composition.publish.mock.calls.at(-1)!;
          expect(accepted[1]).toEqual(
            phase === "prepare" ? ready.initial : ready.candidate,
          );
          expect(accepted[2]).toBe(hash);
          expect(accepted[0]).toEqual(initialProjection);
          break;
        }
        // A repeated identical state still admits the exact hash without remounting.
        await ready.deliver(acceptedPhase);
        expect(mocks.mount).toHaveBeenCalledTimes(2);
        expect(ready.options.onError).not.toHaveBeenCalled();
      } finally {
        ready.runtime.disconnect();
      }
    },
  );

  it("binds the restored projection to the abort hash and replays only that state to a replacement peer", async () => {
    const ready = await coordinated(true);
    const initialProjection = mocks.composition.publish.mock.calls.at(-1)?.[0];
    try {
      await ready.deliver("prepare");
      await ready.deliver("commit");
      expect(ready.scenes[1]!.compositionFrame.owners[0]!.opacity).toBe(0.5);
      vi.useFakeTimers();
      mocks.compositionPublishers[0]!.onDisconnected(new Error("peer closed"));
      const hash = await ready.deliver("abort");
      await vi.advanceTimersByTimeAsync(250);
      expect(mocks.compositionPublishers).toHaveLength(2);
      expect(mocks.composition.publish.mock.calls.at(-1)).toEqual([
        initialProjection,
        ready.initial,
        hash,
      ]);
      expect(ready.scenes[0]!.activate).toHaveBeenCalledOnce();
      expect(ready.scenes[1]!.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      ready.runtime.disconnect();
    }
  });

  it.each(["commit", "finalize", "abort"])(
    "publishes a joining coordinated %s snapshot with its full resource hash",
    async (phase) => {
      const initial = {
        ...document,
        "x-solar-transition": {
          request_id: "snapshot-selection",
          phase,
          lane: "preview",
        },
      };
      const ready = await setup(initial);
      try {
        expect(mocks.composition.publish.mock.calls.at(-1)?.[2]).toBe(
          nativeTreeHash(initial),
        );
        expect(mocks.composition.publish.mock.calls.at(-1)?.[0]).toBeTruthy();
        expect(ready.options.onError).not.toHaveBeenCalled();
      } finally {
        ready.runtime.disconnect();
      }
    },
  );

  it("keeps the accepted projection on failed staging and rejects invalid phases without publication", async () => {
    const ready = await coordinated();
    const initialProjection = mocks.composition.publish.mock.calls.at(-1)?.[0];
    try {
      mocks.mount.mockRejectedValueOnce(new Error("renderer refused"));
      const hash = await ready.deliver("prepare");
      expect(mocks.feedback.mock.calls.at(-1)?.[2]).toMatchObject({
        phase: "failed",
      });
      expect(mocks.composition.publish.mock.calls.at(-1)).toEqual([
        initialProjection,
        ready.initial,
        hash,
      ]);
      const publications = mocks.composition.publish.mock.calls.length;
      await expect(ready.deliver("invalid")).rejects.toThrow(
        "SOLAR_TRANSITION_INVALID",
      );
      expect(mocks.composition.publish).toHaveBeenCalledTimes(publications);
    } finally {
      ready.runtime.disconnect();
    }
  });

  it("cannot publish a coordinated state after stopping during feedback", async () => {
    const ready = await coordinated();
    let release!: () => void;
    let entered!: () => void;
    const feedbackEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mocks.feedback.mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const publications = mocks.composition.publish.mock.calls.length;
    const pending = ready.deliver("prepare");
    const rejected = expect(pending).rejects.toThrow();
    await feedbackEntered;
    ready.runtime.disconnect();
    release();
    await rejected;
    expect(mocks.composition.publish).toHaveBeenCalledTimes(publications);
    expect(mocks.composition.retire).toHaveBeenCalledOnce();
  });

  it("refreshes the full resource hash when only another selected entry changes", async () => {
    const initial = { selected: document, other: document };
    const ready = await setup(initial, "", "selected");
    const projection = mocks.composition.publish.mock.calls.at(-1)?.[0];
    try {
      const event = change();
      event.mutation.beforeHash = nativeTreeHash(initial);
      event.mutation.operations[0]!.path = "/other/defaults/__lit.text.title";
      await ready.receive(event, ready.context("lsdp.state.subscription/1"));
      const expected = {
        selected: document,
        other: { ...document, defaults: { "__lit.text.title": "edited" } },
      };
      expect(mocks.composition.publish.mock.calls.at(-1)).toEqual([
        projection,
        document,
        nativeTreeHash(expected),
      ]);
      expect(ready.scene.applyPatch).not.toHaveBeenCalled();
      expect(mocks.mount).toHaveBeenCalledOnce();
    } finally {
      ready.runtime.disconnect();
    }
  });

  it("publishes the accepted Vision receipt and refreshes it after a scalar patch", async () => {
    const initial = {
      ...structuredClone(document),
      layout: {
        kind: "frame",
        id: "authored-root",
        size: { w: 640, h: 480 },
        children: [
          {
            kind: "x-zab.capture",
            id: "camera.main",
            size: { w: 320, h: 180 },
          },
        ],
      },
    };
    const ready = await setup(initial);
    const initialPublication = mocks.composition.publish.mock.calls[0];
    expect(initialPublication).toBeDefined();
    const [projection, initialDocument, initialHash] = initialPublication!;
    expect(projection).toMatchObject({
      coordinateSpace: "global-scene-texels",
      atlasSize: { width: 640, height: 480 },
      groups: [
        {
          id: "prism.native-composition.root.v1",
          children: [
            { kind: "solarBand", band: 0 },
            {
              kind: "capture",
              componentId: "vision.capture.2",
              sourceComponentId: "camera",
            },
          ],
        },
      ],
      surfaces: [
        {
          band: 0,
          ownerId: "prism.native-composition.root.v1",
          coordinateSpace: "global-scene-texels",
          rect: { x: 0, y: 0, width: 640, height: 480 },
        },
      ],
    });
    expect(initialDocument).toEqual(initial);
    expect(initialHash).toBe(nativeTreeHash(initial));
    expect(mocks.mount.mock.calls[0]?.[5]).toMatchObject({
      nativeComposition: true,
      surface: { width: 640, height: 480 },
    });
    expect(mocks.compositionPublisherOptions).toMatchObject({
      resource: "solar/composition",
      graph: "A",
      producer_id: "solar-host-a-incarnation-1",
      source: { resource: "solar/lane-a" },
    });

    const event = change();
    event.mutation.beforeHash = nativeTreeHash(initial);
    await ready.receive(event, ready.context("lsdp.state.subscription/1"));
    const nextPublication = mocks.composition.publish.mock.calls.at(-1)!;
    const nextDocument = {
      ...initial,
      defaults: { "__lit.text.title": "edited" },
    };
    expect(nextPublication[1]).toEqual(nextDocument);
    expect(nextPublication[2]).toBe(nativeTreeHash(nextDocument));
    expect(nextPublication[0]).toEqual(projection);
    expect(mocks.mount).toHaveBeenCalledOnce();
    expect(ready.scene.applyPatch).toHaveBeenCalledWith({
      "__lit.text.title": "edited",
    });
    ready.runtime.disconnect();
  });

  function animatedDocument() {
    return {
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
  }
  function animationCallback(runtime: NativeLsdpRuntime) {
    return (
      runtime as unknown as {
        animations: {
          apply: (frames: readonly AnimationFrame[]) => Promise<void>;
        };
      }
    ).animations;
  }

  it("publishes each submitted animation receipt and restores native geometry on cancel", async () => {
    const initial = animatedDocument();
    const ready = await setup(initial);
    try {
      const animations = animationCallback(ready.runtime);
      for (const [offset, expectedX] of [
        [40, 70],
        [5, 35],
      ] as const) {
        await animations.apply([
          { target: "camera", values: { translateX: offset } },
        ]);
        const publication = mocks.composition.publish.mock.calls.at(-1)!;
        expect(publication[2]).toBe(nativeTreeHash(initial));
        expect(publication[0]).toMatchObject({
          groups: [
            {
              children: [
                { kind: "solarBand" },
                { kind: "capture", affine: { tx: expectedX, ty: 30 } },
              ],
            },
          ],
        });
      }
      await animations.apply([]);
      expect(mocks.composition.publish).toHaveBeenCalledTimes(4);
      expect(mocks.composition.publish.mock.calls.at(-1)?.[0]).toMatchObject({
        groups: [
          {
            children: [
              { kind: "solarBand" },
              { kind: "capture", affine: { tx: 30, ty: 30 } },
            ],
          },
        ],
      });
      expect(mocks.mount).toHaveBeenCalledOnce();
    } finally {
      ready.runtime.disconnect();
    }
  });

  it("does not publish an animation whose scene disconnects during submission", async () => {
    const ready = await setup(animatedDocument());
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submitting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    ready.scene.applyPatch.mockImplementationOnce(async () => {
      entered();
      await pending;
    });
    const publications = mocks.composition.publish.mock.calls.length;
    const animation = animationCallback(ready.runtime).apply([
      { target: "camera", values: { translateX: 40 } },
    ]);
    await submitting;
    ready.runtime.disconnect();
    release();
    await animation;
    expect(mocks.composition.publish).toHaveBeenCalledTimes(publications);
  });

  it("reconnects only the composition peer with a fresh token and the latest accepted state", async () => {
    const initial = {
      ...structuredClone(document),
      layout: {
        kind: "frame",
        id: "authored-root",
        size: { w: 640, h: 480 },
        children: [
          {
            kind: "x-zab.capture",
            id: "camera.main",
            size: { w: 320, h: 180 },
          },
        ],
      },
    };
    const fetch = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("initial-composition-token")
      .mockResolvedValueOnce("refreshed-composition-token");
    const ready = await setup(initial, { fetch });
    expect(mocks.compositionPublishers).toHaveLength(1);
    const update = change();
    update.mutation.beforeHash = nativeTreeHash(initial);
    await ready.receive(update, ready.context("lsdp.state.subscription/1"));
    const latestPublication = mocks.composition.publish.mock.calls.at(-1);
    expect(latestPublication?.[1]).toMatchObject({
      defaults: { "__lit.text.title": "edited" },
    });

    vi.useFakeTimers();
    try {
      mocks.compositionPublishers[0]!.onDisconnected(
        new Error("composition websocket closed"),
      );
      await vi.advanceTimersByTimeAsync(250);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.compositionPublishers).toHaveLength(2);
      expect(mocks.compositionPublishers[1]!.options).toMatchObject({
        authToken: "refreshed-composition-token",
      });
      expect(mocks.peers).toHaveLength(1);
      expect(mocks.composition.publish.mock.calls.at(-1)).toEqual(
        latestPublication,
      );
      mocks.compositionPublishers[0]!.onDisconnected(
        new Error("late close from replaced composition peer"),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.compositionPublishers).toHaveLength(2);

      mocks.compositionPublishers[1]!.onDisconnected(
        new Error("composition websocket closed again"),
      );
      ready.runtime.disconnect();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.compositionPublishers).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      ready.runtime.disconnect();
    }
  });
});

it("gives primary reconnection priority over a pending composition retry", async () => {
  vi.useFakeTimers();
  try {
    const connectPrimary = vi.fn();
    const reconnectComposition = vi.fn();
    const connecting = vi.fn();
    const reconnect = new NativeLsdpReconnect({
      active: () => true,
      connectPrimary,
      reconnectComposition,
      connecting,
    });

    reconnect.schedule("composition");
    reconnect.schedule("primary");
    await vi.advanceTimersByTimeAsync(500);

    expect(connecting).toHaveBeenCalledOnce();
    expect(connectPrimary).toHaveBeenCalledOnce();
    expect(reconnectComposition).not.toHaveBeenCalled();
    reconnect.clear();
  } finally {
    vi.useRealTimers();
  }
});

it("does not reset composition backoff when peer construction returns", async () => {
  vi.useFakeTimers();
  try {
    const start = vi.fn();
    const reconnect: NativeLsdpReconnect = new NativeLsdpReconnect({
      active: () => true,
      connectPrimary: vi.fn(),
      reconnectComposition: () =>
        void reconnect.recoverComposition("token", start, vi.fn()),
      connecting: vi.fn(),
    });

    reconnect.schedule("composition");
    await vi.advanceTimersByTimeAsync(250);
    expect(start).toHaveBeenCalledOnce();

    // A returned start call has not completed a handshake or publication.
    reconnect.schedule("composition");
    await vi.advanceTimersByTimeAsync(250);
    expect(start).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(250);
    expect(start).toHaveBeenCalledTimes(2);
    reconnect.clear();
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a composition token fetch superseded by primary token refresh", async () => {
  let resolveToken!: (token: string) => void;
  const token: MountOptions["token"] = {
    fetch: () => new Promise((resolve) => (resolveToken = resolve)),
  };
  const starts: string[] = [];
  const reconnect = new NativeLsdpReconnect({
    active: () => true,
    connectPrimary: vi.fn(),
    reconnectComposition: vi.fn(),
    connecting: vi.fn(),
  });

  const attempt = reconnect.recoverComposition(
    token,
    (value) => starts.push(value),
    vi.fn(),
  );
  reconnect.schedule("primary");
  resolveToken("stale-composition-token");
  await attempt;

  expect(starts).toEqual([]);
  reconnect.clear();
});

it("does not admit a token fetch from a stopped composition lifetime", async () => {
  let active = true;
  let resolveOld!: (token: string) => void;
  const oldToken: MountOptions["token"] = {
    fetch: () => new Promise((resolve) => (resolveOld = resolve)),
  };
  const starts: string[] = [];
  const report = vi.fn();
  const reconnect = new NativeLsdpReconnect({
    active: () => active,
    connectPrimary: vi.fn(),
    reconnectComposition: vi.fn(),
    connecting: vi.fn(),
  });

  const oldAttempt = reconnect.recoverComposition(
    oldToken,
    (token) => starts.push(token),
    report,
  );
  active = false;
  reconnect.clear();
  active = true;
  await reconnect.recoverComposition(
    { fetch: async () => "current-token" },
    (token) => starts.push(token),
    report,
  );
  resolveOld("stale-token");
  await oldAttempt;

  expect(starts).toEqual(["current-token"]);
  expect(report).not.toHaveBeenCalled();
  reconnect.clear();
});
