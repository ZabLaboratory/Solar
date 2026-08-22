/**
 * Builds the same-origin render-bundle URL used by Prism's local scene
 * server. The host owns the base URL; Solar only appends the content-addressed
 * scene path and never accepts a cross-origin bundle source.
 */
export function localBundleUrl(
  bundleBase: string,
  hostUrl: string,
  sceneId: string,
  sceneVersion: string,
): string {
  const base = new URL(bundleBase, hostUrl);
  const host = new URL(hostUrl);

  if (base.origin !== host.origin) {
    throw new Error("solar host: bundle resolver must be same-origin with the host");
  }

  const root = base.pathname.replace(/\/+$/, "");
  if (!root.endsWith("/solar-bundle")) {
    throw new Error(
      "solar host: bundle resolver must target the local /solar-bundle route",
    );
  }

  base.pathname =
    `${root}/scenes/` +
    `${encodeURIComponent(sceneId)}/render-bundle`;
  base.search = `?v=${encodeURIComponent(sceneVersion)}`;
  base.hash = "";
  return base.toString();
}
