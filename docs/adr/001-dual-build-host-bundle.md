# ADR 001 — Dual-build : library externals (Prism) + self-contained host bundle (CEF)

- **Status**: accepted
- **Date**: 2026-06-08
- **Decided**: 2026-06-08
- **Deciders**: @ClodoCapeo (maintainer)
- **Author**: Atlas (architect agent)
- **Supersedes**: —
- **Superseded by**: —

---

> **Why this ADR lives in `Solar/docs/adr/` and is numbered 001.** The artefact
> at fault is Solar's build output (`vite.config.ts`, `dist/solar.js`,
> `dist/index.html`). The per-repo ADR convention (Orion ADR 001/002, Prism
> ADR 001) puts an ADR in the repo that owns the contract gap; Solar owns this
> one. The Solar build/runtime decisions historically referenced by
> `Solar/CLAUDE.md` as `../docs/adr/002`, `003`, `007` are **design references,
> not committed artefacts** (verified: `Zab/docs/adr/` does not exist on disk;
> no `002`/`003`/`007` file exists anywhere in the tree). There is therefore no
> ADR to amend — this is a **new ADR**, and `001` is the first free number in
> Solar's own `docs/adr/`. It is a focused, traceable note for a patch-level
> build fix, not a re-litigation of the runtime architecture.

## 1. Context

The Solar bundle served by Orion at `/orion/static/solar/v0.2.0/` and loaded by
the Pulsar CEF browser source (`dist/index.html` → `import { mount } from
"./solar.js"`) is **broken in the browser**. `vite.config.ts` builds Solar in
**library mode** (`build.lib`, `formats: ["es"]`) and marks every runtime dep
as `rollupOptions.external` (`react`, `react-dom`, `@preact/signals(-react)`,
`framer-motion`, `motion*`). The emitted `solar.js` therefore contains **bare
ESM specifiers** the browser cannot resolve — the CEF has no bundler and no
import map, so `import "@preact/signals-react"` throws, `mount()` never runs,
and the broadcast frame stays black.

The library config is **correct** for the published consumer: `@zablab/solar` is
vendored by **Prism** (`resources/solar/v{N}/`), which re-bundles and supplies
React/Framer from its own tree. Externals are exactly what Prism wants — a small
bundle with deduped, host-owned deps. The same single artefact cannot satisfy
both consumers: Prism wants externals, the CEF/static-serve host wants a
**self-contained** bundle with every dep inlined.

This is the last blocker to broadcast: SETUP M8 is green, this is **B4**.

## 2. Decision drivers

- **D1 — CEF resolvability.** The served bundle must run in a bare browser/CEF
  with no bundler and no `<script type="importmap">`. No bare specifiers may
  survive in the served JS.
- **D2 — Don't break Prism.** `@zablab/solar`'s package entry
  (`dist/solar.js`, externals) is a contract Prism vendors. It must stay
  byte-shape-compatible: externals preserved, `exports` map unchanged.
- **D3 — Stable served contract.** The served form (`/static/solar/v{N}/index.html`
  + a JS file loaded via `import "./<js>"`) must not change shape. Orion serves
  it immutably (`internal/api/static.go`); Pulsar's CEF URL is wired to it.
  Only the *content* of the served JS may change (externals → inlined).
- **D4 — Single source, two outputs.** Both artefacts must come from the same
  `src/` and the same `npm run build`, so they never drift.
- **D5 — Provably correct.** "No bare specifier in the served bundle" must be a
  CI-enforced assertion on the artefact, not a manual eyeball.

## 3. Decision

### 3.1 Dual-build (chosen)

Keep the existing **library build** (externals) as the `@zablab/solar` package
entry for Prism. **Add a second Vite build — the "host / standalone app"
target — that inlines all runtime deps** (no externals) and is the artefact
Orion static-serves and the CEF loads.

| Concern | Library target (unchanged) | Host target (new) |
|---|---|---|
| Consumer | Prism (vendors, re-bundles) | Pulsar CEF / Orion static serve |
| Vite mode | `build.lib`, `formats:["es"]` | non-lib app build (no `build.lib`) |
| Deps | `rollupOptions.external` (react/preact/framer/motion) | **inlined** (no externals) |
| Entry | `src/index.ts` (public API) | host entry that `import`s `mount` + bootstraps |
| Output | `dist/solar.js` + `dist/solar.css` + types | `dist/host/` (self-contained `index.html` + hashed JS/CSS) |
| `package.json exports` | drives `import "@zablab/solar"` | **not** in `exports` — served, not imported |

Mechanics: two Vite config entry points (e.g. `vite.config.ts` =
library, `vite.config.host.ts` = host, or one config switched by
`--mode host`). `npm run build` runs **both** sequentially: library first
(package), then host (served bundle), then the host-html step. The host build
omits `external` entirely so Rollup inlines react/react-dom/preact-signals/
framer-motion into the chunks — zero bare specifiers remain.

`build-host-html.mjs` is reconciled with whatever the host build emits: if the
host build (app mode with an HTML entry) already produces a hashed `index.html`
that imports the hashed JS, the bespoke script is reduced or removed; otherwise
it keeps generating the bootstrap HTML but points at the host bundle's filename.
Forge decides the minimal mechanic; the **invariant** is the resolution
criteria below, not the script's shape.

### 3.2 Versioning — v0.2.1 (patch)

This changes **only the served artefact's bundling**, not the `mount()` /
`SolarError` public surface and not the LSDP wire dialect. Per `Solar/CLAUDE.md`
("Public surface = `mount()` + types"; breaking = major) and the CHANGELOG's
SemVer note, a build-packaging fix that leaves the API identical is a **patch**:
**v0.2.1**. The served path becomes `/orion/static/solar/v0.2.1/`.

### 3.3 Served contract (unchanged shape)

`/static/solar/v{N}/index.html` + a JS bundle loaded via `import "./<js>"`,
served immutably by Orion, composited transparently by Pulsar CEF. Same URL
shape, same bootstrap surface (URL params → `mount()`), same `#scene` target.
Only the served JS goes from "externals" to "self-contained". Conduit validates
the Orion↔Pulsar bundle contract; nothing else in the contract moves.

### 3.4 Alternatives rejected

- **(b) Import map + vendored ESM deps.** Host HTML injects
  `<script type="importmap">` and Orion serves ESM copies of each dep. Rejected:
  fragile (CEF/Chromium import-map quirks, per-dep ESM build maintenance, dep
  graph pinning by hand), multiplies served files, and re-introduces bare
  specifiers that only *happen* to resolve — exactly the failure class we are
  removing. Higher long-term cost, lower confidence. Violates D1's spirit (no
  import map) and D5 (hard to assert).
- **Single inlined build for everyone.** Drop externals globally so one bundle
  serves both. Rejected: breaks Prism (D2) — Prism would double-bundle React,
  inflating its webview and risking a duplicate-React runtime. The two consumers
  have genuinely opposite needs.
- **Manual import rewriting / esbuild post-step on `solar.js`.** Rejected:
  re-bundling the already-bundled artefact is brittle vs. letting Rollup inline
  from source in a second pass (D4).

## 4. Consequences

- `npm run build` produces **two** artefacts: the package entry (`dist/solar.js`,
  externals, for Prism) and the served host bundle (`dist/host/**`,
  self-contained, for CEF/Orion). Same `src/`, no drift (D4).
- Orion serves the host bundle at `/static/solar/v0.2.1/`. Prism keeps vendoring
  `@zablab/solar`'s package entry unchanged (D2).
- The served bundle is larger than the library one (deps inlined). The existing
  per-mode gzip budgets (`scripts/check-bundle-size.mjs`: broadcast ≤ 200 KiB,
  control ≤ 280 KiB) target the **library/runtime** chunks; the host bundle is a
  **new** artefact and needs its **own** budget line (deps inlined → necessarily
  bigger). Forge sets a host-bundle budget; it is not held to the library budget.
- A new CI assertion guards the served bundle against bare specifiers (D5).

## 5. Risks

- **R1 — Two configs drift.** Mitigation: both run under one `npm run build`;
  the anti-bare-specifier test fails CI if the host target ever regresses to
  externals. Residual: accepted (covered by test).
- **R2 — Host bundle size.** Inlining react+framer-motion inflates the served
  JS. Mitigation: dedicated host budget, tree-shaking preserved, broadcast mode
  stays tree-shakable (`Solar/CLAUDE.md`). Residual: accepted — correctness over
  a few KiB on a static-served, forever-cached artefact.
- **R3 — `build-host-html.mjs` / host-entry mismatch** (HTML points at a stale
  JS filename). Mitigation: the served-bundle smoke test (loads in a real browser
  with no import map) catches it. Residual: accepted (covered by test).
- **Security**: no new network surface, no new secret, no auth/deps change — the
  served bundle gains vendored copies of deps already in `package.json`. No new
  threat surface; **Bastion clearance is a formality, not a blocker** (no
  sensitive surface touched). Flagged for Bastion to confirm in `/feature`.

## 6. Resolution criteria

1. `npm run build` emits **two** artefacts: the unchanged library entry
   (`dist/solar.js`, externals preserved for `@zablab/solar`/Prism) **and** the
   host bundle under `dist/host/**`.
2. The served host JS bundle contains **zero bare ESM specifiers** — asserted by
   a test that scans the built artefact for `import`/`from` of a non-relative,
   non-absolute specifier (react, react-dom, @preact/signals-react,
   @preact/signals-react/runtime, framer-motion, motion*, react/jsx-runtime,
   …). The test fails if any survive.
3. The served `dist/host/index.html` + JS **load and `mount()` in a real browser
   with no import map** (Playwright, against mock-orion): `#scene` mounts, no
   unresolved-module console error.
4. Prism's consumption is unaffected: `import { mount } from "@zablab/solar"`
   still resolves to the externals build; `exports` map unchanged; library gzip
   budgets still pass.
5. Version bumped to **0.2.1** in `package.json` + CHANGELOG entry under
   `[0.2.1]`; `meta[name=generator]` reflects `0.2.1`.
6. CI runs the anti-bare-specifier assertion and the browser smoke test as gates.
