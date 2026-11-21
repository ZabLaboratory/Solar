import type { IncomingContext } from "../../vendor/lsdp-native-browser/src/browser.js";
import type { Operation } from "fast-json-patch";
import type { LSMLDocument } from "../scenes/native-document";
import type { MountOptions } from "../types";
import { NativeState } from "../internal/native-state";
import { verifiedNativeWorkerState } from "./native-worker-client";
import { selectNativeDocument } from "./native-lsdp-runtime-support";

export function checkNativeDelivery(
  signal: AbortSignal,
  context: IncomingContext,
  current: boolean,
): void {
  signal.throwIfAborted();
  context.signal.throwIfAborted();
  if (!current) throw new Error("Stale native LSDP delivery.");
}

export function isUnsupportedNativeRender(error: unknown): error is Error {
  return (
    error instanceof Error &&
    /^Vision render: unsupported GPU effect:/i.test(error.message)
  );
}
interface BlockedDelivery {
  state: Pick<NativeState, "value" | "stateHash">;
  document: LSMLDocument | null;
  hash: string;
  sequence: number | null;
}
/** Permanent capability rejection is received state, never an applied frame or transport failure. */
export class NativeRenderSupervision {
  private blocked: { hash: string; error: Error } | null = null;
  constructor(private readonly options: MountOptions) {}
  get isBlocked(): boolean {
    return this.blocked !== null;
  }
  check(hash: string): void {
    if (this.blocked?.hash === hash) throw this.blocked.error;
  }
  capture(
    error: unknown,
    value: unknown,
    context: IncomingContext,
    current: Pick<NativeState, "value" | "stateHash"> | null,
    check: () => void,
  ): BlockedDelivery | null {
    if (!isUnsupportedNativeRender(error)) return null;
    check();
    const snapshot = context.metadata.profile === "lsdp.state.read/1";
    const event = value as {
      sequence: number;
      mutation: { operations: Operation[]; id: string };
    };
    const state =
      verifiedNativeWorkerState(context) ??
      (snapshot
        ? NativeState.from(value)
        : current instanceof NativeState
          ? current.patch(event.mutation.operations)
          : null);
    if (!state) throw error;
    const document = selectNativeDocument(
      state.value,
      this.options.nativeLSDP.selector,
    );
    if (this.blocked?.hash !== state.stateHash) {
      this.blocked = { hash: state.stateHash, error };
      const detail = {
        resource: this.options.nativeLSDP.resource,
        ...(this.options.nativeLSDP.selector
          ? { selector: this.options.nativeLSDP.selector }
          : {}),
        stateHash: state.stateHash,
        code: "VISION_EFFECT_UNSUPPORTED" as const,
        message: error.message,
      };
      this.options.onStatus?.("blocked");
      this.options.onError?.({
        code: detail.code,
        message: detail.message,
        recoverable: false,
      });
      this.options.target.dispatchEvent(
        new CustomEvent("solar:lsdp-blocked", { detail }),
      );
    }
    return {
      state,
      document,
      hash: state.stateHash,
      sequence: snapshot ? null : event.sequence,
    };
  }
  async receive(
    action: () => Promise<unknown>,
    value: unknown,
    context: IncomingContext,
    current: () => Pick<NativeState, "value" | "stateHash"> | null,
    check: () => void,
    accept: (delivery: BlockedDelivery) => void,
  ): Promise<unknown> {
    try {
      return await action();
    } catch (error) {
      const blocked = this.capture(error, value, context, current(), check);
      if (!blocked) throw error;
      accept(blocked);
      return { level: "received", stateHash: blocked.hash };
    }
  }
  recover(hash: string): void {
    if (!this.blocked) return;
    this.blocked = null;
    this.options.onStatus?.("live");
    this.options.target.dispatchEvent(
      new CustomEvent("solar:lsdp-unblocked", {
        detail: {
          resource: this.options.nativeLSDP.resource,
          ...(this.options.nativeLSDP.selector
            ? { selector: this.options.nativeLSDP.selector }
            : {}),
          stateHash: hash,
        },
      }),
    );
  }
  clear(): void {
    this.blocked = null;
  }
}
