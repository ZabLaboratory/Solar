import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes } from "@noble/hashes/utils";
import { strictJSON } from "../../vendor/lsdp-native-browser/src/strict-json.js";

const utf8 = new TextEncoder();
const bytes = (text: string): Uint8Array => utf8.encode(text);
const empty = sha256(bytes("LSDP-MAP-EMPTY/1"));
const u64 = (value: number): Uint8Array => {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, BigInt(value));
  return result;
};
const compare = (a: Uint8Array, b: Uint8Array): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
};

interface Entry {
  name: string;
  key: Uint8Array;
  priority: Uint8Array;
  value: Uint8Array;
  left?: Entry;
  right?: Entry;
  source: unknown;
  result: TreeDigest;
  map?: Uint8Array;
}

interface TreeDigest {
  hash: Uint8Array;
  nodes: number;
  depth: number;
  entries?: Map<string, Entry>;
  root?: Entry;
}

/** Scoped to one immutable resource. Shared subtrees retain their normative digest. */
export class NativeTreeHasher {
  private readonly cache = new WeakMap<object, TreeDigest>();
  private readonly origins = new WeakMap<object, object>();

  copied(copy: object, original: object): void {
    this.origins.set(copy, original);
  }

  hash(value: unknown): string {
    const result = this.digest(value);
    if (result.nodes > 1_000_000 || result.depth > 128)
      throw new Error("JSON_LIMIT");
    return `tree-sha256:${bytesToHex(result.hash)}`;
  }

  private digest(value: unknown): TreeDigest {
    if (value === null) return this.scalar(sha256(bytes("n")));
    if (typeof value === "boolean")
      return this.scalar(sha256(bytes(value ? "t" : "f")));
    if (typeof value === "number")
      return this.scalar(sha256(bytes(`d${JSON.stringify(value)}`)));
    if (typeof value === "string") {
      const text = bytes(value);
      return this.scalar(
        sha256(concatBytes(bytes("s"), u64(text.length), text)),
      );
    }
    const object = value as object;
    const cached = this.cache.get(object);
    if (cached) return cached;
    if (Array.isArray(value)) {
      const children = value.map((child) => this.digest(child));
      return this.remember(object, {
        hash: sha256(
          concatBytes(
            bytes("a"),
            u64(value.length),
            ...children.map((child) => child.hash),
          ),
        ),
        ...this.budget(children),
      });
    }
    let original = this.origins.get(object);
    while (original && !this.cache.has(original))
      original = this.origins.get(original);
    const previous = original ? this.cache.get(original)?.entries : undefined;
    const prior = original ? this.cache.get(original) : undefined;
    const values = Object.entries(value as Record<string, unknown>);
    if (
      previous &&
      prior &&
      values.length === previous.size &&
      values.every(([key]) => previous.has(key))
    ) {
      const entries = new Map(previous);
      let root = prior.root;
      let nodes = prior.nodes;
      let changedDepth = false;
      const replace = (
        entry: Entry,
        key: Uint8Array,
        result: TreeDigest,
        source: unknown,
      ): Entry => {
        const order = compare(key, entry.key);
        const next = { ...entry };
        if (order < 0) next.left = replace(entry.left!, key, result, source);
        else if (order > 0)
          next.right = replace(entry.right!, key, result, source);
        else {
          next.result = result;
          next.value = result.hash;
          next.source = source;
        }
        next.map = this.mapDigest(next);
        entries.set(next.name, next);
        return next;
      };
      for (const [key, child] of values) {
        const old = previous.get(key)!;
        if (Object.is(old.source, child)) continue;
        const result = this.digest(child);
        nodes += result.nodes - old.result.nodes;
        changedDepth ||= result.depth !== old.result.depth;
        root = replace(root!, old.key, result, child);
      }
      return this.remember(object, {
        hash: sha256(
          concatBytes(bytes("o"), u64(entries.size), root?.map ?? empty),
        ),
        nodes,
        depth: changedDepth
          ? this.budget([...entries.values()].map((entry) => entry.result))
              .depth
          : prior.depth,
        entries,
        root,
      });
    }
    const entries: Entry[] = values
      .map(([key, child]) => {
        const old = previous?.get(key);
        const result =
          old && Object.is(old.source, child) ? old.result : this.digest(child);
        return {
          name: key,
          key: old?.key ?? bytes(key),
          priority: old?.priority ?? sha256(bytes(key)),
          value: result.hash,
          source: child,
          result,
        };
      })
      .sort((a, b) => compare(a.key, b.key));
    const stack: Entry[] = [];
    for (const entry of entries) {
      while (stack.length) {
        const previous = stack.at(-1)!;
        const priority =
          compare(entry.priority, previous.priority) ||
          compare(entry.key, previous.key);
        if (priority <= 0) break;
        entry.left = stack.pop();
      }
      if (stack.length) stack.at(-1)!.right = entry;
      stack.push(entry);
    }
    const mapHash = (entry?: Entry): Uint8Array => {
      if (!entry) return empty;
      const left = mapHash(entry.left),
        right = mapHash(entry.right);
      const old = previous?.get(entry.name);
      entry.map =
        old?.map &&
        compare(left, old.left?.map ?? empty) === 0 &&
        compare(right, old.right?.map ?? empty) === 0 &&
        compare(entry.value, old.value) === 0
          ? old.map
          : this.mapDigest(entry);
      return entry.map;
    };
    const hash = sha256(
      concatBytes(bytes("o"), u64(entries.length), mapHash(stack[0])),
    );
    return this.remember(object, {
      hash,
      ...this.budget(entries.map((entry) => entry.result)),
      entries: new Map(entries.map((entry) => [entry.name, entry])),
      root: stack[0],
    });
  }

  private mapDigest(entry: Entry): Uint8Array {
    return sha256(
      concatBytes(
        bytes("LSDP-MAP-NODE/1"),
        entry.left?.map ?? empty,
        u64(entry.key.length),
        entry.key,
        entry.value,
        entry.right?.map ?? empty,
      ),
    );
  }

  private scalar(hash: Uint8Array): TreeDigest {
    return { hash, nodes: 1, depth: 0 };
  }

  private budget(children: TreeDigest[]): { nodes: number; depth: number } {
    return {
      nodes: 1 + children.reduce((total, child) => total + child.nodes, 0),
      depth: children.reduce(
        (depth, child) => Math.max(depth, child.depth + 1),
        0,
      ),
    };
  }

  private remember(value: object, result: TreeDigest): TreeDigest {
    this.cache.set(value, result);
    return result;
  }
}

/** Normative LSDP-TCP/2 draft2 hash, not LSML's JCS scene_version. */
export function nativeTreeHash(value: unknown): string {
  // Use the native client's portable JSON validation and depth/node limits.
  strictJSON(JSON.stringify(value));
  return new NativeTreeHasher().hash(value);
}
