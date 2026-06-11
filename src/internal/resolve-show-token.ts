// Resolves the show-token Solar must hand to the runtime as the explicit
// `mount()` token.
//
// Why this exists: the Pulsar CEF browser source addresses Solar with a
// single packed URL —
//   index.html?orion=<orionUrl>&mode=broadcast
// where <orionUrl> itself carries the show-token in its query string, used
// for the WS upgrade :
//   wss://zabgate.cyell.dev/orion/api/v1/show/stream.lsdp?token=<SHOW>
// There is NO top-level `?token=` param. The host entries used to read
// `params.get("token")` and got "" — so `mount({ token: "" })`, so the
// runtime resolved an empty token, so the render-bundle GET went out with
// no `Authorization` header → 401 → black screen (BUNDLE_FETCH_FAILED).
//
// The runtime (@lumencast/runtime ≥ 0.6.0) attaches
// `Authorization: Bearer <token>` to the bundle fetch iff `MountOptions.token`
// is non-empty (it does NOT mine the WS URL for a token). So the fix is to
// surface the show-token from the orionUrl's `?token=` and pass it explicitly.
//
// Precedence: an explicit top-level token (dev/manual override) wins ; else
// the token embedded in the orionUrl ; else "" (unauthenticated, dev/local).

/**
 * Resolve the show-token Solar passes to `mount({ token })`.
 *
 * @param orionUrl    the WS server URL, possibly carrying `?token=<SHOW>`.
 * @param explicitToken a top-level `?token=` query param, if the host URL
 *                      provided one separately (takes precedence).
 * @returns the resolved token, or "" when none is present.
 */
export function resolveShowToken(
  orionUrl: string,
  explicitToken?: string | null,
): string {
  if (explicitToken) return explicitToken;
  let url: URL;
  try {
    url = new URL(orionUrl);
  } catch {
    // A non-absolute orionUrl can't embed a token ; the caller's own
    // validation surfaces the malformed URL. Stay header-less here.
    return "";
  }
  return url.searchParams.get("token") ?? "";
}
