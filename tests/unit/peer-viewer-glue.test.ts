// ADR 006 #3↔#4 glue — Solar's mount() reads the `__ZAB_PEER_VIEWER__` page
// global the Prism scene-server pins (FINAL MODEL : multi-room `{ rooms: [...] }`),
// joins EVERY room as a viewer, and threads the aggregated peer-stream resolvers
// into the runtime so LIVE `media` nodes render the matching peer's stream. The
// runtime is mocked so the test asserts the WIRING (injection pass-through,
// resolver threading, teardown) without a real WS.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mountRuntime,
  createPeerViewerFromInjection,
  resolvePeerStream,
  subscribePeerStream,
  join,
  leave,
} = vi.hoisted(() => {
  const resolvePeerStream = vi.fn(() => null);
  const subscribePeerStream = vi.fn(() => () => undefined);
  const join = vi.fn(() => Promise.resolve());
  const leave = vi.fn();
  return {
    mountRuntime: vi.fn(() => ({ disconnect: vi.fn(), setToken: vi.fn() })),
    createPeerViewerFromInjection: vi.fn(() => ({
      join,
      leave,
      resolvePeerStream,
      subscribePeerStream,
      setRooms: vi.fn(() => Promise.resolve()),
      registry: {},
    })),
    resolvePeerStream,
    subscribePeerStream,
    join,
    leave,
  };
});

vi.mock("@lumencast/runtime", () => ({
  mount: mountRuntime,
  createPeerViewerFromInjection,
}));

// Imported AFTER the mock is registered.
import { mount } from "../../src/mount";
import type { MountOptions } from "../../src/index";

const PEER_GLOBAL = "__ZAB_PEER_VIEWER__";

function baseOptions(over: Partial<MountOptions> = {}): MountOptions {
  return {
    target: document.createElement("div"),
    orionUrl: "wss://gate.example/orion/api/v1/show/stream",
    token: "fake-token",
    mode: "broadcast",
    ...over,
  };
}

/** Read the options the (mocked) runtime mount was called with — guarded so a
 *  zero-call situation fails with a clear message instead of a tuple error. */
function runtimeOptsOf(): Record<string, unknown> {
  const calls = mountRuntime.mock.calls as unknown as unknown[][];
  expect(calls.length).toBeGreaterThan(0);
  const first = calls[0] ?? [];
  return first[0] as Record<string, unknown>;
}

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, unknown>)[PEER_GLOBAL];
});

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[PEER_GLOBAL];
});

describe("peer-viewer glue (multi-room)", () => {
  it("passes a multi-room global straight through and threads the resolvers", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "meet-a", token: "tok-a" },
        { signalingUrl: "wss://meet.example/ws", roomId: "meet-b", token: "tok-b" },
      ],
    };

    mount(baseOptions());

    expect(createPeerViewerFromInjection).toHaveBeenCalledTimes(1);
    expect(createPeerViewerFromInjection).toHaveBeenCalledWith({
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "meet-a", token: "tok-a" },
        { signalingUrl: "wss://meet.example/ws", roomId: "meet-b", token: "tok-b" },
      ],
    });
    expect(join).toHaveBeenCalledTimes(1);

    const runtimeOpts = runtimeOptsOf();
    expect(runtimeOpts.resolvePeerStream).toBe(resolvePeerStream);
    expect(runtimeOpts.subscribePeerStream).toBe(subscribePeerStream);
  });

  it("wraps a legacy single-room global as a one-room array (back-compat)", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      signalingUrl: "wss://meet.example/ws",
      roomId: "meet-xyz",
      token: "room-tok",
    };

    mount(baseOptions());

    expect(createPeerViewerFromInjection).toHaveBeenCalledTimes(1);
    expect(createPeerViewerFromInjection).toHaveBeenCalledWith({
      rooms: [
        {
          signalingUrl: "wss://meet.example/ws",
          roomId: "meet-xyz",
          token: "room-tok",
        },
      ],
    });
  });

  it("drops malformed rooms and keeps usable ones", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", token: "no-room-id" },
        { signalingUrl: "wss://meet.example/ws", roomId: "meet-ok", token: "tok-ok" },
      ],
    };

    mount(baseOptions());

    expect(createPeerViewerFromInjection).toHaveBeenCalledWith({
      rooms: [
        {
          signalingUrl: "wss://meet.example/ws",
          roomId: "meet-ok",
          token: "tok-ok",
        },
      ],
    });
  });

  it("does NOT create a viewer when the global is absent", () => {
    mount(baseOptions());
    expect(createPeerViewerFromInjection).not.toHaveBeenCalled();
    const runtimeOpts = runtimeOptsOf();
    expect(runtimeOpts.resolvePeerStream).toBeUndefined();
    expect(runtimeOpts.subscribePeerStream).toBeUndefined();
  });

  it("does NOT create a viewer when rooms is present but all malformed", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      rooms: [{ signalingUrl: "wss://meet.example/ws", token: "no-room-id" }],
    };
    mount(baseOptions());
    expect(createPeerViewerFromInjection).not.toHaveBeenCalled();
  });

  it("ignores a malformed single-room global (missing roomId)", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      signalingUrl: "wss://meet.example/ws",
      token: "room-tok",
    };
    mount(baseOptions());
    expect(createPeerViewerFromInjection).not.toHaveBeenCalled();
  });

  it("tears the viewer down on disconnect", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "meet-xyz", token: "room-tok" },
      ],
    };
    const handle = mount(baseOptions());
    handle.disconnect();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("surfaces a join failure through onError without throwing", async () => {
    join.mockRejectedValueOnce(new Error("ws handshake failed"));
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "meet-xyz", token: "room-tok" },
      ],
    };
    const onError = vi.fn();
    expect(() => mount(baseOptions({ onError }))).not.toThrow();
    // Let the rejected join microtask settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INTERNAL", recoverable: true }),
    );
  });
});
