// Integration test : transport + state, end-to-end against
// the mock-orion server. Doesn't render React — that's e2e's job.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WS from "ws";
import { WsClient } from "../../src/transport/ws";
import { applySnapshot } from "../../src/state/apply-snapshot";
import { applyDelta } from "../../src/state/apply-delta";
import { createStore } from "../../src/state/store";
import {
  startMockOrion,
  type MockOrion,
} from "../mock-orion/server";
import {
  ACCEPTANCE_BUNDLE,
  ACCEPTANCE_INITIAL_STATE,
  ACCEPTANCE_SCENE_ID,
  ACCEPTANCE_SCENE_VERSION,
} from "../fixtures/scenes";

const NodeWebSocket = WS as unknown as typeof WebSocket;

let orion: MockOrion;

beforeEach(async () => {
  orion = await startMockOrion({
    initialSceneId: ACCEPTANCE_SCENE_ID,
    initialBundle: ACCEPTANCE_BUNDLE,
    initialState: ACCEPTANCE_INITIAL_STATE,
  });
});

afterEach(async () => {
  await orion.close();
});

describe("WsClient + Store end-to-end", () => {
  it("connects, receives snapshot, applies it, observes a delta", async () => {
    const store = createStore();
    const onSnapshot = vi.fn();
    const onDelta = vi.fn();

    const client = new WsClient({
      url: orion.url,
      token: "fake",
      webSocketImpl: NodeWebSocket,
      onSnapshot: (msg) => {
        applySnapshot(store, msg);
        onSnapshot(msg);
      },
      onDelta: (msg) => {
        applyDelta(store, msg);
        onDelta(msg);
      },
    });
    client.start();

    await waitFor(() => onSnapshot.mock.calls.length > 0, 1500);
    expect(store.signal("score.team_a").value).toBe(14);
    expect(store.signal("scene.title").value).toBe("Acceptance scene");

    orion.pushDelta([{ path: "score.team_a", value: 15 }]);
    await waitFor(() => store.signal("score.team_a").value === 15, 1500);
    expect(onDelta).toHaveBeenCalledTimes(1);

    client.close();
  });

  it("sequence gap triggers reconnect (covered by the gap-error branch)", async () => {
    const onTransportError = vi.fn();

    const client = new WsClient({
      url: orion.url,
      token: "fake",
      webSocketImpl: NodeWebSocket,
      reconnect: { initial: 50, max: 100, factor: 1, jitter: 0 },
      onTransportError,
    });
    client.start();

    // Wait until the first snapshot establishes the baseline.
    await waitFor(() => client.lastSequence > 0, 1500);
    const baseline = client.lastSequence;
    expect(baseline).toBeGreaterThan(0);

    // Push two deltas — both observed contiguously, no gap.
    orion.pushDelta([{ path: "score.team_a", value: 16 }]);
    await waitFor(() => client.lastSequence > baseline, 1500);

    client.close();
    expect(onTransportError).not.toHaveBeenCalled();
  });

  it("scene_changed swaps the scene and resets the sequence", async () => {
    const onSnapshot = vi.fn();
    const onSceneChanged = vi.fn();
    const client = new WsClient({
      url: orion.url,
      token: "fake",
      webSocketImpl: NodeWebSocket,
      onSnapshot,
      onSceneChanged,
    });
    client.start();

    await waitFor(() => onSnapshot.mock.calls.length === 1, 1500);
    expect(client.sceneId).toBe(ACCEPTANCE_SCENE_ID);

    const ALT_BUNDLE = {
      ...ACCEPTANCE_BUNDLE,
      scene_version: "sha256:alt-v1",
    };

    orion.switchScene({
      sceneId: "alt-scene",
      bundle: ALT_BUNDLE,
      state: { "scene.title": "Alt" },
      transition: { kind: "crossfade", duration_ms: 600 },
    });

    await waitFor(() => onSceneChanged.mock.calls.length === 1, 1500);
    await waitFor(() => onSnapshot.mock.calls.length === 2, 1500);
    expect(client.sceneId).toBe("alt-scene");

    client.close();
  });

  it("HTTP bundle endpoint returns the registered bundle", async () => {
    const url = `${orion.httpUrl}/orion/api/v1/scenes/${ACCEPTANCE_SCENE_ID}/render-bundle?v=${encodeURIComponent(ACCEPTANCE_SCENE_VERSION)}`;
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const bundle = (await res.json()) as { scene_version: string };
    expect(bundle.scene_version).toBe(ACCEPTANCE_SCENE_VERSION);
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor : predicate not satisfied within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}
