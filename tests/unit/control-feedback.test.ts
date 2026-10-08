import { beforeEach, expect, it, vi } from "vitest";
import { presentationFeedback } from "../../src/engine/control-feedback";
const mocks = vi.hoisted(() => ({
  reads: 0,
  writes: 0,
  conflicts: 0,
  peers: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    options: Record<string, (...args: never[]) => unknown>;
  }>,
}));
vi.mock("../../vendor/lsdp-native-browser/src/browser.js", () => ({
  BrowserLSDP: class {
    ready = Promise.resolve();
    options: Record<string, (...args: never[]) => unknown> = {};
    close = vi.fn();
    constructor() {
      mocks.peers.push(this);
    }
    async transaction(value: Record<string, unknown>) {
      if (value.kind === "state.read") {
        mocks.reads++;
        // Native read receipt arrives before the separately streamed snapshot.
        setTimeout(() => {
          void this.options.onTransaction!(
            { external: "keep" } as never,
            {
              metadata: { profile: "lsdp.state.read/1", target: "orion/state" },
            } as never,
          );
        }, 5);
        return {};
      }
      mocks.writes++;
      if (mocks.conflicts-- > 0) throw new Error("BASE_MISMATCH");
      return { level: "applied" };
    }
  },
}));
beforeEach(() => {
  mocks.reads = 0;
  mocks.writes = 0;
  mocks.conflicts = 0;
  mocks.peers = [];
});
it("waits for the streamed read before acknowledging a renderer phase", async () => {
  await presentationFeedback(
    "ws://localhost",
    "program",
    { phase: "prepared" },
    new AbortController().signal,
  );
  expect(mocks.reads).toBe(1);
  expect(mocks.writes).toBe(1);
  expect(mocks.peers[0]!.close).toHaveBeenCalledOnce();
});
it("rereads after a proven conflict and closes the connection after exhaustion", async () => {
  mocks.conflicts = 2;
  await presentationFeedback(
    "ws://localhost",
    "preview",
    { phase: "active" },
    new AbortController().signal,
  );
  expect(mocks.reads).toBe(3);
  expect(mocks.writes).toBe(3);
  mocks.conflicts = 10;
  await expect(
    presentationFeedback(
      "ws://localhost",
      "preview",
      {},
      new AbortController().signal,
    ),
  ).rejects.toThrow("BASE_MISMATCH");
  expect(mocks.peers.at(-1)!.close).toHaveBeenCalledOnce();
});
