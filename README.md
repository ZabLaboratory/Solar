# Solar

[![Release](https://img.shields.io/github/v/release/ZabLaboratory/Solar?logo=github)](https://github.com/ZabLaboratory/Solar/releases/latest)
[![CI](https://github.com/ZabLaboratory/Solar/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ZabLaboratory/Solar/actions/workflows/ci.yml)
[![Prism runtime release](https://img.shields.io/badge/Prism-local%20bundle-0f766e)](https://github.com/ZabLaboratory/Solar/releases/latest)

Scene runtime bundle for the Zablab broadcast platform.

Solar takes a render bundle (HTTP) plus a live state stream
(WebSocket from Orion v2) and produces the broadcast-quality DOM that
Pulsar's CEF browser source captures, that Prism's live control
panel displays, and that the editor preview iframe renders for
authoring.

## Hosts

| Host                      | Mode        | What's visible                           |
| ------------------------- | ----------- | ---------------------------------------- |
| Pulsar CEF browser source | `broadcast` | The composed scene only — no UI          |
| Prism live control panel  | `control`   | Scene + operator overlay                 |
| Editor preview iframe     | `test`      | Scene + adapter mocker + state inspector |

## Public API

```ts
import { mount } from "@zablab/solar";

const handle = mount({
  target: document.getElementById("scene")!,
  orionUrl: "wss://<gate>/orion/api/v1/show/stream",
  token: showToken,
  mode: "broadcast",
});

// later
handle.setToken(rotatedToken);
handle.disconnect();
```

The complete typed surface lives in `src/types/index.ts`.

## Status

Solar v2 is the versioned scene runtime used by the local Prism preview,
on-air surface and Pulsar CEF browser source. `mount()` owns the transport,
state, render and overlay layers for those hosts; the same host bundle is
also available to Orion's static serving path.

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
npm run build        # Dual build: dist/solar.{js,css}+types (library, for
                     #   Prism) AND dist/host/** (self-contained, for the
                     #   CEF / Orion static serve). See ADR 001.
npm run test:e2e     # Playwright served-bundle smoke test (no import map)
```

## Distribution

Solar publishes as `@zablab/solar` to a private registry once one
exists. In the interim, consumers vendor a built artefact keyed by
version. The two consumers have opposite bundling needs, so the build
emits **two** artefacts (ADR 001) :

- **Orion static serve → Pulsar CEF.** Serves `dist/host/**` at
  `/orion/static/solar/v{N.N.N}/...` — a **self-contained** bundle with
  every runtime dep inlined (no bare specifiers; the CEF has no bundler
  and no import map). This is the `index.html` the browser source loads.
- **Prism webview.** Vendors the **library** entry (`dist/solar.js`,
  externals) into `Prism/resources/solar/v{N.N.N}/...`; Prism re-bundles
  and supplies React / Framer from its own tree.

A breaking change to the render-bundle format bumps the major and
ships a migration helper in Orion's compiler. Compatibility within
a major is contractual.

## Release and local cache

Every `vX.Y.Z` tag publishes `solar-runtime-manifest.json` alongside the
versioned `solar-vX.Y.Z.tgz` bundle. Prism checks that manifest after login,
downloads and verifies the digest when needed, then stores the immutable
bundle in its local Solar cache. A suffix tag such as `v2.0.0b` is accepted
for a proof release without changing the base package version. The render
path does not download Solar during a scene switch.

## License

Proprietary — Zablab platform. See workspace governance under
`../docs/rules/`.
