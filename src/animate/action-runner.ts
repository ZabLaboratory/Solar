// Action runner dispatcher — routes Patch.action descriptors to the
// matching sub-runner. Patches without `action` are out of scope here ;
// callers fall back to the existing transitions.ts pipeline.
//
// Lifecycle :
//   runAction({ store, patch, root, signal })
//     → look up RUNNERS[patch.action.kind]
//     → await the runner
//     → throw if kind is unknown so callers can surface the error
//
// All runners are async. Implementations may operate against the
// `store` (count-up, curve-path), the DOM (text-reveal, stagger-group,
// reorder, mask-reveal), or both.

import type { Patch } from "../transport/protocol";
import type { Store } from "../state/store";
import { runCountUp } from "./runners/count-up";
import { runCurvePath } from "./runners/curve-path";
import { runTextReveal } from "./runners/text-reveal";
import { runStaggerGroup } from "./runners/stagger-group";
import { runReorder } from "./runners/reorder";
import { runMaskReveal } from "./runners/mask-reveal";

export interface ActionContext {
  store: Store;
  patch: Patch;
  root?: HTMLElement | null;
  signal?: AbortSignal;
}

export type ActionRunner = (ctx: ActionContext) => Promise<void>;

const RUNNERS: Record<string, ActionRunner> = {
  "count-up": runCountUp,
  "curve-path": runCurvePath,
  "text-reveal": runTextReveal,
  "stagger-group": runStaggerGroup,
  reorder: runReorder,
  "mask-reveal": runMaskReveal,
};

export function hasAction(patch: Patch): boolean {
  return Boolean(patch.action);
}

export class UnknownActionKindError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`Solar action-runner : unknown kind '${kind}'`);
    this.kind = kind;
    this.name = "UnknownActionKindError";
  }
}

export async function runAction(ctx: ActionContext): Promise<void> {
  const action = ctx.patch.action;
  if (!action) return;
  const runner = RUNNERS[action.kind];
  if (!runner) throw new UnknownActionKindError(action.kind);
  await runner(ctx);
}

/** Register or override a runner — exposed for hosts that ship custom
 *  action kinds. Use sparingly ; the built-in kinds are the contract
 *  Prism's compiler targets. */
export function registerActionRunner(
  kind: string,
  runner: ActionRunner,
): void {
  RUNNERS[kind] = runner;
}
