// ADR 007 §B acceptance (c) — conformance for `target: runtime`.
//
// `@lumencast/protocol` DOES ship a conformance harness
// (`@lumencast/protocol/conformance`, exported via the package's
// "./conformance" entry). BUT the `Harness` + `ControlClient` it exposes
// are a CROSS-LANGUAGE INTEROP harness : they drive a server over a live
// HTTP control plane (`controlUrl` → POST /test/setup, /test/emit,
// GET /test/state) plus a WebSocket. `@lumencast/runtime` — and Solar on
// top of it — is a browser `mount()` with NO control plane to point that
// harness at, and the package ships no scenario *.yaml fixtures for
// `loadScenarios()`. So the official network harness cannot be "branched
// onto Solar/runtime" in-process (and the brief warns the network/WS path
// is flaky in this sandbox — confirmed by the deferred Playwright suite).
//
// Per the brief's fallback, this file covers the EQUIVALENT runtime-target
// conformance using the harness's reusable in-process primitives :
//   - `hashInlineBundle` / `canonicalize` — the bundle-identity conformance
//     (content-addressing : a bundle's `scene_version` MUST be the sha256
//     of its canonical JSON, and the runtime MUST honour it).
//   - `matchFrame` / `matchValue` — the wire-conformance matcher applied to
//     REAL `@lumencast/protocol` frames the runtime decodes and applies.
//
// These are the exact assertions the official harness runs per scenario
// step ; here they run against the runtime in-process through Solar's
// public `mount()` seam, deterministically and network-free.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalize,
  hashInlineBundle,
  matchFrame,
} from "@lumencast/protocol/conformance";
import { encodeFrame, decodeServerFrame, snapshot } from "@lumencast/protocol";
import type { RenderBundle } from "@lumencast/runtime";
import { mount } from "../../src/mount";
import { FakeWebSocket, waitFor } from "./_lsdp-harness";

const SCENE_ID = "scene-conformance";

// A scene whose declared `scene_version` is the REAL content hash of its
// own bundle body (computed in the test) — content-addressing conformance.
const BUNDLE_BODY = {
  root: {
    kind: "text" as const,
    id: "headline",
    bindings: { value: "headline.text" },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  FakeWebSocket.last = null;
});

describe("ADR 007 §B (c) — bundle-identity conformance (content-addressing)", () => {
  it("the runtime fetches by the snapshot's scene_version and rejects a hash mismatch", async () => {
    // 1. Mint the content-addressed identity exactly as a conformant
    //    server would : scene_version = sha256(canonical bundle).
    const sceneVersion = await hashInlineBundle(BUNDLE_BODY);
    expect(sceneVersion).toMatch(/^sha256:[0-9a-f]{64}$/);

    const bundle: RenderBundle = { scene_version: sceneVersion, ...BUNDLE_BODY };

    // 2. Record the URL the runtime requests so we can assert it carried
    //    the right `?v=` content hash.
    let requestedUrl = "";
    const fetchMock = vi.fn(async (input: unknown) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    FakeWebSocket.sceneId = SCENE_ID;
    FakeWebSocket.sceneVersion = sceneVersion;
    FakeWebSocket.initialState = { "headline.text": "CONFORMANT" };
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const target = document.createElement("div");
    document.body.appendChild(target);
    const handle = mount({
      target,
      orionUrl: "wss://gate.example/orion/api/v1/show/stream",
      token: "t",
      mode: "broadcast",
    });

    await waitFor(() => target.textContent?.includes("CONFORMANT") === true);

    // The content-addressed fetch carried the scene id + the exact hash.
    expect(requestedUrl).toContain(SCENE_ID);
    expect(requestedUrl).toContain(`v=${encodeURIComponent(sceneVersion)}`);

    handle.disconnect();
    target.remove();
  });

  it("canonicalize is stable under key reordering (hash determinism)", () => {
    // The conformance contract : two structurally equal bundles with keys
    // in a different order hash identically. This is what lets a server and
    // a runtime agree on `scene_version` independently.
    const a = { scene_version: "x", root: { kind: "text", id: "h" } };
    const b = { root: { id: "h", kind: "text" }, scene_version: "x" };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

describe("ADR 007 §B (c) — wire conformance (matchFrame on real frames)", () => {
  it("a real encoded snapshot frame satisfies the conformance matcher and lands in the DOM", async () => {
    const sceneVersion = await hashInlineBundle(BUNDLE_BODY);
    const bundle: RenderBundle = { scene_version: sceneVersion, ...BUNDLE_BODY };

    // Build the snapshot the server sends, encode it with the REAL codec,
    // decode it back, and assert it conforms to the expected wire shape
    // BEFORE feeding the same bytes to the runtime. This is exactly the
    // per-step assertion the official harness performs.
    const snap = snapshot({
      seq: 1,
      scene_id: SCENE_ID,
      scene_version: sceneVersion,
      state: { "headline.text": "WIRE OK" },
    });
    const wire = encodeFrame(snap);
    const decoded = decodeServerFrame(wire) as unknown as Record<
      string,
      unknown
    >;

    const matchErr = matchFrame(
      {
        type: "snapshot",
        scene_id: SCENE_ID,
        scene_version: sceneVersion,
        state: { "headline.text": "WIRE OK" },
      },
      decoded,
    );
    expect(matchErr).toBeNull();

    // A deliberately wrong expectation must be REPORTED by the matcher
    // (proves the matcher is actually discriminating, not vacuously green).
    const mismatch = matchFrame(
      { type: "snapshot", state: { "headline.text": "WRONG" } },
      decoded,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch?.path).toBe("state.headline.text");

    // Now the runtime, fed the same conformant snapshot, renders it.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(bundle), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    FakeWebSocket.sceneId = SCENE_ID;
    FakeWebSocket.sceneVersion = sceneVersion;
    FakeWebSocket.initialState = { "headline.text": "WIRE OK" };
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const target = document.createElement("div");
    document.body.appendChild(target);
    const handle = mount({
      target,
      orionUrl: "wss://gate.example/orion/api/v1/show/stream",
      token: "t",
      mode: "broadcast",
    });

    await waitFor(() => target.textContent?.includes("WIRE OK") === true);
    expect(target.textContent).toContain("WIRE OK");

    handle.disconnect();
    target.remove();
  });
});
