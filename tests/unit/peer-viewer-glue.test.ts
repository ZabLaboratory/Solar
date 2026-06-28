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
  registryResolve,
  join,
  leave,
} = vi.hoisted(() => {
  const resolvePeerStream = vi.fn(() => null);
  const subscribePeerStream = vi.fn(() => () => undefined);
  // A minimal `peer_label`-keyed registry the slot-binding view wraps on the
  // antenne path. `registryResolve` lets a test assert slotRef → peer_label
  // translation without a real WebRTC stack.
  const registryResolve = vi.fn((_peerLabel: string): unknown => null);
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
      registry: {
        resolve: registryResolve,
        subscribe: vi.fn((_l: string, cb: (s: unknown) => void) => {
          cb(null);
          return () => undefined;
        }),
        set: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
      },
    })),
    resolvePeerStream,
    subscribePeerStream,
    registryResolve,
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
const LSDP_GLOBAL = "__ZAB_LSDP_PEER_VIEWER__";

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
  delete (globalThis as Record<string, unknown>)[LSDP_GLOBAL];
});

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[PEER_GLOBAL];
  delete (globalThis as Record<string, unknown>)[LSDP_GLOBAL];
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

  it("does NOT create a viewer at mount when the global is absent (antenne)", () => {
    mount(baseOptions());
    // No mount-time creds → no viewer yet, but the antenne controller's slot-aware
    // resolvers + the reserved-leaf hook ARE threaded so the runtime can light the
    // `x-zab.meet-peer` path up once Orion's LSDP delivers the creds.
    expect(createPeerViewerFromInjection).not.toHaveBeenCalled();
    const runtimeOpts = runtimeOptsOf();
    expect(typeof runtimeOpts.resolvePeerStream).toBe("function");
    expect(typeof runtimeOpts.subscribePeerStream).toBe("function");
    expect(typeof runtimeOpts.onReservedLeaves).toBe("function");
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

  it("threads the RAW resolvers on the preview-only path (byte-identical)", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "meet-a", token: "tok-a" },
      ],
    };
    mount(baseOptions());
    const runtimeOpts = runtimeOptsOf();
    // No LSDP source → raw viewer resolvers, NOT the slot-aware wrapper.
    expect(runtimeOpts.resolvePeerStream).toBe(resolvePeerStream);
    expect(runtimeOpts.subscribePeerStream).toBe(subscribePeerStream);
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

describe("peer-viewer glue — second LSDP source + slotRef re-keying (antenne)", () => {
  it("reads viewer creds from the LSDP global without Prism (antenne)", () => {
    (globalThis as Record<string, unknown>)[LSDP_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" },
      ],
    };
    mount(baseOptions());
    expect(createPeerViewerFromInjection).toHaveBeenCalledWith({
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" },
      ],
    });
  });

  it("threads the SLOT-AWARE resolvers when the LSDP source is present", () => {
    (globalThis as Record<string, unknown>)[LSDP_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" },
      ],
    };
    mount(baseOptions());
    const runtimeOpts = runtimeOptsOf();
    // The wrapper, NOT the raw viewer resolver identity.
    expect(runtimeOpts.resolvePeerStream).not.toBe(resolvePeerStream);
    expect(typeof runtimeOpts.resolvePeerStream).toBe("function");
    expect(typeof runtimeOpts.subscribePeerStream).toBe("function");
  });

  it("resolves slotRef → peer_label → track via the LSDP slot snapshot", () => {
    const cam = { id: "cam-1" } as unknown as MediaStream;
    registryResolve.mockImplementation((label: string) => (label === "alice" ? cam : null));
    (globalThis as Record<string, unknown>)[LSDP_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" },
      ],
      slots: { "cam-caster-1": "alice" },
    };
    mount(baseOptions());
    const resolve = runtimeOptsOf().resolvePeerStream as (k: string) => unknown;
    // The runtime hands the node's slotRef ; the wrapper translates to peer_label.
    expect(resolve("cam-caster-1")).toBe(cam);
    expect(registryResolve).toHaveBeenCalledWith("alice");
  });

  it("renders the placeholder (null) for an unbound slot", () => {
    registryResolve.mockReturnValue(null);
    (globalThis as Record<string, unknown>)[LSDP_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" },
      ],
    };
    mount(baseOptions());
    const resolve = runtimeOptsOf().resolvePeerStream as (k: string) => unknown;
    expect(resolve("cam-unbound")).toBeNull();
  });

  it("merges preview + LSDP rooms and de-dups by roomId", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "shared", token: "preview-tok" },
        { signalingUrl: "wss://meet.example/ws", roomId: "preview-only", token: "p-tok" },
      ],
    };
    (globalThis as Record<string, unknown>)[LSDP_GLOBAL] = {
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "shared", token: "lsdp-tok" },
        { signalingUrl: "wss://meet.example/ws", roomId: "antenne-only", token: "a-tok" },
      ],
    };
    mount(baseOptions());
    expect(createPeerViewerFromInjection).toHaveBeenCalledWith({
      rooms: [
        { signalingUrl: "wss://meet.example/ws", roomId: "shared", token: "preview-tok" },
        { signalingUrl: "wss://meet.example/ws", roomId: "preview-only", token: "p-tok" },
        { signalingUrl: "wss://meet.example/ws", roomId: "antenne-only", token: "a-tok" },
      ],
    });
  });

  it("ignores a malformed LSDP global (no usable room)", () => {
    (globalThis as Record<string, unknown>)[LSDP_GLOBAL] = {
      rooms: [{ signalingUrl: "wss://meet.example/ws", token: "no-room-id" }],
    };
    mount(baseOptions());
    expect(createPeerViewerFromInjection).not.toHaveBeenCalled();
  });
});

describe("peer-viewer glue — runtime onReservedLeaves hook (antenne, 0.11.0)", () => {
  /** Pull the reserved-leaf sink the (mocked) runtime mount was handed. */
  function hookOf(): (leaves: { viewer?: unknown; slots: Record<string, string> }) => void {
    const fn = runtimeOptsOf().onReservedLeaves;
    expect(typeof fn).toBe("function");
    return fn as (leaves: { viewer?: unknown; slots: Record<string, string> }) => void;
  }

  it("arms the receive-only viewer from leaves.viewer (no mount-time global)", () => {
    mount(baseOptions());
    expect(createPeerViewerFromInjection).not.toHaveBeenCalled();

    hookOf()({
      viewer: {
        rooms: [{ signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" }],
      },
      slots: {},
    });

    // The hook arms the viewer + joins RECEIVE-ONLY (never publishes).
    expect(createPeerViewerFromInjection).toHaveBeenCalledWith({
      rooms: [{ signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" }],
    });
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("resolves slotRef → peer_label → track once armed by the hook", () => {
    const cam = { id: "cam-1" } as unknown as MediaStream;
    registryResolve.mockImplementation((label: string) => (label === "alice" ? cam : null));
    mount(baseOptions());

    hookOf()({
      viewer: {
        rooms: [{ signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" }],
      },
      slots: { "cam-caster-1": "alice" },
    });

    const resolve = runtimeOptsOf().resolvePeerStream as (k: string) => unknown;
    expect(resolve("cam-caster-1")).toBe(cam);
    expect(registryResolve).toHaveBeenCalledWith("alice");
    // An unbound slot → placeholder (null), never the wrong cam.
    expect(resolve("cam-unbound")).toBeNull();
  });

  it("reconciles the snapshot : a slot dropped from leaves.slots is released", () => {
    const cam = { id: "cam-1" } as unknown as MediaStream;
    registryResolve.mockImplementation((label: string) => (label === "alice" ? cam : null));
    mount(baseOptions());
    const hook = hookOf();

    hook({
      viewer: {
        rooms: [{ signalingUrl: "wss://meet.example/ws", roomId: "antenne-a", token: "lsdp-tok" }],
      },
      slots: { "cam-caster-1": "alice" },
    });
    const resolve = runtimeOptsOf().resolvePeerStream as (k: string) => unknown;
    expect(resolve("cam-caster-1")).toBe(cam);

    // Newer snapshot no longer carries cam-caster-1 → it must unbind (placeholder).
    hook({ slots: {} });
    expect(resolve("cam-caster-1")).toBeNull();
  });

  it("reconciles the live room set on a later emission via setRooms", () => {
    const viewer = {
      join,
      leave,
      resolvePeerStream,
      subscribePeerStream,
      setRooms: vi.fn(() => Promise.resolve()),
      registry: { resolve: registryResolve, subscribe: vi.fn(() => () => undefined), set: vi.fn(), remove: vi.fn(), clear: vi.fn() },
    };
    createPeerViewerFromInjection.mockReturnValueOnce(viewer);
    mount(baseOptions());
    const hook = hookOf();

    hook({
      viewer: { rooms: [{ signalingUrl: "wss://meet.example/ws", roomId: "a", token: "t1" }] },
      slots: {},
    });
    expect(createPeerViewerFromInjection).toHaveBeenCalledTimes(1);

    hook({
      viewer: { rooms: [{ signalingUrl: "wss://meet.example/ws", roomId: "b", token: "t2" }] },
      slots: {},
    });
    // A second viewer is NOT created — the existing one reconciles its room set.
    expect(createPeerViewerFromInjection).toHaveBeenCalledTimes(1);
    expect(viewer.setRooms).toHaveBeenCalledWith([
      { signalingUrl: "wss://meet.example/ws", roomId: "b", token: "t2" },
    ]);
  });

  it("does nothing for a leaves emission with no usable viewer creds", () => {
    mount(baseOptions());
    hookOf()({ slots: { "cam-caster-1": "alice" } });
    // Slots without creds can't arm the viewer — stays inert until creds arrive.
    expect(createPeerViewerFromInjection).not.toHaveBeenCalled();
  });

  it("is NOT registered on the preview path (frozen)", () => {
    (globalThis as Record<string, unknown>)[PEER_GLOBAL] = {
      rooms: [{ signalingUrl: "wss://meet.example/ws", roomId: "meet-a", token: "tok-a" }],
    };
    mount(baseOptions());
    expect(runtimeOptsOf().onReservedLeaves).toBeUndefined();
  });
});
