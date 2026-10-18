import { expect, it, vi } from "vitest";
import { nativeTreeHash } from "../../src/internal/native-tree";
import {
  NativeCompositionPublisher,
  type NativeCompositionPeer,
  type NativeCompositionPeerFactory,
} from "../../src/engine/native-composition-publisher";
import type {
  NativeCompositionPlan,
  NativeCompositionProjection,
} from "../../src/scenes/native-composition";

interface ReadGate {
  used: boolean;
  snapshotCaptured: Promise<void>;
  markSnapshotCaptured: () => void;
  resume: Promise<void>;
  release: () => void;
}

interface FakeShared {
  state: Record<string, unknown>;
  staleOnce: boolean;
  applied: Array<{ op: string; path: string; value?: unknown }>;
  readGate?: ReadGate;
  reads?: number;
  activePeerCalls?: number;
  maxActivePeerCalls?: number;
}

function projection(): NativeCompositionProjection {
  return {
    coordinateSpace: "global-scene-texels",
    atlasSize: { width: 640, height: 480 },
    width: 640,
    height: 480,
    viewport: { width: 640, height: 480 },
    groups: [
      {
        id: "prism.native-composition.root.v1",
        parentId: null,
        order: 0,
        opacity: 0.5,
        visible: true,
        blendMode: "normal",
        bounds: { x: 0, y: 0, width: 640, height: 480 },
        affine: { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 },
        children: [{ kind: "solarBand", band: 0 }],
        mask: null,
      },
    ],
    surfaces: [
      {
        band: 0,
        ownerId: "prism.native-composition.root.v1",
        ownerPath: ["prism.native-composition.root.v1"],
        coordinateSpace: "global-scene-texels",
        rect: { x: 0, y: 0, width: 640, height: 480 },
        atlasRect: { x: 0, y: 0, width: 640, height: 480 },
        affine: { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 },
      },
    ],
  };
}

function captureOnlyProjection(): NativeCompositionProjection {
  const result = projection();
  result.groups[0]!.children = [
    {
      kind: "capture",
      componentId: "vision.capture.2",
      sourceComponentId: "camera",
      localSize: { width: 320, height: 180 },
      affine: { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 },
      localOpacity: 1,
      visible: true,
      cropPercent: { left: 0, top: 0, right: 0, bottom: 0 },
      sourceFraming: {
        fit: null,
        contentBox: null,
        sourceZoom: null,
        objectPosition: null,
        authoredSize: [null, null],
        sourceSize: [320, 180],
      },
    },
  ];
  result.surfaces = [];
  return result;
}

it("updates and retires a coverage graph while preserving the other producer", async () => {
  const extended = captureOnlyProjection();
  extended.coverageSurfaces = [
    {
      targetId: "vision.capture.2",
      coordinateSpace: "global-scene-texels",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      atlasRect: { x: 1, y: 1, width: 320, height: 180 },
    },
  ];
  extended.atlasSize = { width: 322, height: 182 };
  const capture = extended.groups[0]!.children[0]!;
  if (capture.kind !== "capture") throw new Error("expected capture fixture");
  capture.mask = { surface: 0 };
  capture.blendMode = "multiply";
  const peerGraph = {
    schema: "solar.native-composition.plan/2",
    producer_id: "host-b-incarnation-1",
    planHash: `sha256:${"b".repeat(64)}`,
    coverageSurfaces: [],
  };
  const initial = {
    ...claimedState("host-a-incarnation-1"),
    producers: { A: "host-a-incarnation-1", B: peerGraph.producer_id },
  };
  initial.graphs.B = peerGraph;
  const shared: FakeShared = { state: initial, staleOnce: false, applied: [] };
  const errors: unknown[] = [];
  const publisher = new NativeCompositionPublisher(
    options(),
    (error) => errors.push(error),
    fakePeerFactory(shared),
  );
  const doc = { scene_id: "scene-a", scene_version: "sha256:revision-a" };
  await expect(
    publisher.publish(extended, doc, "tree-sha256:state-a"),
  ).resolves.toBe("completed");
  const first = (shared.state.graphs as Record<string, NativeCompositionPlan>)
    .A!;
  expect(first.schema).toBe("solar.native-composition.plan/2");
  expect(first.coverageSurfaces).toEqual(extended.coverageSurfaces);
  expect(first.groups[0]!.children[0]).toMatchObject({
    mask: { surface: 0 },
    blendMode: "multiply",
  });
  capture.localOpacity = 0.25;
  await expect(
    publisher.publish(extended, doc, "tree-sha256:state-b"),
  ).resolves.toBe("completed");
  const second = (shared.state.graphs as Record<string, NativeCompositionPlan>)
    .A!;
  expect(second.planHash).not.toBe(first.planHash);
  expect(second.source.stateHash).toBe("tree-sha256:state-b");
  expect(second.groups[0]!.children[0]).toMatchObject({ localOpacity: 0.25 });
  await publisher.retire();
  expect(shared.state.graphs).toEqual({ B: peerGraph });
  expect(shared.applied.map(({ path }) => path)).toEqual([
    "/graphs/A",
    "/graphs/A",
    "/graphs/A",
  ]);
  expect(errors).toEqual([]);
});

function fakePeerFactory(shared: FakeShared): NativeCompositionPeerFactory {
  return (_url, options): NativeCompositionPeer => ({
    ready: Promise.resolve(),
    close: () => {},
    transaction: async (
      request: unknown,
      transactionOptions?: { signal?: AbortSignal },
    ) => {
      const value = request as Record<string, unknown>;
      const signal = transactionOptions?.signal ?? new AbortController().signal;
      shared.activePeerCalls = (shared.activePeerCalls ?? 0) + 1;
      shared.maxActivePeerCalls = Math.max(
        shared.maxActivePeerCalls ?? 0,
        shared.activePeerCalls,
      );
      try {
        if (value.kind === "state.read") {
          shared.reads = (shared.reads ?? 0) + 1;
          const snapshot = structuredClone(shared.state);
          if (shared.readGate && !shared.readGate.used) {
            shared.readGate.used = true;
            shared.readGate.markSnapshotCaptured();
            await shared.readGate.resume;
          }
          await options.onTransaction?.(snapshot, {
            metadata: {
              profile: "lsdp.state.read/1",
              target: "solar/composition",
            },
            signal,
          });
          return { level: "received" };
        }
        if (value.format !== "lsdp.apply/1")
          throw new Error("unexpected fake LSDP request");
        if (shared.staleOnce) {
          shared.staleOnce = false;
          const producers = shared.state.producers as Record<string, string>;
          const graphs = shared.state.graphs as Record<string, unknown>;
          producers.B = "host-b-incarnation-1";
          graphs.B = {
            schema: "solar.native-composition.plan/1",
            producer_id: producers.B,
            planHash: `sha256:${"b".repeat(64)}`,
          };
          throw Object.assign(new Error("BASE_MISMATCH"), {
            code: "BASE_MISMATCH",
          });
        }
        if (value.beforeHash !== nativeTreeHash(shared.state))
          throw Object.assign(new Error("BASE_MISMATCH"), {
            code: "BASE_MISMATCH",
          });
        const operations = value.operations as Array<{
          op: string;
          path: string;
          value?: unknown;
        }>;
        const graphs = shared.state.graphs as Record<string, unknown>;
        for (const operation of operations) {
          shared.applied.push(operation);
          const key = operation.path.split("/").at(-1)!;
          if (operation.op === "remove") delete graphs[key];
          else graphs[key] = operation.value;
        }
        return { level: "applied" };
      } finally {
        shared.activePeerCalls--;
      }
    },
  });
}

function options(producer_id = "host-a-incarnation-1") {
  return {
    url: "ws://127.0.0.1:8080/lsdp",
    resource: "solar/composition" as const,
    graph: "A" as const,
    producer_id,
    authToken: "private-test-token",
    source: { resource: "solar/lane-a" },
  };
}

function state() {
  return {
    schema: "solar.native-composition.state/1",
    producers: {} as Record<string, string>,
    graphs: {} as Record<string, unknown>,
  };
}

function claimedState(producer: string) {
  return {
    schema: "solar.native-composition.state/1",
    producers: { A: producer },
    graphs: {} as Record<string, unknown>,
  };
}

function makeReadGate(): ReadGate {
  let markSnapshotCaptured!: () => void;
  let release!: () => void;
  return {
    used: false,
    snapshotCaptured: new Promise((resolve) => {
      markSnapshotCaptured = resolve;
    }),
    markSnapshotCaptured: () => markSnapshotCaptured(),
    resume: new Promise((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}

it("publishes the active physical graph with source hash and retries only a CAS conflict", async () => {
  const shared = {
    state: claimedState("host-a-incarnation-1") as Record<string, unknown>,
    staleOnce: true,
    applied: [] as Array<{ op: string; path: string; value?: unknown }>,
  };
  const publisher = new NativeCompositionPublisher(
    options(),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );
  await expect(
    publisher.publish(
      projection(),
      { scene_id: "scene-a", scene_version: "sha256:revision-a" },
      "tree-sha256:state-a",
    ),
  ).resolves.toBe("completed");

  const plan = (shared.state.graphs as Record<string, NativeCompositionPlan>)
    .A!;
  expect(plan.schema).toBe("solar.native-composition.plan/1");
  expect(plan.producer_id).toBe("host-a-incarnation-1");
  expect(plan.source).toEqual({
    resource: "solar/lane-a",
    scene_id: "scene-a",
    scene_version: "sha256:revision-a",
    stateHash: "tree-sha256:state-a",
  });
  expect(plan.groups[0]?.id).toBe("prism.native-composition.root.v1");
  expect(plan.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect((shared.state.graphs as Record<string, unknown>).B).toEqual({
    schema: "solar.native-composition.plan/1",
    producer_id: "host-b-incarnation-1",
    planHash: `sha256:${"b".repeat(64)}`,
  });
  expect(shared.applied.map(({ path }) => path)).toEqual(["/graphs/A"]);
  expect(shared.applied.at(-1)?.op).toBe("add");
  await publisher.retire();
  expect(shared.state.graphs).toEqual({
    B: {
      schema: "solar.native-composition.plan/1",
      producer_id: "host-b-incarnation-1",
      planHash: `sha256:${"b".repeat(64)}`,
    },
  });
});

it("does not overwrite or retire a replacement producer after losing slot ownership", async () => {
  const shared = {
    state: claimedState("host-a-incarnation-1") as Record<string, unknown>,
    staleOnce: false,
    applied: [] as Array<{ op: string; path: string; value?: unknown }>,
  };
  const publisher = new NativeCompositionPublisher(
    options(),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );
  const doc = { scene_id: "scene-a", scene_version: "sha256:revision-a" };
  await expect(
    publisher.publish(projection(), doc, "tree-sha256:state-a"),
  ).resolves.toBe("completed");
  const replacement = {
    schema: "solar.native-composition.plan/1",
    producer_id: "host-a-incarnation-2",
    planHash: "sha256:replacement",
  };
  (shared.state.producers as Record<string, string>).A = "host-a-incarnation-2";
  (shared.state.graphs as Record<string, unknown>).A = replacement;

  await expect(
    publisher.publish(projection(), doc, "tree-sha256:state-b"),
  ).resolves.toBe("completed");
  await publisher.retire();

  expect((shared.state.graphs as Record<string, unknown>).A).toEqual(
    replacement,
  );
  expect(shared.applied).toHaveLength(1);
});

it("publishes a capture-only graph with no Solar surface bands", async () => {
  const shared = {
    state: claimedState("host-a-incarnation-1") as Record<string, unknown>,
    staleOnce: false,
    applied: [] as Array<{ op: string; path: string; value?: unknown }>,
  };
  const publisher = new NativeCompositionPublisher(
    options(),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );

  await publisher.publish(
    captureOnlyProjection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:state-a",
  );

  const plan = (shared.state.graphs as Record<string, NativeCompositionPlan>)
    .A!;
  expect(plan.groups[0]?.children[0]).toMatchObject({
    kind: "capture",
    componentId: "vision.capture.2",
    sourceComponentId: "camera",
  });
  expect(plan.surfaces).toEqual([]);
  expect(shared.applied).toHaveLength(1);
  await publisher.retire();
});

it("does not let a delayed old first write replace the Main-claimed producer", async () => {
  const gate = makeReadGate();
  const shared = {
    state: claimedState("host-a-incarnation-1") as Record<string, unknown>,
    staleOnce: false,
    applied: [] as Array<{ op: string; path: string; value?: unknown }>,
    readGate: gate,
  };
  const oldPublisher = new NativeCompositionPublisher(
    options("host-a-incarnation-1"),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );
  const oldWrite = oldPublisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:state-old",
  );
  await gate.snapshotCaptured;

  // Main's atomic rotation CAS claims the new nonce and removes any old graph.
  shared.state = claimedState("host-a-incarnation-2");
  const newPublisher = new NativeCompositionPublisher(
    options("host-a-incarnation-2"),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );
  await newPublisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:state-new",
  );
  gate.release();
  await oldWrite;

  expect(
    (shared.state.graphs as Record<string, NativeCompositionPlan>).A
      ?.producer_id,
  ).toBe("host-a-incarnation-2");
  expect(shared.applied).toHaveLength(1);
  await oldPublisher.retire();
  expect(
    (shared.state.graphs as Record<string, NativeCompositionPlan>).A
      ?.producer_id,
  ).toBe("host-a-incarnation-2");
  await newPublisher.retire();
});

it("cannot claim an empty slot after Main revokes the previous host", async () => {
  const shared = {
    state: state() as Record<string, unknown>,
    staleOnce: false,
    applied: [] as Array<{ op: string; path: string; value?: unknown }>,
  };
  const stalePublisher = new NativeCompositionPublisher(
    options("host-a-old"),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );
  await stalePublisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:state-old",
  );
  expect(shared.applied).toEqual([]);

  shared.state = claimedState("host-a-current");
  const currentPublisher = new NativeCompositionPublisher(
    options("host-a-current"),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );
  await currentPublisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:state-current",
  );

  expect(
    (shared.state.graphs as Record<string, NativeCompositionPlan>).A
      ?.producer_id,
  ).toBe("host-a-current");
  expect(shared.applied).toHaveLength(1);
  await stalePublisher.retire();
  await currentPublisher.retire();
});

it("bounds a slow publisher to one active write and the latest pending plan", async () => {
  const gate = makeReadGate();
  const shared: FakeShared = {
    state: claimedState("host-a-current") as Record<string, unknown>,
    staleOnce: false,
    applied: [] as Array<{ op: string; path: string; value?: unknown }>,
    readGate: gate,
  };
  const publisher = new NativeCompositionPublisher(
    options("host-a-current"),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );
  const active = publisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:active",
  );
  await gate.snapshotCaptured;

  const pending = Array.from({ length: 130 }, (_, index) =>
    publisher.publish(
      projection(),
      { scene_id: "scene-a", scene_version: "sha256:revision-a" },
      `tree-sha256:pending-${index}`,
    ),
  );
  expect(shared.reads).toBe(1);
  expect(shared.activePeerCalls).toBe(1);
  let latestSettled = false;
  void pending.at(-1)!.then(() => {
    latestSettled = true;
  });
  expect(await Promise.all(pending.slice(0, -1))).toEqual(
    Array.from({ length: 129 }, () => "superseded"),
  );
  expect(latestSettled).toBe(false);

  gate.release();
  await expect(active).resolves.toBe("completed");
  await expect(pending.at(-1)).resolves.toBe("completed");
  const plan = (shared.state.graphs as Record<string, NativeCompositionPlan>)
    .A!;
  expect(plan.source.stateHash).toBe("tree-sha256:pending-129");
  expect(shared.applied).toHaveLength(2);
  expect(shared.reads).toBe(2);
  expect(shared.maxActivePeerCalls).toBe(1);
  await publisher.retire();
});

it("lets clear supersede a pending plan behind the active write", async () => {
  const gate = makeReadGate();
  const shared = {
    state: claimedState("host-a-current") as Record<string, unknown>,
    staleOnce: false,
    applied: [] as Array<{ op: string; path: string; value?: unknown }>,
    readGate: gate,
  };
  const publisher = new NativeCompositionPublisher(
    options("host-a-current"),
    (error) => {
      throw error;
    },
    fakePeerFactory(shared),
  );
  const active = publisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:active",
  );
  await gate.snapshotCaptured;
  const skippedBeforeClear = publisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:skipped-before-clear",
  );
  const clear = publisher.clear();
  await expect(skippedBeforeClear).resolves.toBe("superseded");

  gate.release();
  await expect(active).resolves.toBe("completed");
  await expect(clear).resolves.toBe("completed");
  expect(shared.state.graphs).toEqual({});
  await publisher.retire();
});

it("makes retire a terminal clear barrier behind an active write", async () => {
  const gate = makeReadGate();
  let closed = false;
  const shared = {
    state: claimedState("host-a-current") as Record<string, unknown>,
    staleOnce: false,
    applied: [] as Array<{ op: string; path: string; value?: unknown }>,
    readGate: gate,
  };
  const factory = fakePeerFactory(shared);
  const publisher = new NativeCompositionPublisher(
    options("host-a-current"),
    (error) => {
      throw error;
    },
    (url, peerOptions) => {
      const peer = factory(url, peerOptions);
      return {
        ...peer,
        close: () => {
          closed = true;
        },
      };
    },
  );
  const active = publisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:active",
  );
  await gate.snapshotCaptured;
  const pending = publisher.publish(
    projection(),
    { scene_id: "scene-a", scene_version: "sha256:revision-a" },
    "tree-sha256:skipped-before-retire",
  );
  const retire = publisher.retire();
  await expect(pending).resolves.toBe("superseded");
  await expect(
    publisher.publish(
      projection(),
      { scene_id: "scene-a", scene_version: "sha256:revision-a" },
      "tree-sha256:after-retire",
    ),
  ).resolves.toBe("retired");

  gate.release();
  await expect(active).resolves.toBe("completed");
  await retire;
  expect(shared.state.graphs).toEqual({});
  expect(closed).toBe(true);
});

it("reports a terminal peer close and retires without attempting a remote clear", async () => {
  const transaction = vi.fn(async () => {
    throw new Error("closed peer must not receive transactions");
  });
  const close = vi.fn();
  let onClose: ((error: Error) => void) | undefined;
  let reported: unknown;
  let disconnected: unknown;
  const publisher = new NativeCompositionPublisher(
    options(),
    (error) => {
      reported = error;
    },
    (_url, peerOptions) => {
      onClose = peerOptions.onClose;
      return { ready: Promise.resolve(), transaction, close };
    },
    (error) => {
      disconnected = error;
    },
  );
  const error = new Error("composition peer closed");
  onClose?.(error);

  expect(reported).toBe(error);
  expect(disconnected).toBe(error);
  await expect(
    publisher.publish(
      projection(),
      { scene_id: "scene-a", scene_version: "sha256:revision-a" },
      "tree-sha256:after-close",
    ),
  ).resolves.toBe("retired");
  await publisher.retire();
  expect(transaction).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
