import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { SceneSourceStore } from "./cache";

/** The embedding credential partitions storage; no credential is written to disk. */
export function sceneCacheNamespace(
  apiUrl: string,
  credential: string,
): string {
  if (!credential) throw new Error("SOURCE_CACHE_CREDENTIAL_REQUIRED");
  return bytesToHex(
    sha256(new TextEncoder().encode(JSON.stringify([apiUrl, credential]))),
  );
}

interface RecordEntry {
  key: string;
  bytes: Uint8Array;
  accessed: number;
}
const result = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((yes, no) => {
    request.onsuccess = () => yes(request.result);
    request.onerror = () => no(request.error);
  });
const complete = (transaction: IDBTransaction): Promise<void> =>
  new Promise((yes, no) => {
    transaction.oncomplete = () => yes();
    transaction.onabort = () =>
      no(transaction.error ?? new Error("SOURCE_CACHE_ABORTED"));
    transaction.onerror = () => {}; // onabort owns the rejection.
  });

/** Atomic, immutable, bounded account partition shared by both Solar lanes. */
export class BrowserSceneSourceStore implements SceneSourceStore {
  private database: Promise<IDBDatabase> | null = null;
  constructor(
    private readonly namespace: string,
    private readonly options: {
      factory?: IDBFactory;
      maxBytes?: number;
      maxEntries?: number;
    } = {},
  ) {
    if (!/^[a-f0-9]{64}$/.test(namespace))
      throw new Error("SOURCE_CACHE_NAMESPACE_INVALID");
    if (
      !Number.isSafeInteger(options.maxBytes ?? 512 * 1024 * 1024) ||
      !Number.isSafeInteger(options.maxEntries ?? 64) ||
      (options.maxBytes ?? 512 * 1024 * 1024) < 1 ||
      (options.maxEntries ?? 64) < 1
    )
      throw new Error("SOURCE_CACHE_LIMIT_INVALID");
  }
  private open(): Promise<IDBDatabase> {
    return (this.database ??= new Promise((yes, no) => {
      const request = (this.options.factory ?? indexedDB).open(
        `solar-scenes-${this.namespace}`,
        1,
      );
      request.onupgradeneeded = () =>
        request.result.createObjectStore("scenes", { keyPath: "key" });
      request.onerror = () => no(request.error);
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        yes(request.result);
      };
    }));
  }
  private key(key: string): void {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error("SOURCE_CACHE_KEY_INVALID");
  }
  async read(key: string): Promise<Uint8Array | null> {
    this.key(key);
    const transaction = (await this.open()).transaction("scenes", "readwrite"),
      done = complete(transaction);
    const store = transaction.objectStore("scenes");
    const entry = (await result(store.get(key))) as RecordEntry | undefined;
    if (entry) store.put({ ...entry, accessed: Date.now() });
    await done;
    return entry ? new Uint8Array(entry.bytes) : null;
  }
  async write(key: string, bytes: Uint8Array): Promise<void> {
    this.key(key);
    const maxBytes = this.options.maxBytes ?? 512 * 1024 * 1024;
    if (bytes.byteLength > Math.min(maxBytes, 132 * 1024 * 1024))
      throw new Error("SOURCE_CACHE_QUOTA");
    const transaction = (await this.open()).transaction("scenes", "readwrite"),
      done = complete(transaction);
    const store = transaction.objectStore("scenes");
    const entries = (await result(store.getAll())) as RecordEntry[];
    const existing = entries.find((entry) => entry.key === key);
    if (
      existing &&
      (existing.bytes.length !== bytes.length ||
        existing.bytes.some((byte, i) => byte !== bytes[i]))
    ) {
      transaction.abort();
      await done.catch(() => {});
      throw new Error("SOURCE_CACHE_KEY_CONFLICT");
    }
    const others = entries
      .filter((entry) => entry.key !== key)
      .sort((a, b) => a.accessed - b.accessed || a.key.localeCompare(b.key));
    let size = others.reduce(
      (total, entry) => total + entry.bytes.byteLength,
      bytes.byteLength,
    );
    while (
      size > maxBytes ||
      others.length + 1 > (this.options.maxEntries ?? 64)
    ) {
      const entry = others.shift()!;
      size -= entry.bytes.byteLength;
      store.delete(entry.key);
    }
    store.put({ key, bytes: new Uint8Array(bytes), accessed: Date.now() });
    await done;
  }
  async close(): Promise<void> {
    if (this.database) (await this.database).close();
    this.database = null;
  }
}
