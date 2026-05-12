# Solar

Scene runtime bundle for the Zablab broadcast platform.

Solar takes a render bundle (HTTP) plus a live state stream
(WebSocket from Orion v2) and produces the broadcast-quality DOM that
Pulsar's CEF browser source captures, that Prism's live control
panel displays, and that the editor preview iframe renders for
authoring.

## Hosts

| Host | Mode | What's visible |
|---|---|---|
| Pulsar CEF browser source | `broadcast` | The composed scene only — no UI |
| Prism live control panel | `control` | Scene + operator overlay |
| Editor preview iframe | `test` | Scene + adapter mocker + state inspector |

## Three consumers, one API

The same bundle backs three hosts with two public entry points :

```ts
// Live host — Pulsar CEF browser source, Prism live control panel,
// editor preview iframe. Drives off Orion's WS state stream.
import { mount } from "@zablab/solar";

const handle = mount({
  target: document.getElementById("scene")!,
  orionUrl: "wss://<gate>/orion/api/v1/show/stream",
  token: showToken,
  mode: "broadcast",
});
```

```ts
// Web embed — any HTML page, no Pulsar / CEF / Electron. Drives off
// a Prism-exported sceneJson + named animations.
import { PrismScene } from "@zablab/solar";

const scene = new PrismScene({ sceneJson });
scene.mount(document.querySelector("#container")!);
scene.playAnimation("Score Update", { score_to: 1891 });
```

Full integration guide : [`docs/embed-on-website.md`](./docs/embed-on-website.md).
Action descriptor reference : [`docs/action-descriptors.md`](./docs/action-descriptors.md).

## Status

Scaffold phase (2026-05-02). The `mount()` function validates options
and returns a typed handle ; transport, state, render and overlay
layers ship in subsequent commits. See
`../docs/roadmap/chantier-solar.md` for the live status and
`../docs/adr/{002,003}-*.md` for the binding contract.

## Stack

- TypeScript 5.7 strict
- React 19
- Tailwind 4
- Vite 6 (library mode → ESM bundle + CSS + types)
- `@preact/signals-react` for fine-grained reactivity
- Framer Motion 12 for tween / spring transitions
- Vitest (unit) + Playwright (E2E against mock-orion)

## Setup local

```bash
npm ci
npm run dev          # Vite dev server (HMR while iterating on src/)
npm run lint         # ESLint, --max-warnings 0
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests
npm run build        # Library build → dist/solar.{js,css} + types
npm run test:e2e     # Playwright (lands when mock-orion is wired)
```

## Distribution

Solar publishes as `@zablab/solar` to a private registry once one
exists. In the interim, consumers (Prism, Orion's static host)
vendor a built `dist/` keyed by version :

- Orion serves `/orion/static/solar/v{N.N.N}/...` — Pulsar CEF
  browser source URL.
- Prism vendors `Prism/resources/solar/v{N.N.N}/...` — webview load.

A breaking change to the render-bundle format bumps the major and
ships a migration helper in Orion's compiler. Compatibility within
a major is contractual.

## License

Proprietary — Zablab platform. See workspace governance under
`../docs/rules/`.
