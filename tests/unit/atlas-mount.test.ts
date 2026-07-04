// Wiring proof for the `?atlas=` render mode (ADR 013 Prism §3.1, issue #41).
//
// Two seams under test, both at the REAL mount boundary (not the pure #38/#39
// functions in isolation):
//
//   1. `atlasMountOptions(search)` — the host-entry helper that reads `?atlas=`
//      and produces the `transformRoot` slice of MountOptions. The load-bearing
//      contract is KEY ABSENCE when atlas mode is off (issue #41 criterion 1):
//      the returned object must NOT carry a `transformRoot` key, so spreading it
//      into `mount()` leaves the render path byte-identical to today.
//
//   2. `mount()` → runtime forwarding — Solar's mount must hand `transformRoot`
//      through to `@lumencast/runtime`'s mount VERBATIM when present, and OMIT
//      the key entirely when absent. Asserted by mocking the runtime mount and
//      inspecting the captured options (`'transformRoot' in opts`), exactly the
//      "mount() called WITHOUT the transformRoot key" check the issue asks for.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderNode } from "@lumencast/runtime";

const { mountSpy } = vi.hoisted(() => ({ mountSpy: vi.fn() }));

// Keep every real runtime export (createPeerViewerFromInjection, types, …) and
// override only `mount` so we can capture the options Solar forwards.
vi.mock("@lumencast/runtime", async (orig) => {
  const actual = await orig<typeof import("@lumencast/runtime")>();
  return { ...actual, mount: mountSpy };
});

import { mount } from "../../src/mount";
import { atlasMountOptions } from "../../src/internal/atlas-mount";
import type { MountOptions } from "../../src/types";

// A composed scene root with exactly ONE native-capture separator → 2 z-bands,
// matching `?atlas=below,above`.
const rootWithOneCapture: RenderNode = {
  kind: "stack",
  children: [
    { kind: "frame", id: "below-box", props: { width: 400, height: 200 } },
    { kind: "x-zab.capture", id: "cam", props: { width: 1920, height: 1080 } },
    { kind: "frame", id: "above-box", props: { width: 300, height: 150 } },
  ],
};

// A root with NO capture separator → 1 z-band. Feeding it to a 2-band spec is
// the N-mismatch the transform must throw on.
const rootNoCapture: RenderNode = {
  kind: "stack",
  children: [{ kind: "frame", id: "solo", props: { width: 100, height: 100 } }],
};

describe("atlasMountOptions() — entry wiring", () => {
  it("omits transformRoot entirely when ?atlas= is absent (non-regression)", () => {
    const opts = atlasMountOptions("?mode=broadcast");
    // Key ABSENCE, not `{ transformRoot: undefined }` — the spread must leave
    // MountOptions untouched.
    expect("transformRoot" in opts).toBe(false);
  });

  it("omits transformRoot when ?atlas= is malformed (parse → null)", () => {
    expect("transformRoot" in atlasMountOptions("?atlas=,")).toBe(false);
    expect("transformRoot" in atlasMountOptions("?atlas=below,below")).toBe(
      false,
    );
  });

  it("binds transformRoot to buildAtlasRoot for a valid ?atlas= spec", () => {
    const opts = atlasMountOptions("?atlas=below,above");
    expect(typeof opts.transformRoot).toBe("function");

    const out = opts.transformRoot!(rootWithOneCapture);
    // Real buildAtlasRoot applied: a 1920×2160 atlas stage wrapping 2 band
    // frames keyed by the requested labels.
    expect(out.id).toBe("atlas-root");
    expect(out.props?.height).toBe(2160);
    const bandIds = (out.children ?? []).map((c) => c.id);
    expect(bandIds).toEqual(["atlas-band-below", "atlas-band-above"]);
  });

  it("lets the buildAtlasRoot N-mismatch throw through the closure (no silent fail)", () => {
    const opts = atlasMountOptions("?atlas=below,above");
    // Scene has 0 separators → 1 band, spec declared 2 → visible throw.
    expect(() => opts.transformRoot!(rootNoCapture)).toThrow(
      /scene has 0 native capture separator/,
    );
  });
});

describe("mount() forwards transformRoot to @lumencast/runtime", () => {
  const base: MountOptions = {
    target: document.createElement("div"),
    orionUrl: "wss://gate.example/orion/api/v1/show/stream",
    token: "fake-token",
    mode: "broadcast",
  };

  beforeEach(() => {
    mountSpy.mockReset();
    mountSpy.mockReturnValue({ disconnect: vi.fn(), setToken: vi.fn() });
  });

  it("calls the runtime WITHOUT a transformRoot key when the host omits it", () => {
    mount({ ...base });
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const opts = mountSpy.mock.calls[0]![0] as Record<string, unknown>;
    // The exact non-regression assertion: the key is absent from the options
    // the runtime receives, not merely `undefined`.
    expect("transformRoot" in opts).toBe(false);
  });

  it("forwards the transformRoot closure verbatim when the host provides it", () => {
    mount({ ...base, ...atlasMountOptions("?atlas=below,above") });
    const opts = mountSpy.mock.calls[0]![0] as {
      transformRoot?: (r: RenderNode) => RenderNode;
    };
    expect("transformRoot" in opts).toBe(true);

    // The forwarded closure is the real atlas transform, wired to the parsed
    // spec — applying it splits the scene into the declared bands.
    const out = opts.transformRoot!(rootWithOneCapture);
    expect(out.id).toBe("atlas-root");
    expect((out.children ?? []).length).toBe(2);
  });
});
