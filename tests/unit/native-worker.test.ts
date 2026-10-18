import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncomingContext } from "../../vendor/lsdp-native-browser/src/browser.js";
import { NativeState } from "../../src/internal/native-state";

const transport = vi.hoisted(() => ({
  incoming: undefined as
    | undefined
    | ((value: unknown, context: IncomingContext) => Promise<unknown>),
}));
vi.mock("../../vendor/lsdp-native-browser/src/browser.js", () => ({
  BrowserLSDP: class {
    ready = Promise.resolve();
    constructor(
      _url: string,
      options: { onTransaction: typeof transport.incoming },
    ) {
      transport.incoming = options.onTransaction;
    }
  },
}));

type WorkerScope = typeof globalThis & {
  onmessage: (event: { data: Record<string, unknown> }) => void;
};
const scope = globalThis as WorkerScope;
const previousHandler = scope.onmessage;
afterEach(() => {
  scope.onmessage = previousHandler;
  vi.unstubAllGlobals();
  transport.incoming = undefined;
});

async function start() {
  vi.resetModules();
  const postMessage = vi.fn();
  vi.stubGlobal("postMessage", postMessage);
  // Keep the worker's digest override isolated from the test process crypto.
  vi.stubGlobal("crypto", {
    subtle: { digest: crypto.subtle.digest.bind(crypto.subtle) },
  });
  await import("../../src/engine/native-worker");
  scope.onmessage({
    data: { type: "connect", url: "ws://localhost", resource: "scene" },
  });
  return postMessage;
}

function context(profile: string): IncomingContext {
  return {
    metadata: { profile, target: "scene" },
    signal: new AbortController().signal,
  } as IncomingContext;
}

async function snapshot(postMessage: ReturnType<typeof vi.fn>) {
  const value = { defaults: { opacity: 0 } };
  const pending = transport.incoming!(value, context("lsdp.state.read/1"));
  const message = postMessage.mock.calls.find(
    ([message]) => message.type === "incoming",
  )![0];
  scope.onmessage({
    data: { type: "result", id: message.id, value: { level: "received" } },
  });
  await pending;
  postMessage.mockClear();
  return NativeState.from(value);
}

describe("worker admission receipts", () => {
  it("holds a scalar receipt until main admission and returns that receipt unchanged", async () => {
    const postMessage = await start();
    const state = await snapshot(postMessage);
    const changed = state.patch([
      { op: "replace", path: "/defaults/opacity", value: 0.5 },
    ]);
    const settled = vi.fn();
    const pending = transport.incoming!(
      {
        kind: "change",
        sequence: 1,
        mutation: {
          format: "lsdp.tree/1",
          id: "opacity-1",
          target: "scene",
          beforeHash: state.stateHash,
          afterHash: changed.stateHash,
          operations: [
            { op: "replace", path: "/defaults/opacity", value: 0.5 },
          ],
        },
        receipt: {
          transactionId: "opacity-1",
          target: "scene",
          stateHash: changed.stateHash,
        },
      },
      context("lsdp.state.subscription/1"),
    );
    void pending.then(settled);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    const message = postMessage.mock.calls.find(
      ([message]) => message.type === "incoming",
    )![0];
    expect(message.verifiedState).toEqual({
      value: changed.value,
      stateHash: changed.stateHash,
    });
    const receipt = { level: "received", stateHash: changed.stateHash };
    scope.onmessage({
      data: { type: "result", id: message.id, value: receipt },
    });
    await expect(pending).resolves.toEqual(receipt);
  });

  it("propagates a main-side admission failure rather than acknowledging success", async () => {
    const postMessage = await start();
    const pending = transport.incoming!(
      { defaults: {} },
      context("lsdp.state.read/1"),
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: "ADMISSION_FAILED",
      message: "consumer refused",
    });
    const message = postMessage.mock.calls.find(
      ([message]) => message.type === "incoming",
    )![0];
    scope.onmessage({
      data: {
        type: "result",
        id: message.id,
        error: { code: "ADMISSION_FAILED", message: "consumer refused" },
      },
    });
    await rejected;
  });
});
