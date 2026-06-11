// Derives Orion's render-bundle URL resolver from the Orion WS URL.
//
// Since ADR 007 (Lumencast convergence), `@lumencast/runtime` owns the
// bundle-fetch lifecycle but, by default, derives the bundle URL from a
// host-root LSDP/1 layout (`https://<host>/lsdp/v1/scenes/{id}/bundle`).
// In the Zab platform Orion lives behind ZabGate under the `/orion/api/v1`
// prefix and serves the bundle at `/scenes/{id}/render-bundle?v={hash}`.
// The runtime exposes `MountOptions.resolveBundleUrl` (runtime ≥ 0.5.0) so
// the host can supply the correct URL.
//
// Knowing Orion's URL contract is precisely the job of the Zab-facing
// adapter (ADR 007 — thin adapter), so this mapping lives here and stays
// minimal: scheme upgrade, strip the WS suffix to recover the API root,
// rebuild the bundle URL with a content-hash query.

/** The live-show WS suffix Orion mounts under its API root. The bundle
 *  route is a sibling of `/show`, so we strip this to recover the root. */
const WS_SUFFIX = "/show/stream.lsdp";

/**
 * Builds the `resolveBundleUrl` resolver Solar passes to the runtime,
 * derived from the Orion WS `serverUrl`.
 *
 * Mapping, given e.g.
 *   `wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp?token=…`
 *  - `wss`→`https`, `ws`→`http` (host & port unchanged);
 *  - drop the query/hash;
 *  - strip the WS suffix (`/show/stream.lsdp`) to get the API root
 *    (`/orion/api/v1`);
 *  - bundle = `<scheme>//<host><apiRoot>/scenes/<id>/render-bundle?v=<hash>`.
 *
 * `sceneId` and `sceneVersion` are percent-encoded: the version is a
 * content hash like `sha256:abc…` whose `:` is not query-safe; Orion's
 * `r.URL.Query().Get("v")` URL-decodes it back to the exact hash before
 * the byte-for-byte DB match (`scenes_get.go`).
 *
 * @throws TypeError if `serverUrl` is not a parseable absolute URL.
 */
export function orionBundleUrl(
  serverUrl: string,
): (sceneId: string, sceneVersion: string) => string {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new TypeError(
      `solar.mount: \`orionUrl\` must be an absolute URL, got "${serverUrl}"`,
    );
  }

  const scheme = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;

  // Recover the API root by stripping the known WS suffix. Fallback: if the
  // suffix shape ever drifts, strip a trailing `/show/...` segment, else use
  // the pathname as-is so the URL is still well-formed (and visibly wrong in
  // a 404 rather than silently truncated).
  let apiRoot = url.pathname;
  if (apiRoot.endsWith(WS_SUFFIX)) {
    apiRoot = apiRoot.slice(0, -WS_SUFFIX.length);
  } else {
    const showIdx = apiRoot.indexOf("/show/");
    if (showIdx !== -1) {
      apiRoot = apiRoot.slice(0, showIdx);
    }
  }
  // Normalise any trailing slash so we never emit `//scenes`.
  apiRoot = apiRoot.replace(/\/+$/, "");

  const origin = `${scheme}//${url.host}`;

  return (sceneId: string, sceneVersion: string): string =>
    `${origin}${apiRoot}/scenes/${encodeURIComponent(sceneId)}` +
    `/render-bundle?v=${encodeURIComponent(sceneVersion)}`;
}
