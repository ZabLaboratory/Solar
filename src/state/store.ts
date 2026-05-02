// State store — one signal per leaf path.
//
// The store is the integration point between the WS layer (which
// produces snapshots and deltas) and the render layer (which subscribes
// signals to React components). Each leaf path Solar has ever seen has
// a `Signal<unknown>` owned by the store ; readers subscribe via
// @preact/signals-react `useSignals()` and re-render when the value
// changes.
//
// Transitions ride alongside the value : every set carries an optional
// transition that the render layer can read on the same tick. We
// store the latest transition per path in a parallel map ; readers
// consume it on signal change.

import { signal, type Signal, batch } from "@preact/signals-react";
import type { Transition } from "../transport/protocol";

export interface Store {
  /** Get-or-create the signal for a path. New paths start as
   *  `undefined`. */
  signal(path: string): Signal<unknown>;
  /** Return the latest transition seen for this path, if any. */
  transitionFor(path: string): Transition | undefined;
  /** Apply a single leaf write. Optionally records the transition. */
  set(path: string, value: unknown, transition?: Transition): void;
  /** Replace the whole state — used by `apply-snapshot`. Existing
   *  signals are reused so subscribers stay attached ; missing keys
   *  reset to `undefined`. Transitions are cleared (a snapshot is the
   *  baseline, no animation context). */
  reset(state: Record<string, unknown>): void;
  /** Snapshot of every known path → current value. For debug /
   *  test-mode state inspector. */
  toRecord(): Record<string, unknown>;
}

class StoreImpl implements Store {
  private readonly signals = new Map<string, Signal<unknown>>();
  private readonly transitions = new Map<string, Transition>();

  signal(path: string): Signal<unknown> {
    let s = this.signals.get(path);
    if (!s) {
      s = signal<unknown>(undefined);
      this.signals.set(path, s);
    }
    return s;
  }

  transitionFor(path: string): Transition | undefined {
    return this.transitions.get(path);
  }

  set(path: string, value: unknown, transition?: Transition): void {
    if (transition) {
      this.transitions.set(path, transition);
    } else {
      this.transitions.delete(path);
    }
    const s = this.signal(path);
    if (!shallowEqual(s.peek(), value)) {
      s.value = value;
    }
  }

  reset(state: Record<string, unknown>): void {
    batch(() => {
      this.transitions.clear();
      // Update existing signals first (so subscribers stay attached
      // to the same signal instance), then prune ones the snapshot
      // doesn't have.
      const seen = new Set<string>();
      for (const [path, value] of Object.entries(state)) {
        seen.add(path);
        const s = this.signal(path);
        if (!shallowEqual(s.peek(), value)) {
          s.value = value;
        }
      }
      for (const path of this.signals.keys()) {
        if (!seen.has(path)) {
          const s = this.signals.get(path);
          if (s && s.peek() !== undefined) s.value = undefined;
        }
      }
    });
  }

  toRecord(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [path, s] of this.signals.entries()) {
      out[path] = s.peek();
    }
    return out;
  }
}

export function createStore(): Store {
  return new StoreImpl();
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (ao[k] !== bo[k]) return false;
  }
  return true;
}
