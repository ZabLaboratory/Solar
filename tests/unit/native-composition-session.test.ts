import { expect, it, vi } from "vitest";
import type { Operation } from "fast-json-patch";
import type { IncomingContext } from "../../vendor/lsdp-native-browser/src/browser.js";
import { nativeTreeHash } from "../../src/internal/native-tree";
import { NativeCompositionSession } from "../../src/engine/native-composition-session";
import type { NativeCompositionPeerFactory } from "../../src/engine/native-composition-publisher";
import type {
  NativeCompositionPlan,
  NativeCompositionProjection,
} from "../../src/scenes/native-composition";
import type { LSMLDocument } from "../../src/scenes/native-document";
import type { NativeSceneFrames } from "../../src/engine/native-scene-frames";
import type { VisionSceneHandle } from "../../src/engine/vision-contracts";
import type { MountOptions } from "../../src/types";

interface SharedCompositionState {
  schema: "solar.native-composition.state/1";
  producers: { A: string };
  graphs: Partial<Record<"A" | "B", NativeCompositionPlan>>;
}

function projection(width: number): NativeCompositionProjection {
  return {
    coordinateSpace: "global-scene-texels",
    atlasSize: { width, height: 480 },
    width,
    height: 480,
    viewport: { width, height: 480 },
    groups: [
      {
        id: "prism.native-composition.root.v1",
        parentId: null,
        order: 0,
        opacity: 1,
        visible: true,
        blendMode: "normal",
        bounds: { x: 0, y: 0, width, height: 480 },
        affine: { m00: 1, m01: 0, tx: 0, m10: 0, m11: 1, ty: 0 },
        children: [],
        mask: null,
      },
    ],
    surfaces: [],
  };
}

function scene(scene_id: string, revision: string): LSMLDocument {
  return {
    lsml: "1.1",
    scene_id,
    scene_version: `sha256:${revision.repeat(64)}`,
    layout: { kind: "frame", size: { w: 640, h: 480 }, children: [] },
  };
}

function options(): MountOptions {
  return {
    target: globalThis.document.createElement("div"),
    nativeLSDP: { url: "ws://127.0.0.1:8080/lsdp", resource: "solar/lane-a" },
    nativeCompositionLSDP: {
      url: "ws://127.0.0.1:8080/lsdp",
      resource: "solar/composition",
      graph: "A",
      producer_id: "host-a-current",
    },
    sceneSourceProvider: { get: vi.fn() },
    token: "token-a",
    mode: "test",
    onError: vi.fn(),
  };
}

function peerFactory(
  state: SharedCompositionState,
  peers: Array<{ authToken: string; onClose?: (error: Error) => void }>,
): NativeCompositionPeerFactory {
  return (_url, peerOptions) => {
    peers.push({
      authToken: peerOptions.authToken ?? "",
      onClose: peerOptions.onClose,
    });
    return {
      ready: Promise.resolve(),
      close: () => {},
      transaction: async (request: unknown, transactionOptions) => {
        transactionOptions?.signal?.throwIfAborted();
        const message = request as Record<string, unknown>;
        if (message.kind === "state.read") {
          const context: IncomingContext = {
            metadata: {
              target: "solar/composition",
              profile: "lsdp.state.read/1",
            },
            signal: transactionOptions?.signal ?? new AbortController().signal,
          };
          await peerOptions.onTransaction?.(structuredClone(state), context);
          return { level: "received" };
        }
        if (
          message.format !== "lsdp.apply/1" ||
          message.beforeHash !== nativeTreeHash(state)
        )
          throw Object.assign(new Error("BASE_MISMATCH"), {
            code: "BASE_MISMATCH",
          });
        for (const operation of message.operations as Operation[]) {
          if (operation.path !== "/graphs/A")
            throw new Error("Unexpected composition graph path.");
          switch (operation.op) {
            case "remove":
              delete state.graphs.A;
              break;
            case "add":
            case "replace":
              state.graphs.A = operation.value as NativeCompositionPlan;
              break;
            default:
              throw new Error("Unexpected composition patch operation.");
          }
        }
        return { level: "applied" };
      },
    };
  };
}

it("replays the latest accepted LSML composition after the peer was offline", async () => {
  const state: SharedCompositionState = {
    schema: "solar.native-composition.state/1",
    producers: { A: "host-a-current" },
    graphs: {},
  };
  const peers: Array<{ authToken: string; onClose?: (error: Error) => void }> =
    [];
  const sceneA = scene("scene-a", "a");
  const sceneB = scene("scene-b", "b");
  const projectionA = projection(640);
  const projectionB = projection(800);
  const visionScene = (document: LSMLDocument): VisionSceneHandle =>
    ({
      sceneId: document.scene_id,
      sceneVersion: document.scene_version,
      mediaSources: [],
      compositionFrame: {} as VisionSceneHandle["compositionFrame"],
      applyPatch: vi.fn(async () => {}),
      resize: vi.fn(async () => {}),
      activate: vi.fn(),
      updateMedia: vi.fn(async () => {}),
      clearMedia: vi.fn(async () => {}),
      dispose: vi.fn(),
    }) as VisionSceneHandle;
  const handleA = visionScene(sceneA);
  const handleB = visionScene(sceneB);
  const mountOptions = options();
  const frames = {
    projectComposition: (handle: VisionSceneHandle) =>
      handle === handleB ? projectionB : projectionA,
  } as unknown as NativeSceneFrames;
  const recovered = vi.fn();
  const session = new NativeCompositionSession(
    mountOptions,
    undefined,
    recovered,
    peerFactory(state, peers),
  );

  session.start("token-a");
  session.acceptDocument(sceneA, handleA, frames, nativeTreeHash(sceneA));
  await vi.waitFor(() =>
    expect(state.graphs.A?.source.scene_id).toBe("scene-a"),
  );
  expect(recovered).not.toHaveBeenCalled();

  const disconnectError = new Error("composition peer disconnected");
  peers[0]?.onClose?.(disconnectError);
  expect(mountOptions.onError).toHaveBeenCalledWith(
    expect.objectContaining({
      code: "NATIVE_COMPOSITION_FAILED",
      message: "Native composition: composition peer disconnected",
      recoverable: true,
    }),
  );
  expect(session.project(handleB, frames)).toBe(projectionB);
  session.acceptDocument(sceneB, handleB, frames, nativeTreeHash(sceneB));
  expect(state.graphs.A?.source.scene_id).toBe("scene-a");
  expect(session.currentProjection).toBe(projectionB);

  session.start("token-b");
  await vi.waitFor(() =>
    expect(state.graphs.A?.source.scene_id).toBe("scene-b"),
  );
  expect(state.graphs.A?.source.stateHash).toBe(nativeTreeHash(sceneB));
  expect(state.graphs.A?.viewport.width).toBe(800);
  expect(peers.map(({ authToken }) => authToken)).toEqual([
    "token-a",
    "token-b",
  ]);
  expect(recovered).toHaveBeenCalledOnce();

  session.retire();
  await vi.waitFor(() => expect(state.graphs.A).toBeUndefined());
});

it("refuses to accept a receipt from a different scene identity", () => {
  const session = new NativeCompositionSession(options());
  const documentA = scene("scene-a", "a");
  const documentB = scene("scene-b", "b");
  const handle: VisionSceneHandle = {
    sceneId: documentA.scene_id,
    sceneVersion: documentA.scene_version,
    mediaSources: [],
    compositionFrame: {} as VisionSceneHandle["compositionFrame"],
    applyPatch: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    activate: vi.fn(),
    updateMedia: vi.fn(async () => {}),
    clearMedia: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const frames = {
    projectComposition: vi.fn(() => projection(640)),
  } as unknown as NativeSceneFrames;

  expect(() =>
    session.acceptDocument(
      documentB,
      handle,
      frames,
      nativeTreeHash(documentB),
    ),
  ).toThrow("NATIVE_COMPOSITION_SCENE_IDENTITY_MISMATCH");
  expect(frames.projectComposition).not.toHaveBeenCalled();
  expect(session.currentProjection).toBeNull();
  session.retire();
});
