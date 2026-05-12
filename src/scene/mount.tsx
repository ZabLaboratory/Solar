// Minimal React mount for PrismScene. The "render tree" here is
// intentionally just an invisible probe : PrismScene v1 binds against
// host-authored DOM via data attributes (see ./binder.ts) rather than
// owning the layout tree. The React root exists so future versions
// can swap in the full Solar primitives renderer without a public-
// API break.

import { createRoot, type Root } from "react-dom/client";
import { createElement, type ReactElement } from "react";
import type { Store } from "../state/store";

export interface SceneRoot {
  dispose(): void;
}

function ProbeMarker(): ReactElement {
  return createElement("template", {
    "data-solar-scene": "1",
    "aria-hidden": "true",
  });
}

export function renderScene(target: HTMLElement, _store: Store): SceneRoot {
  // Attach a tiny React island so consumers can confirm the bundle is
  // active without touching their own DOM. The probe is a <template>
  // so it doesn't render visually.
  const host = target.ownerDocument.createElement("div");
  host.setAttribute("data-solar-root", "1");
  host.style.cssText = "display:contents";
  target.appendChild(host);

  const root: Root = createRoot(host);
  root.render(createElement(ProbeMarker));

  return {
    dispose() {
      root.unmount();
      if (host.parentNode) host.parentNode.removeChild(host);
    },
  };
}
