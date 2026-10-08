import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NativeWorkerClient,
  verifiedNativeWorkerState,
} from "../../src/engine/native-worker-client";
import type { IncomingContext } from "../../vendor/lsdp-native-browser/src/browser.js";

interface Message {
  type: string;
  id?: number;
  value?: unknown;
  metadata?: { profile: string; target: string };
  error?: { code: string; message: string };
  verifiedState?: { value: unknown; stateHash: string };
}
class WorkerStub {
  static instances: WorkerStub[] = [];
  messages: Message[] = [];
  onmessage: ((value: { data: Message }) => void) | null = null;
  onerror: ((value: { message: string }) => void) | null = null;
  terminated = false;
  constructor() {
    WorkerStub.instances.push(this);
  }
  postMessage(value: Message) {
    this.messages.push(value);
  }
  terminate() {
    this.terminated = true;
  }
  receive(data: Message) {
    this.onmessage?.({ data });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  WorkerStub.instances = [];
});
const start = (
  onTransaction?: ConstructorParameters<
    typeof NativeWorkerClient
  >[1]["onTransaction"],
) => {
  vi.stubGlobal("Worker", WorkerStub);
  const client = new NativeWorkerClient(
    "ws://localhost",
    { onTransaction },
    "scene",
  );
  return { client, worker: WorkerStub.instances.at(-1)! };
};
const incoming = (id: number, profile = "lsdp.state.subscription/1") => ({
  type: "incoming",
  id,
  value: id,
  metadata: { profile, target: "scene" },
});

describe("isolated native transport lifecycle", () => {
  it("certifies only private worker deliveries for the duration of their callback", async () => {
    let receivedContext!: IncomingContext;
    const state = {
      value: { defaults: { title: "verified" } },
      stateHash: `tree-sha256:${"1".repeat(64)}`,
    };
    const seen = vi.fn(async (_value: unknown, context: IncomingContext) => {
      receivedContext = context;
      expect(verifiedNativeWorkerState(context)).toEqual(state);
      expect(
        verifiedNativeWorkerState({
          ...context,
          verifiedState: state,
        } as IncomingContext),
      ).toBeUndefined();
      return { level: "applied", stateHash: state.stateHash };
    });
    const { client, worker } = start(seen);
    worker.receive({ type: "ready" });
    worker.receive({ ...incoming(1), verifiedState: state });
    await vi.waitFor(() => expect(worker.messages.at(-1)?.type).toBe("result"));
    expect(seen).toHaveBeenCalledOnce();
    expect(verifiedNativeWorkerState(receivedContext)).toBeUndefined();
    client.close();
  });
  it("rejects a malformed private certificate before invoking the render consumer", async () => {
    const seen = vi.fn();
    const { client, worker } = start(seen);
    worker.receive({ type: "ready" });
    worker.receive({
      ...incoming(1),
      verifiedState: { value: {}, stateHash: "unchecked" },
    });
    await vi.waitFor(() => expect(worker.messages.at(-1)?.type).toBe("result"));
    expect(worker.messages.at(-1)?.error?.message).toContain(
      "Invalid verified",
    );
    expect(seen).not.toHaveBeenCalled();
    client.close();
  });
  it("rejects readiness if closed before the worker connects", async () => {
    const { client, worker } = start();
    client.close();
    await expect(client.ready).rejects.toThrow("closed");
    expect(worker.terminated).toBe(true);
    worker.receive({ type: "ready" });
    await expect(client.transaction({})).rejects.toThrow("closed");
  });
  it("cancels pending native work and preserves typed native errors", async () => {
    const { client, worker } = start();
    worker.receive({ type: "ready" });
    const abort = new AbortController();
    const call = client.transaction({}, { signal: abort.signal });
    await vi.waitFor(() =>
      expect(
        worker.messages.some((value) => value.type === "transaction"),
      ).toBe(true),
    );
    abort.abort();
    await expect(call).rejects.toThrow("cancelled");
    expect(worker.messages.at(-1)).toMatchObject({
      type: "cancel-transaction",
    });
    const next = client.transaction({});
    await vi.waitFor(() =>
      expect(worker.messages.at(-1)?.type).toBe("transaction"),
    );
    worker.receive({
      type: "transaction-result",
      id: worker.messages.at(-1)?.id,
      error: { code: "BASE_MISMATCH", message: "baseline changed" },
    });
    await expect(next).rejects.toMatchObject({ code: "BASE_MISMATCH" });
    client.close();
  });
  it("delivers notifications in order while a resync snapshot can unblock the current callback", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: number[] = [];
    const { client, worker } = start(async (value, context) => {
      seen.push(value as number);
      if (value === 1) await blocked;
      if (context.metadata.profile === "lsdp.state.read/1") release();
      return { level: "received" };
    });
    worker.receive({ type: "ready" });
    worker.receive(incoming(1));
    worker.receive(incoming(2));
    await vi.waitFor(() => expect(seen).toEqual([1]));
    worker.receive(incoming(3, "lsdp.state.read/1"));
    await vi.waitFor(() => expect(seen).toEqual([1, 3, 2]));
    expect(
      worker.messages.filter((value) => value.type === "result"),
    ).toHaveLength(3);
    client.close();
  });
  it("can cancel a transaction during connection establishment", async () => {
    const { client } = start(),
      abort = new AbortController();
    const call = client.transaction({}, { signal: abort.signal });
    abort.abort();
    await expect(call).rejects.toThrow("cancelled");
    client.close();
  });
});
