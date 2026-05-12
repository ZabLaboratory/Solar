// Scene binder — wire the host's static HTML to the store.
//
// Any element marked with `data-anim-path="<path>"` has its textContent
// updated whenever the matching signal changes. Elements with
// `data-anim-attr="<attr>"` receive an attribute update instead.
//
// This is intentionally a thin one-way binding ; the host owns the
// DOM structure, Solar owns the values. Two-way input binding is out
// of scope for the public embed API in v1.

import { effect } from "@preact/signals-react";
import type { Store } from "../state/store";

export interface SceneBinder {
  dispose(): void;
}

const PATH_ATTR = "data-anim-path";

export function bindScene(root: HTMLElement, store: Store): SceneBinder {
  const disposers: Array<() => void> = [];
  const nodes = root.querySelectorAll<HTMLElement>(`[${PATH_ATTR}]`);
  nodes.forEach((el) => {
    const path = el.getAttribute(PATH_ATTR);
    if (!path) return;
    const targetAttr = el.getAttribute("data-anim-attr");
    const sig = store.signal(path);
    const dispose = effect(() => {
      const value = sig.value;
      if (targetAttr) {
        if (value === null || value === undefined) {
          el.removeAttribute(targetAttr);
        } else {
          el.setAttribute(targetAttr, String(value));
        }
      } else {
        el.textContent = value === undefined || value === null ? "" : String(value);
      }
    });
    disposers.push(dispose);
  });

  return {
    dispose() {
      for (const d of disposers) {
        try {
          d();
        } catch {
          /* noop */
        }
      }
    },
  };
}
