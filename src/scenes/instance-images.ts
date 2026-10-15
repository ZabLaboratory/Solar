import { canonicalRender } from "./canonical-render";
import { verifySceneSource } from "./cache";
import type { LSMLDocument } from "./native-document";
import type { SceneSourceDelivery } from "./types";

export interface RuntimeImageResolution {
  path: string;
  bytes?: Uint8Array;
  release: () => void;
}

export interface PreparedInstanceSource {
  sceneId: string;
  sceneVersion: string;
  packageBytes: Uint8Array;
  assets: Array<{ path: string; bytes: Uint8Array }>;
}

export interface PreparedInstanceImages {
  instances: PreparedInstanceSource[];
  /** Additional files required by root-level aliases for child image params. */
  rootAssets: Array<{ path: string; bytes: Uint8Array }>;
  /** Release temporary image cache pins after the load has been accepted. */
  release: () => void;
}

interface RuntimeSource extends PreparedInstanceSource {
  sourceKey: string;
  requiredImageParams: Set<string>;
}

function sourceKey(sceneId: string, sceneVersion: string): string {
  return JSON.stringify([sceneId, sceneVersion]);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Match the instance resolver: layout children and repeat templates only. */
function visitLayout(
  value: unknown,
  visitor: (node: Record<string, unknown>) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => visitLayout(entry, visitor));
    return;
  }
  const node = record(value);
  if (!node) return;
  visitor(node);
  if (Array.isArray(node.children))
    node.children.forEach((child) => visitLayout(child, visitor));
  if ((node.kind === "repeat" || node.type === "repeat") && node.template)
    visitLayout(node.template, visitor);
}

function externalImage(value: unknown): boolean {
  return (
    value === null ||
    value === "" ||
    (typeof value === "string" &&
      (value.startsWith("data:image/") ||
        value.startsWith("http://") ||
        value.startsWith("https://")))
  );
}

function addAsset(
  files: Map<string, Uint8Array>,
  path: string,
  bytes: Uint8Array,
): void {
  const existing = files.get(path);
  if (
    existing &&
    (existing.length !== bytes.length ||
      existing.some((value, index) => value !== bytes[index]))
  )
    throw new Error(
      `Instance image asset path conflicts with source bytes: ${path}`,
    );
  if (!existing) files.set(path, bytes);
}

function parameterName(path: string): string {
  return path.startsWith("__params.") ? path.slice("__params.".length) : path;
}

async function waitForAll(tasks: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

/**
 * Build runtime-only child packages after exact dependency admission. Remote
 * images use the active scene's resolver and its cache/budget/leases; source
 * bytes and source versions are never mutated.
 */
export async function prepareInstanceImages(
  root: LSMLDocument,
  sources: readonly SceneSourceDelivery[],
  defaults: Record<string, unknown>,
  imageBindings: Record<string, string>,
  imageAssets: Record<string, string>,
  resolveImage: (
    value: unknown,
    document: LSMLDocument,
    signal?: AbortSignal,
  ) => Promise<RuntimeImageResolution>,
  signal?: AbortSignal,
): Promise<PreparedInstanceImages> {
  const originals = new Map<string, SceneSourceDelivery>();
  const documents = new Map<string, LSMLDocument>();
  for (const source of sources) {
    if (source.format !== "lsml")
      throw new Error("Instance render sources must be plain LSML.");
    const key = sourceKey(source.sceneId, source.sceneVersion);
    const verified = verifySceneSource(source, { requireOfflineReady: false });
    if (
      verified.document.scene_id !== source.sceneId ||
      verified.document.scene_version !== source.sceneVersion
    )
      throw new Error("Instance source identity changed during preparation.");
    originals.set(key, source);
    documents.set(key, structuredClone(verified.document) as LSMLDocument);
  }

  const prepared = new Map<string, Promise<RuntimeSource>>();
  const inProgress = new Set<string>();
  const acquired: RuntimeImageResolution[] = [];
  const rootFiles = new Map<string, Uint8Array>();
  let aliasSequence = 0;

  const resolve = async (
    value: unknown,
    document: LSMLDocument,
    files: Map<string, Uint8Array>,
  ): Promise<RuntimeImageResolution> => {
    const image = await resolveImage(value, document, signal);
    acquired.push(image);
    if (image.bytes) addAsset(files, image.path, image.bytes);
    return image;
  };

  const prepare = (key: string): Promise<RuntimeSource> => {
    const cached = prepared.get(key);
    if (cached) return cached;
    if (inProgress.has(key))
      return Promise.reject(
        new Error("Instance source cycle during image preparation."),
      );
    const source = originals.get(key);
    const sourceDocument = documents.get(key);
    if (!source || !sourceDocument)
      return Promise.reject(new Error("Exact instance source is unavailable."));

    inProgress.add(key);
    const work = (async (): Promise<RuntimeSource> => {
      signal?.throwIfAborted();
      const document = structuredClone(sourceDocument);
      const files = new Map(source.assets);
      const requiredImageParams = new Set<string>();
      let changed = false;

      const childNodes: Array<{
        node: Record<string, unknown>;
        child: RuntimeSource;
      }> = [];
      const childPromises: Promise<void>[] = [];
      visitLayout(document.layout, (node) => {
        if (node.kind !== "instance" && node.type !== "instance") return;
        const sceneId = node.scene_id;
        const sceneVersion = node.scene_version;
        if (typeof sceneId !== "string" || typeof sceneVersion !== "string")
          throw new Error("Instance source reference is invalid.");
        const childKey = sourceKey(sceneId, sceneVersion);
        childPromises.push(
          prepare(childKey).then((child) => {
            childNodes.push({ node, child });
          }),
        );
      });
      await waitForAll(childPromises);
      for (const { node, child } of childNodes) {
        if (node.scene_version !== child.sceneVersion) {
          node.scene_version = child.sceneVersion;
          changed = true;
        }
        const params = record(node.bindParams);
        for (const name of child.requiredImageParams) {
          const mapping = params?.[name];
          if (typeof mapping !== "string") continue;
          if (mapping.startsWith("__params.")) {
            requiredImageParams.add(parameterName(mapping));
          } else if (Object.hasOwn(document.defaults ?? {}, mapping)) {
            requiredImageParams.add(mapping);
          } else if (!mapping.startsWith("assets/")) {
            requiredImageParams.add(mapping);
          }
        }
      }

      const pending: Promise<void>[] = [];
      const resolvedDefaults = new Set<string>();
      visitLayout(document.layout, (node) => {
        if (node.kind !== "image" && node.type !== "image") return;
        const bind = record(node.bind);
        const path = bind?.src;
        if (typeof path === "string") {
          if (path.startsWith("__params.")) {
            requiredImageParams.add(parameterName(path));
          } else if (Object.hasOwn(document.defaults ?? {}, path)) {
            requiredImageParams.add(path);
            if (!resolvedDefaults.has(path)) {
              resolvedDefaults.add(path);
              const value = document.defaults?.[path];
              if (externalImage(value))
                pending.push(
                  resolve(value, document, files).then((image) => {
                    if (image.path !== value) {
                      document.defaults![path] = image.path;
                      changed = true;
                    }
                  }),
                );
            }
          } else if (!files.has(path) && !path.startsWith("assets/")) {
            requiredImageParams.add(path);
          }
        }
        if (typeof node.src === "string" && externalImage(node.src)) {
          const originalValue = node.src;
          pending.push(
            resolve(originalValue, document, files).then((image) => {
              if (image.path !== originalValue) {
                node.src = image.path;
                changed = true;
              }
            }),
          );
        }
      });

      // Nested child images may receive a constant URL from this document's
      // defaults instead of a parameter. Localize those values in this copy.
      for (const { node, child } of childNodes) {
        const params = record(node.bindParams);
        for (const name of child.requiredImageParams) {
          const mapping = params?.[name];
          if (
            typeof mapping !== "string" ||
            mapping.startsWith("__params.") ||
            !Object.hasOwn(document.defaults ?? {}, mapping) ||
            resolvedDefaults.has(mapping)
          )
            continue;
          resolvedDefaults.add(mapping);
          const value = document.defaults?.[mapping];
          if (externalImage(value))
            pending.push(
              resolve(value, document, files).then((image) => {
                if (image.path !== value) {
                  document.defaults![mapping] = image.path;
                  changed = true;
                }
              }),
            );
        }
      }

      await waitForAll(pending);

      const rendered = changed ? await canonicalRender(document) : undefined;
      const sceneVersion = rendered?.sceneVersion ?? source.sceneVersion;
      const packageBytes = rendered?.data ?? source.data;
      const result: RuntimeSource = {
        sourceKey: key,
        sceneId: source.sceneId,
        sceneVersion,
        packageBytes,
        assets: [...files].map(([path, bytes]) => ({ path, bytes })),
        requiredImageParams,
      };
      return result;
    })();
    const tracked = work.finally(() => inProgress.delete(key));
    prepared.set(key, tracked);
    return tracked;
  };

  const allocateAlias = (): string => {
    let alias: string;
    do {
      alias = `__solar.instance.image.${aliasSequence++}`;
    } while (Object.hasOwn(defaults, alias));
    return alias;
  };

  try {
    const rootNodes: Array<{
      node: Record<string, unknown>;
      child: RuntimeSource;
    }> = [];
    const pendingChildren: Promise<void>[] = [];
    visitLayout(root.layout, (node) => {
      if (node.kind !== "instance" && node.type !== "instance") return;
      const sceneId = node.scene_id;
      const sceneVersion = node.scene_version;
      if (typeof sceneId !== "string" || typeof sceneVersion !== "string")
        throw new Error("Instance source reference is invalid.");
      pendingChildren.push(
        prepare(sourceKey(sceneId, sceneVersion)).then((child) => {
          rootNodes.push({ node, child });
        }),
      );
    });
    await waitForAll(pendingChildren);

    for (const { node, child } of rootNodes) {
      if (node.scene_version !== child.sceneVersion)
        node.scene_version = child.sceneVersion;
      const params = record(node.bindParams);
      for (const name of child.requiredImageParams) {
        const mapping = params?.[name];
        if (typeof mapping !== "string") continue;
        if (
          mapping.startsWith("http://") ||
          mapping.startsWith("https://") ||
          mapping.startsWith("data:image/")
        ) {
          const image = await resolve(mapping, root, rootFiles);
          const alias = allocateAlias();
          defaults[alias] = image.path;
          if (params) params[name] = alias;
          continue;
        }

        let alias = imageBindings[mapping];
        if (!alias) {
          alias = allocateAlias();
          const initialValue = Object.hasOwn(defaults, mapping)
            ? defaults[mapping]
            : undefined;
          const image = await resolve(initialValue, root, rootFiles);
          defaults[alias] = image.path;
          imageBindings[mapping] = alias;
          if (typeof initialValue === "string")
            imageAssets[initialValue] = image.path;
        }
        if (params) params[name] = alias;
      }
    }

    const instances: PreparedInstanceSource[] = [];
    const ordered = [...sources];
    for (const source of ordered) {
      const runtime = await prepare(
        sourceKey(source.sceneId, source.sceneVersion),
      );
      instances.push({
        sceneId: runtime.sceneId,
        sceneVersion: runtime.sceneVersion,
        packageBytes: runtime.packageBytes,
        assets: runtime.assets,
      });
    }
    return {
      instances,
      rootAssets: [...rootFiles].map(([path, bytes]) => ({ path, bytes })),
      release: () => acquired.splice(0).forEach((image) => image.release()),
    };
  } catch (error) {
    acquired.splice(0).forEach((image) => image.release());
    throw error;
  }
}
