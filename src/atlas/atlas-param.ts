// Atlas render-mode URL parameter — the canonical `?atlas=` reader
// (ADR 013 Prism §3.1, issue #38).
//
// The texture-atlas broadcast mode (ADR 013) renders a scene NOT as a single
// 1920×1080 image, but as N stacked vertical z-bands in a taller
// 1920×(1080·N) image, so the host (Prism / OBS-ws) can intercalate NATIVE
// capture sources between the DOM bands with arbitrary z-order — a single CEF
// browser source, one Chromium tick, zero inter-process skew.
//
// A consumer opts in through the URL query it loads Solar with:
//
//     ?atlas=below,above          → 2 bands  (image 1920×2160)
//     ?atlas=below,mid,above      → 3 bands  (image 1920×3240)
//
// The band tokens are FREE-FORM labels ordered BOTTOM → TOP (first token =
// bottom slice, last token = top slice). Their only structural role is to
// name / key the emitted band frames; the number of tokens is N, the band
// count. The names carry meaning for the operator/authoring side (which
// native source sits under which band), never for the geometry.
//
// This module owns ONLY the param → spec parsing. The band-splitting
// transform lives in `./atlas-node` (`buildAtlasRoot`). Parsing is total and
// side-effect-free: an absent / malformed / degenerate value resolves to
// `null` so the caller falls back to the UNCHANGED default render path — the
// non-regression contract of issue #38 (the default, atlas-less bundle is
// byte-identical to today).

/** Parsed `?atlas=` spec: the ordered band labels, bottom → top. */
export interface AtlasSpec {
  /** Band labels, bottom slice first. `length` is N, the band count. */
  bands: readonly string[];
}

/**
 * Parse the raw `?atlas=` query value into an {@link AtlasSpec}, or `null`
 * when atlas mode is NOT requested / the value is not recognised.
 *
 * `null` is returned for every degenerate input so the caller keeps the
 * default (non-atlas) render path exactly as before:
 *   - `null` / `undefined` / empty / whitespace-only → not requested;
 *   - no non-empty token after splitting on `,` → nothing to render;
 *   - a duplicate band label → ambiguous (labels key the band frames and
 *     must be unique), treated as unrecognised rather than silently coerced.
 *
 * Tokens are trimmed and empties dropped, so `?atlas=below, ,above` yields
 * `["below", "above"]` and `?atlas=,` yields `null`.
 */
export function parseAtlasParam(
  raw: string | null | undefined,
): AtlasSpec | null {
  if (raw === null || raw === undefined) return null;
  const bands = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (bands.length === 0) return null;
  if (new Set(bands).size !== bands.length) return null;
  return { bands };
}
