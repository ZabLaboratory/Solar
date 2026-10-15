import { afterEach, describe, expect, it } from "vitest";

import {
  readPeerViewerChannel,
  readReservedPeerLeaves,
  ZAB_PEER_VIEWER_CHANNEL_GLOBAL,
} from "../../src/peer-viewer/injection";

describe("Prism local Solar peer-viewer channel", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[
      ZAB_PEER_VIEWER_CHANNEL_GLOBAL
    ];
  });

  it("accepts only the authenticated loopback reconciliation path", () => {
    (globalThis as Record<string, unknown>)[ZAB_PEER_VIEWER_CHANNEL_GLOBAL] = {
      url: "ws://127.0.0.1:43123/preview/peer-viewer?token=local",
    };

    expect(readPeerViewerChannel()).toEqual({
      url: "ws://127.0.0.1:43123/preview/peer-viewer?token=local",
    });
  });

  it("rejects non-loopback or non-Preview channels", () => {
    const global = globalThis as Record<string, unknown>;
    global[ZAB_PEER_VIEWER_CHANNEL_GLOBAL] = {
      url: "ws://remote.example/preview/peer-viewer",
    };
    expect(readPeerViewerChannel()).toBeNull();

    global[ZAB_PEER_VIEWER_CHANNEL_GLOBAL] = {
      url: "ws://127.0.0.1:43123/scene/events",
    };
    expect(readPeerViewerChannel()).toBeNull();

    global[ZAB_PEER_VIEWER_CHANNEL_GLOBAL] = {
      url: "http://127.0.0.1:43123/preview/peer-viewer",
    };
    expect(readPeerViewerChannel()).toBeNull();
  });
});

it("projects native slots and tolerates malformed viewer JSON without mutating defaults", () => {
  const defaults = {
    "__cam.slots.main": "guest",
    "__cam.slots.empty": "",
    "__cam.viewer": "broken",
  };
  expect(readReservedPeerLeaves(defaults)).toEqual({
    slots: { main: "guest" },
  });
  expect(defaults["__cam.viewer"]).toBe("broken");
  expect(
    readReservedPeerLeaves({
      ...defaults,
      "__cam.viewer": JSON.stringify({ rooms: [] }),
    }),
  ).toEqual({ slots: { main: "guest" }, viewer: { rooms: [] } });
});
