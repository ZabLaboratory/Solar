import { verifySceneSource } from "./cache";
import { SceneSourceError } from "./types";
import type { SceneSourceDelivery, SceneSourceProvider } from "./types";

const ADDRESS = /^sha256:[a-f0-9]{64}$/;
const MAX_DEPTH = 8;
const MAX_SOURCES = 256;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_NODES = 100_000;

interface SceneIdentity {
  scene_id: string;
  scene_version: string;
}

export class InstanceSourceError extends Error {
  constructor(
    readonly code:
      | "BUNDLE_FETCH_FAILED"
      | "INSTANCE_CYCLE"
      | "INSTANCE_RESOURCE_LIMIT"
      | "INSTANCE_SOURCE_INVALID",
  ) {
    super(code);
    this.name = "InstanceSourceError";
  }
}

/** Only semantic layout children are dependencies, never metadata or params. */
function references(
  layout: unknown,
  budget: { visited: number },
): SceneIdentity[] {
  const pending = [layout];
  const result: SceneIdentity[] = [];
  while (pending.length) {
    if (++budget.visited > MAX_NODES)
      throw new InstanceSourceError("INSTANCE_RESOURCE_LIMIT");
    const value = pending.pop();
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.kind === "instance" || node.type === "instance") {
      if (
        typeof node.scene_id !== "string" ||
        !node.scene_id ||
        typeof node.scene_version !== "string" ||
        !ADDRESS.test(node.scene_version)
      )
        throw new InstanceSourceError("INSTANCE_SOURCE_INVALID");
      result.push({
        scene_id: node.scene_id,
        scene_version: node.scene_version,
      });
    }
    if (Array.isArray(node.children)) {
      if (budget.visited + pending.length + node.children.length > MAX_NODES)
        throw new InstanceSourceError("INSTANCE_RESOURCE_LIMIT");
      for (let index = node.children.length - 1; index >= 0; index--)
        pending.push(node.children[index]);
    }
    if ((node.kind === "repeat" || node.type === "repeat") && node.template)
      pending.push(node.template);
  }
  return result;
}

/** Acquire this active dependency graph only; the provider owns source storage.
 * Exact sources retain their original bytes, assets, Blue pins and identities.
 * No compiler, renderer, global memo or inactive scene owner is created here.
 */
export async function acquireInstanceSources(
  root: SceneIdentity & { layout?: unknown },
  provider: SceneSourceProvider,
  signal: AbortSignal,
): Promise<SceneSourceDelivery[]> {
  const key = (ref: SceneIdentity) =>
    JSON.stringify([ref.scene_id, ref.scene_version]);
  const admitted = new Map<string, SceneSourceDelivery>();
  const ancestry = new Set([key(root)]);
  let expandedBytes = 0;
  const budget = { visited: 0 };
  const visit = async (layout: unknown, depth: number): Promise<void> => {
    for (const ref of references(layout, budget)) {
      signal.throwIfAborted();
      const identity = key(ref);
      if (ancestry.has(identity))
        throw new InstanceSourceError("INSTANCE_CYCLE");
      if (depth > MAX_DEPTH)
        throw new InstanceSourceError("INSTANCE_RESOURCE_LIMIT");
      // Still traverse shared dependencies at each occurrence: a previously
      // admitted shallow branch must not conceal a deeper path or a cycle.
      let delivery = admitted.get(identity);
      if (!delivery) {
        if (admitted.size >= MAX_SOURCES)
          throw new InstanceSourceError("INSTANCE_RESOURCE_LIMIT");
        try {
          delivery = await provider.get(ref.scene_id, {
            sceneVersion: ref.scene_version,
            format: "lsmlz",
            signal,
          });
        } catch {
          signal.throwIfAborted();
          throw new InstanceSourceError("BUNDLE_FETCH_FAILED");
        }
        signal.throwIfAborted();
        if (
          delivery.sceneId !== ref.scene_id ||
          delivery.sceneVersion !== ref.scene_version
        )
          throw new InstanceSourceError("INSTANCE_SOURCE_INVALID");
        admitted.set(identity, delivery);
      }
      // Count each source once, not once per instance occurrence.
      if (!documents.has(identity)) {
        let verified: ReturnType<typeof verifySceneSource>;
        try {
          verified = verifySceneSource(delivery, {
            requireOfflineReady: false,
          });
        } catch (error) {
          throw new InstanceSourceError(
            error instanceof SceneSourceError &&
              error.code === "SOURCE_RESOURCE_LIMIT"
              ? "INSTANCE_RESOURCE_LIMIT"
              : "INSTANCE_SOURCE_INVALID",
          );
        }
        expandedBytes += verified.expandedBytes;
        if (expandedBytes > MAX_BYTES)
          throw new InstanceSourceError("INSTANCE_RESOURCE_LIMIT");
        documents.set(identity, verified.document);
      }
      ancestry.add(identity);
      await visit(documents.get(identity)?.layout, depth + 1);
      ancestry.delete(identity);
    }
  };
  const documents = new Map<string, Record<string, unknown>>();
  signal.throwIfAborted();
  await visit(root.layout, 1);
  signal.throwIfAborted();
  return [...admitted.values()];
}
