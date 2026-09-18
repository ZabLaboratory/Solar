// Live-audio opt-in proof for the served bundle (@lumencast/runtime ≥ 0.13.0,
// MountOptions.liveAudio). The guest-audio bug is that a `meet.peer` /
// `x-zab.meet-peer` peer's `<video>` renders MUTED, so a Pulsar/OBS
// browser_source captures no guest audio into the on-air / recording mix.
//
// The contract under test — asserted at the REAL entry boundary, not a pure
// helper: the page SERVED by `src/host-entry.tsx` (antenne / REC / CEF atlas)
// opts in with `liveAudio: true` for the diffused/recorded modes, while
// `src/dev-entry.tsx` (the interactive Prism editor preview) does NOT — it must
// stay at the muted default so an operator with the same room open elsewhere
// never gets audio feedback/echo. `control` is Solar's interactive operator
// view and is excluded on the host too.
//
// Each entry runs its bootstrap side-effects at import: read
// `window.location.search`, grab `#scene`, call `mount()`. We mock `./mount`,
// stage the URL + target, then import the entry and inspect the captured
// options.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MountOptions } from "../../src/types";

const { mountSpy } = vi.hoisted(() => ({ mountSpy: vi.fn() }));

// Replace Solar's own mount() so importing an entry never touches the runtime,
// the LSDP transport or the peer-viewer glue — we only capture what the entry
// forwards. Both the entry's `./mount` and this `../../src/mount` resolve to the
// same module id, so the mock applies to the entry's import.
vi.mock("../../src/mount", () => ({
  mount: mountSpy,
}));

function stage(search: string): void {
  const normalized = search.startsWith("?")
    ? search
    : search
      ? `?${search}`
      : "";
  const withLocalOrion = normalized.includes("orion=")
    ? normalized
    : `${normalized}${normalized ? "&" : "?"}orion=${encodeURIComponent("ws://127.0.0.1:4317/api/v1/show/stream.lsdp")}`;
  window.history.replaceState({}, "", `/${withLocalOrion}`);
  document.body.innerHTML = '<div id="scene"></div>';
}

function lastOptions(): MountOptions {
  expect(mountSpy).toHaveBeenCalledTimes(1);
  return mountSpy.mock.calls[0]![0] as MountOptions;
}

beforeEach(() => {
  mountSpy.mockReset();
  mountSpy.mockReturnValue({ disconnect: vi.fn(), setToken: vi.fn() });
  vi.resetModules(); // entries run once per module instance — re-import fresh
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("host-entry.tsx — served bundle opts into live guest audio", () => {
  it("uses an atomic transition on the persistent local Preview wire", async () => {
    stage(
      `?orion=${encodeURIComponent("ws://127.0.0.1:4317/api/v1/show/preview.lsdp")}&editable_fast=1`,
    );
    await import("../../src/host-entry");
    expect(lastOptions().sceneTransition).toBe("cut");
    expect(lastOptions().onSceneCommit).toBeUndefined();
  });
  it("passes liveAudio: true on the on-air broadcast render", async () => {
    stage("?mode=broadcast");
    await import("../../src/host-entry");
    expect(lastOptions().liveAudio).toBe(true);
    expect(lastOptions().sceneTransition).toBeUndefined();
    expect(lastOptions().onSceneCommit).toBeUndefined();
  });

  it("passes liveAudio: true on the REC/test render (recorded)", async () => {
    stage("?mode=test&scene=scene-42&session=uuid-1");
    await import("../../src/host-entry");
    const opts = lastOptions();
    expect(opts.mode).toBe("test");
    expect(opts.liveAudio).toBe(true);
  });

  it("keeps guest audio MUTED in the interactive control mode (echo risk)", async () => {
    stage("?mode=control");
    await import("../../src/host-entry");
    expect(lastOptions().liveAudio).toBe(false);
  });

  it("uses the safe broadcast default for an unknown mode and logs both error severities", async () => {
    stage("?mode=not-a-solar-mode");
    await import("../../src/host-entry");
    const opts = lastOptions();
    expect(opts.mode).toBe("broadcast");
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    opts.onError?.({
      code: "INTERNAL",
      message: "recoverable",
      recoverable: true,
    });
    opts.onError?.({ code: "INTERNAL", message: "fatal", recoverable: false });

    expect(error).toHaveBeenNthCalledWith(
      1,
      "[solar] INTERNAL: recoverable (recoverable)",
    );
    expect(error).toHaveBeenNthCalledWith(2, "[solar] INTERNAL: fatal (fatal)");
    error.mockRestore();
  });

  it("falls back to broadcast when the mode query is absent", async () => {
    stage("");
    await import("../../src/host-entry");
    expect(lastOptions().mode).toBe("broadcast");
  });

  it("reports a missing scene target before mounting", async () => {
    window.history.replaceState(
      {},
      "",
      `/?orion=${encodeURIComponent("ws://127.0.0.1:4317/api/v1/show/stream.lsdp")}`,
    );
    document.body.innerHTML = "";
    await expect(import("../../src/host-entry")).rejects.toThrow(
      /#scene target missing/,
    );
    expect(mountSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the caller omits the local Orion URL", async () => {
    window.history.replaceState({}, "", "/?mode=broadcast");
    document.body.innerHTML = '<div id="scene"></div>';
    await expect(import("../../src/host-entry")).rejects.toThrow(
      /SOLAR_LOCAL_ORION_REQUIRED/,
    );
    expect(mountSpy).not.toHaveBeenCalled();
  });
});

describe("dev-entry.tsx — interactive editor stays muted by default", () => {
  it("never passes liveAudio (broadcast preview)", async () => {
    stage("?mode=broadcast");
    await import("../../src/dev-entry");
    const opts = lastOptions();
    // The key must be ABSENT — the muted default — not merely falsy, so the
    // runtime keeps its byte-identical no-opt-in behaviour for the editor.
    expect("liveAudio" in opts).toBe(false);
  });

  it("never passes liveAudio (test preview)", async () => {
    stage("?mode=test&scene=scene-42&session=uuid-1");
    await import("../../src/dev-entry");
    expect("liveAudio" in lastOptions()).toBe(false);
  });

  it("uses the safe broadcast default for an unknown mode and logs both error severities", async () => {
    stage("?mode=not-a-solar-mode");
    await import("../../src/dev-entry");
    const opts = lastOptions();
    expect(opts.mode).toBe("broadcast");
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    opts.onError?.({
      code: "INTERNAL",
      message: "recoverable",
      recoverable: true,
    });
    opts.onError?.({ code: "INTERNAL", message: "fatal", recoverable: false });

    expect(error).toHaveBeenNthCalledWith(
      1,
      "[solar dev] INTERNAL: recoverable (recoverable)",
    );
    expect(error).toHaveBeenNthCalledWith(
      2,
      "[solar dev] INTERNAL: fatal (fatal)",
    );
    error.mockRestore();
  });

  it("falls back to broadcast when the mode query is absent", async () => {
    stage("");
    await import("../../src/dev-entry");
    expect(lastOptions().mode).toBe("broadcast");
  });

  it("reports a missing scene target before mounting", async () => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = "";
    await expect(import("../../src/dev-entry")).rejects.toThrow(
      /#scene target missing/,
    );
    expect(mountSpy).not.toHaveBeenCalled();
  });
});
