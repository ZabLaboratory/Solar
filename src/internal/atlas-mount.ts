// Host-entry wiring for the `?atlas=` render mode (ADR 013 Prism §3.1, issue
// #41). Reads the `?atlas=` URL query and, when atlas mode is requested,
// produces the `transformRoot` slice of `MountOptions` the host entries spread
// into their `mount()` call.
//
// This is the seam between the pure functions merged in #38/#39
// (`parseAtlasParam` + `buildAtlasRoot`) and the real mount point: the host
// entries (`dev-entry.tsx`, `host-entry.tsx`) are side-effectful modules that
// mount at import, so the testable wiring lives here and both entries share it
// verbatim (no per-host divergence in the atlas path).
//
// NON-REGRESSION CONTRACT. When `?atlas=` is absent / malformed (parse → null)
// this returns an EMPTY object — NOT `{ transformRoot: undefined }` and NOT a
// no-op transform. Spreading `{}` leaves the `transformRoot` key entirely
// absent from the `MountOptions` handed to `mount()`, so the runtime renders
// the fetched bundle verbatim, byte-identical to the pre-atlas path (issue #41
// resolution criterion 1; proven byte-identical on the default path in #39).
//
// The `buildAtlasRoot` throw on an N mismatch (the `?atlas=` band count vs the
// scene's `x-zab.capture` separators) is DELIBERATELY not caught here: it is
// carried by the closure and surfaces at first render, loud, per the ADR
// contract — a caller/scene-server bug, never a silent miscut frame.

import { parseAtlasParam } from "../atlas/atlas-param";
import { buildAtlasRoot } from "../atlas/atlas-node";
import type { MountOptions } from "../types";

/**
 * Derive the `transformRoot` mount option from a URL query string.
 *
 * @param search  `window.location.search` (with or without the leading `?`).
 * @returns `{ transformRoot }` bound to the parsed `?atlas=` spec when atlas
 *          mode is requested, or `{}` (no `transformRoot` key) otherwise —
 *          spread directly into the `MountOptions` given to `mount()`.
 */
export function atlasMountOptions(
  search: string,
): Pick<MountOptions, "transformRoot"> {
  const spec = parseAtlasParam(new URLSearchParams(search).get("atlas"));
  if (spec === null) return {};
  return { transformRoot: (root) => buildAtlasRoot(root, spec) };
}
