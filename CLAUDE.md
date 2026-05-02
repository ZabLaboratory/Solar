# Solar

@../../docs/rules/git.md
@../../docs/rules/security.md
@../../docs/rules/agents.md
@../agents/_shared/architecture.md
@../agents/_shared/conventions.md
@../agents/_shared/deploy.md
@../agents/_shared/projects.md

## Description

Solar is the canonical scene-runtime bundle for the Zablab broadcast
platform. The same bundle runs in three hosts (Pulsar CEF browser
source, Prism live-control webview, editor preview iframe) and
turns Orion's WS state stream + a content-hashed render bundle into
the broadcast-quality DOM the operator authored in Canvas/Logic.

Solar holds no logic of its own. Logic lives in Orion's graph
artifact ; Canvas declares the layout ; Solar receives leaf-addressed
deltas and projects them onto a React tree of primitives. New widget
kinds are *user components* authored in Canvas and inlined by Orion
at push time — Solar releases are reserved for new rendering
capabilities (a chart, a WebGL surface), never new visual designs.

## Stack

- **Runtime** : Node ≥ 20 (build-time only — Solar runs in browsers)
- **Language** : TypeScript 5.7 strict
- **UI** : React 19 + Tailwind 4
- **Reactivity** : `@preact/signals-react` (one signal per leaf path)
- **Animation** : Framer Motion 12 (tween + spring) + thin `<Crossfade>`
- **Build** : Vite 6 library mode → ESM bundle + CSS + types
- **Test** : Vitest (unit) + Playwright (E2E against mock-orion)
- **Distribution** : `@zablab/solar` private package ; vendored by
  Prism into `resources/solar/v{N.N.N}/`, statically served by Orion
  at `/orion/static/solar/v{N.N.N}/`. No public npm.

## Setup local

```bash
# Installation
npm ci

# Dev server (HMR while iterating on src/)
npm run dev

# Lint + typecheck + tests + build
npm run lint
npm run typecheck
npm test
npm run build

# E2E (lands once mock-orion is wired)
npm run test:e2e

# Format
npm run format

# Variables d'environnement
# Solar n'a pas de variable d'environnement runtime ; toute la
# configuration arrive via les paramètres de mount(). Si un
# développement futur introduit une variable build-time, elle est
# documentée ici et le secret correspondant vit à l'étage 1
# (`../.env.solar`) — jamais dans le repo.
```

## Conventions spécifiques

- **Public surface = `mount()` + types** — toute extension de l'API
  publique est une décision contractuelle (Prism / Pulsar dépendent).
  Les changements breaking bumpent le major du paquet.
- **Render bundles content-hashed** — Solar fetch `?v={hash}` et le
  cache forever. Aucune logique de "rafraîchir si vieux" : l'identité
  du bundle est son hash.
- **Reactivity = leaf-grain** — un patch ADR 002 = un signal mis à
  jour = re-render uniquement des composants qui lisent ce signal.
  Pas de réconciliation custom dans Solar ; Preact Signals + React
  font le travail.
- **GPU-only animations** — les primitives ne permettent pas
  d'animer `width` / `height` / `top` / `left`. Seuls `transform`,
  `opacity` et `filter` sont animables. Le composant qui voudrait
  contredire échoue à la review.
- **`broadcast` mode est tree-shakable** — le code de l'overlay
  n'apparaît pas dans le bundle quand le mode est `broadcast`. CI
  vérifie le budget de taille.
- **Pas de logs en `broadcast`** — Solar en mode broadcast ne doit
  jamais afficher de chrome de plateforme (status pill, erreur en
  bandeau, etc.). Les erreurs remontent par `onError` au host.
- **State management** : `@preact/signals-react` (pas de Redux, pas
  de Zustand). La store Zustand-style éventuelle pour l'overlay
  test mode est local au composant, pas une dépendance Solar.
- **Error handling** : toute erreur traverse `onError` avec un type
  `SolarError` ; aucune erreur silencieuse, aucune erreur en console
  visible côté broadcast.

## Test Coverage

| Type | Seuil minimum | Mesure |
|---|---|---|
| Public API surface (`mount`, types) | 100 % de l'option-validation | `vitest --coverage` |
| Transport (codec, sequence, reconnect) | 90 % | `vitest --coverage` |
| State (apply-snapshot, apply-delta) | 90 % | `vitest --coverage` |
| Render primitives | 70 % (DOM smoke) | Vitest + happy-dom |
| Animation engine (composition rule) | empirique via Playwright | `npm run test:e2e` |

## Performance

| Métrique | Budget | Mesure |
|---|---|---|
| `mount()` → first paint avec snapshot prêt | < 100 ms | Playwright `performance.mark` |
| Delta → DOM update | ≤ 50 ms | Playwright `performance.mark` |
| Bundle ESM `broadcast` (gzipped) | ≤ 200 KiB | `scripts/check-bundle-size.mjs` (CI) |
| Bundle ESM `control` (gzipped) | ≤ 280 KiB | `scripts/check-bundle-size.mjs` (CI) |
| Animation hot path | 0 layout events | DevTools perf trace en E2E |

Critères de résolution complets : `../docs/roadmap/chantier-solar.md`.

## CI/CD

- **Push sur branche** : `npm ci && npm run lint && npm run typecheck && npm test && npm run build`.
- **PR vers main** : ci.yml + bundle-size budget + Playwright E2E
  (mock-orion). Security audit hérité de la CI workspace.
- **Merge sur main** : pas de deploy automatique (Solar est un
  artefact à vendor / static-serve).
- **Tag semver** : déclenche un build de release qui publie
  `dist/` versionné, consommable par Orion (static) et Prism
  (vendor).

## Decisions

- **2026-05-02** — bundle JSON (pas CBOR). Empreinte texte
  privilégiée à l'efficience binaire à ce stade. Décision tracée
  dans `../docs/adr/002-runtime-ws-protocol.md` § 1.
- **2026-05-02** — primitives fermées + user components ouverts.
  Solar versionne le runtime ; les nouveaux widgets sont des
  compositions Canvas-side, pas des releases Solar. Décision tracée
  dans `../docs/adr/003-solar-scene-runtime.md` § 6.
- **2026-05-02** — `@preact/signals-react` retenu pour la
  reactivity. Alternative considérée : Zustand fine-grained ; le
  fan-out implicite des signals colle mieux au modèle leaf-grain
  des deltas Orion. Décision tracée dans
  `../docs/adr/003-solar-scene-runtime.md` § 1.
- **2026-05-02** — Framer Motion 12 retenu pour tween/spring,
  malgré ~70 KiB. Réécriture custom envisagée seulement si le
  budget bundle se serre. Décision tracée dans
  `../docs/adr/003-solar-scene-runtime.md` § 5.
