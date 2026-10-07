import { bundleAddress } from "@lumencast/canonical";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { requireLSML } from "./native-document";
import { SceneSourceError, type LocalSceneSourceProvider } from "./types";

/** Trusted host opt-in; absence alone permits published-source acquisition. */
export function createLocalAuthoringSourceProvider(
  url: string,
  token: string,
): LocalSceneSourceProvider {
  const endpoint = new URL(url);
  if (
    !/^https?:$/.test(endpoint.protocol) ||
    !/^(127\.0\.0\.1|localhost|\[::1\])$/i.test(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new SceneSourceError("SOURCE_DESCRIPTOR_INVALID");
  return {
    async get(sceneId, options) {
      const request = new URL(endpoint);
      request.searchParams.set("scene_id", sceneId);
      request.searchParams.set("v", options.sceneVersion ?? "");
      const response = await fetch(request, {
        headers: { Authorization: `Bearer ${token}` },
        signal: options.signal,
        redirect: "error",
        credentials: "omit",
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new SceneSourceError("SOURCE_REQUEST_FAILED");
      const maximum = 4 * 1024 * 1024;
      if (Number(response.headers.get("content-length") ?? 0) > maximum)
        throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
      const data = new Uint8Array(await response.arrayBuffer());
      if (!data.length || data.byteLength > maximum)
        throw new SceneSourceError("SOURCE_RESOURCE_LIMIT");
      const envelope = JSON.parse(new TextDecoder().decode(data)) as {
        lsml_bundle?: unknown;
        assets?: Record<string, string>;
      };
      const document = requireLSML(envelope.lsml_bundle);
      if (
        document.scene_id !== sceneId ||
        document.scene_version !== options.sceneVersion ||
        response.headers.get("x-scene-version") !== options.sceneVersion ||
        (await bundleAddress(document)) !== document.scene_version
      )
        throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
      const assets = new Map<string, Uint8Array>();
      for (const [path, encoded] of Object.entries(envelope.assets ?? {})) {
        const match = /^assets\/([a-f0-9]{64})\.[a-z0-9]{1,12}$/.exec(path);
        if (!match || typeof encoded !== "string")
          throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
        const bytes = Uint8Array.from(atob(encoded), (char) =>
          char.charCodeAt(0),
        );
        if (bytesToHex(sha256(bytes)) !== match[1])
          throw new SceneSourceError("SOURCE_INTEGRITY_FAILED");
        assets.set(path, bytes);
      }
      const source = new TextEncoder().encode(JSON.stringify(document));
      return {
        provenance: "local-authoring",
        sceneId,
        revision: 0,
        sceneVersion: document.scene_version,
        sourceDigest: `sha256:${bytesToHex(sha256(source))}`,
        format: "lsml",
        data: source,
        assets,
      };
    },
  };
}
