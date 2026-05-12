// stagger-group / text-reveal — animate each child of the targeted
// node with a staggered start. Works entirely against the DOM via
// WAAPI so the host doesn't need to wire signals for every unit.
//
// The runner selects children with `child_selector` (default
// `[data-anim-unit]`), then schedules an opacity+transform animation
// for each one staggered by `stagger_ms`. Children that lack
// `el.animate` are upgraded synchronously (final state applied) so
// SSR / static fallbacks stay functional.

import type { ActionRunner, ActionContext } from "../action-runner";
import { resolveEasing } from "../easing-resolver";

interface StaggerParams {
  stagger_ms?: number;
  per_unit_ms?: number;
  /** Initial opacity (default 0). */
  from_opacity?: number;
  /** Initial translateY in px (default 8). */
  from_y?: number;
}

interface StaggerDefaults {
  defaultStaggerMs: number;
  defaultPerUnitMs: number;
  defaultSelector: string;
  stateAttr?: string;
}

export async function runChildStagger(
  ctx: ActionContext,
  defaults: StaggerDefaults,
): Promise<void> {
  const { patch, root, signal } = ctx;
  const action = patch.action;
  if (!action) return;
  const params = (action.params ?? {}) as StaggerParams;
  const staggerMs = params.stagger_ms ?? defaults.defaultStaggerMs;
  const perUnitMs = params.per_unit_ms ?? defaults.defaultPerUnitMs;
  const fromOpacity = params.from_opacity ?? 0;
  const fromY = params.from_y ?? 8;
  const easing = resolveEasing(action.easing).css;

  const target = resolveTarget(root, patch.path);
  if (!target) return;

  const selector =
    action.child_selector?.kind === "css-selector" &&
    typeof action.child_selector.value === "string"
      ? action.child_selector.value
      : defaults.defaultSelector;
  const children = Array.from(
    target.querySelectorAll<HTMLElement>(selector),
  );
  if (children.length === 0) return;

  const animations: Animation[] = [];
  children.forEach((el, i) => {
    if (defaults.stateAttr) el.setAttribute(defaults.stateAttr, "in");
    const delay = i * staggerMs;
    if (typeof el.animate !== "function") {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
      return;
    }
    const anim = el.animate(
      [
        { opacity: fromOpacity, transform: `translateY(${fromY}px)` },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: perUnitMs, delay, easing, fill: "both" },
    );
    animations.push(anim);
  });

  if (signal) {
    signal.addEventListener("abort", () => {
      animations.forEach((a) => a.cancel());
    });
  }

  await Promise.all(
    animations.map((a) =>
      a.finished.then(
        () => undefined,
        () => undefined,
      ),
    ),
  );
}

export const runStaggerGroup: ActionRunner = async (ctx) => {
  await runChildStagger(ctx, {
    defaultStaggerMs: 60,
    defaultPerUnitMs: 320,
    defaultSelector: "[data-anim-child]",
  });
};

function resolveTarget(
  root: HTMLElement | null | undefined,
  path: string,
): HTMLElement | null {
  if (!root) return null;
  // Resolution order :
  //   1. exact `[data-anim-path="<path>"]`
  //   2. `[data-anim-id="<last segment>"]`
  //   3. root itself (fallback — stagger over its children)
  const exact = root.querySelector<HTMLElement>(
    `[data-anim-path="${cssEscape(path)}"]`,
  );
  if (exact) return exact;
  const last = path.split(/[.[\]]/).filter(Boolean).pop();
  if (last) {
    const byId = root.querySelector<HTMLElement>(
      `[data-anim-id="${cssEscape(last)}"]`,
    );
    if (byId) return byId;
  }
  return root;
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/["\\]/g, "\\$&");
}
