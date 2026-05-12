// FLIP (First-Last-Invert-Play) — shared between Solar's reorder
// runner and Prism's preview flip-runtime.
//
// This module is the **single source of truth** for FLIP behaviour
// across the platform : Solar's action-runner imports it directly,
// Prism imports it via `@zablab/solar/animate/flip`. Once published,
// the API is contract — additive changes only without a major bump.
//
// Operating mode :
//   1. `captureFlip(root)` — measure FIRST positions of every node
//      matching the selector (default `[data-flip-id]`).
//   2. The host mutates the DOM (insertion, reorder, removal …).
//   3. `playFlip(root, prev, options)` — measure LAST positions,
//      INVERT each delta (translate node back to its old position
//      with no transition), then PLAY (animate translate(0,0)).
//
// All animations run via the Web Animations API on `transform` only
// (GPU-friendly, no layout cost). Nodes without a previous rect are
// skipped — they were just inserted and have no "first" to interpolate
// from. Removals are out of scope of FLIP itself (handled by the
// host's exit transition).

export interface FlipSnapshot {
  rects: Map<string, DOMRect>;
}

export interface FlipPlayOptions {
  duration?: number;
  /** CSS / WAAPI easing string. */
  easing?: string;
  /** Override of the FLIP marker selector (default `[data-flip-id]`). */
  selector?: string;
}

const DEFAULT_SELECTOR = "[data-flip-id]";

function flipIdOf(el: HTMLElement, attr: string): string | null {
  if (attr === "[data-flip-id]") {
    return el.dataset.flipId ?? null;
  }
  return el.getAttribute(attr.replace(/^\[|\]$/g, "")) ?? null;
}

export function captureFlip(
  root: HTMLElement,
  selector: string = DEFAULT_SELECTOR,
): FlipSnapshot {
  const rects = new Map<string, DOMRect>();
  const nodes = root.querySelectorAll<HTMLElement>(selector);
  nodes.forEach((el) => {
    const id = flipIdOf(el, selector);
    if (id) rects.set(id, el.getBoundingClientRect());
  });
  return { rects };
}

export async function playFlip(
  root: HTMLElement,
  prev: FlipSnapshot,
  options: FlipPlayOptions = {},
): Promise<void> {
  const duration = options.duration ?? 400;
  const easing = options.easing ?? "cubic-bezier(0.22, 1, 0.36, 1)";
  const selector = options.selector ?? DEFAULT_SELECTOR;

  const animations: Animation[] = [];
  const nodes = root.querySelectorAll<HTMLElement>(selector);
  nodes.forEach((el) => {
    const id = flipIdOf(el, selector);
    if (!id) return;
    const prevRect = prev.rects.get(id);
    if (!prevRect) return;
    const nextRect = el.getBoundingClientRect();
    const dx = prevRect.left - nextRect.left;
    const dy = prevRect.top - nextRect.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    if (typeof el.animate !== "function") return;
    const anim = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration, easing, fill: "both" },
    );
    animations.push(anim);
  });
  await Promise.all(
    animations.map((a) =>
      a.finished.then(
        () => undefined,
        () => undefined,
      ),
    ),
  );
}

/** Convenience helper for runners that own the mutation themselves. */
export async function withFlip(
  root: HTMLElement,
  mutate: () => void | Promise<void>,
  options?: FlipPlayOptions,
): Promise<void> {
  const snapshot = captureFlip(root, options?.selector);
  await mutate();
  await playFlip(root, snapshot, options);
}
