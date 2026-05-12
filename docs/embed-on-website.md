# Embedding Solar in a website

`@zablab/solar` ships a public class `PrismScene` that lets any web
host run a Prism-authored scene without Pulsar, CEF, or Electron.
The same bundle backs **three consumers** with an identical API :

1. **Prism preview** — Electron webview.
2. **Pulsar broadcast** — CEF browser source.
3. **Arbitrary web embed** — any HTML page.

This document is the integration guide for the third one. The first
two are produced by Prism's build pipeline and need no extra wiring.

---

## 1. What you need

A `sceneJson` exported from Prism (see `Prism → Scene → Export`). It
is a plain JSON document — no JavaScript, no remote import, no
arbitrary code execution. Solar binds the scene to your DOM via
`data-anim-path` attributes.

```ts
interface SceneJson {
  scene_id?: string;
  state?: Record<string, unknown>;       // initial leaf values
  html?: string;                         // optional static HTML
  animations?: Record<string, AnimationDef>;
}

interface AnimationDef {
  patches: Patch[];                      // ordered playback
  duration_ms?: number;
}
```

## 2. Quickstart — vanilla JavaScript

Drop a `<script>` tag on your page :

```html
<!doctype html>
<html>
  <head>
    <script crossorigin src="https://unpkg.com/react@19/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/@zablab/solar/dist/solar.umd.js"></script>
  </head>
  <body>
    <div id="scene"></div>

    <script>
      const scene = new Solar.PrismScene({
        sceneJson: {
          state: { "score.value": 0 },
          html: `
            <div class="card">
              <p>Score</p>
              <h1 data-anim-path="score.value">0</h1>
            </div>
          `,
          animations: {
            "Score Update": {
              patches: [
                {
                  path: "score.value",
                  value: "${param.score_to}",
                  action: {
                    kind: "count-up",
                    params: { from: 0, to: "${param.score_to}" },
                    duration_ms: 800,
                  },
                },
              ],
            },
          },
        },
      });

      scene.mount(document.querySelector("#scene"));
      scene.on("animation:completed", ({ asset_id }) => {
        console.log(asset_id, "done");
      });
      scene.playAnimation("Score Update", { score_to: 1891 });
    </script>
  </body>
</html>
```

A working copy lives at `examples/embed-vanilla/`.

## 3. Quickstart — React

```tsx
import { useEffect, useRef } from "react";
import { PrismScene, type SceneJson } from "@zablab/solar";

const SCENE: SceneJson = {
  state: { "score.value": 0 },
  html: `<h1 data-anim-path="score.value">0</h1>`,
  animations: {
    "Score Update": {
      patches: [
        {
          path: "score.value",
          value: "${param.score_to}",
          action: {
            kind: "count-up",
            params: { from: 0, to: "${param.score_to}" },
            duration_ms: 800,
          },
        },
      ],
    },
  },
};

export function PrismSceneEmbed({ score }: { score: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PrismScene | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const scene = new PrismScene({ sceneJson: SCENE });
    scene.mount(ref.current);
    sceneRef.current = scene;
    return () => scene.unmount();
  }, []);

  useEffect(() => {
    sceneRef.current?.playAnimation("Score Update", { score_to: score });
  }, [score]);

  return <div ref={ref} />;
}
```

A working copy lives at `examples/embed-react/`.

## 4. Public API — `PrismScene`

```ts
class PrismScene {
  constructor(opts: { sceneJson: SceneJson; mockMode?: boolean });

  mount(target: HTMLElement): void;
  unmount(): void;

  playAnimation(assetId: string, params?: Record<string, unknown>): Promise<void>;
  stopAnimation(assetId: string): void;

  on(event: PrismSceneEvent, handler: AnimationHandler): void;
  off(event: PrismSceneEvent, handler: AnimationHandler): void;

  connectToOrion(opts: { url: string; token: string }): void;
  disconnectFromOrion(): void;

  setScene(sceneJson: SceneJson): void;
}
```

### Events

| Event                 | Payload                              | Fires…                              |
| --------------------- | ------------------------------------ | ----------------------------------- |
| `animation:start`     | `{ asset_id, params? }`              | …when `playAnimation()` begins.     |
| `animation:completed` | `{ asset_id, params? }`              | …when playback finishes cleanly.    |
| `animation:error`     | `{ asset_id, params?, error }`       | …on a failure (unknown asset, runner error, double-play). |

### Concurrency

A given `assetId` cannot play twice at once — the second call
rejects with `code: "ALREADY_PLAYING"`. Use `stopAnimation(assetId)`
to abort an in-flight run before re-playing it. Different
`assetId`s play independently.

### `${param.*}` interpolation

`playAnimation("Score Update", { score_to: 1891 })` substitutes
`${param.score_to}` everywhere it appears in `patches[*].path`,
`patches[*].value`, and `patches[*].action.params`. Whole-string
tokens (`"${param.score_to}"`) round-trip the raw param value, so
numbers stay numbers.

### Hot-reload

`setScene(json)` swaps the scene without dismounting React. State
resets to the new `state` map and DOM rebinds against the new
`html` if provided.

### Connecting to Orion (optional)

`connectToOrion({ url, token })` opens an authenticated WS to
`wss://<gate>/orion/api/v1/show/stream`. Snapshots reseed the store,
deltas patch it. The embed runs fully without this connection — call
it only when you need live triggers from a running show.

`mockMode: true` makes `connectToOrion()` a no-op (useful for offline
previews in CI).

## 5. DOM contract

Solar binds **one-way** : your DOM declares anchor points, Solar
writes into them.

| Attribute              | Behaviour                                                       |
| ---------------------- | --------------------------------------------------------------- |
| `data-anim-path="x.y"` | The element's `textContent` mirrors the store value at `x.y`.   |
| `data-anim-attr="src"` | Combined with `data-anim-path`, the named attribute (here `src`) is updated instead of `textContent`. |
| `data-anim-id="foo"`   | Action runners (text-reveal, mask-reveal) use this as a target alias. |
| `data-anim-unit`       | Marks a child unit for `text-reveal`.                           |
| `data-anim-child`      | Marks a child unit for `stagger-group`.                         |
| `data-flip-id="k"`     | Identifies a list item for `reorder` (FLIP).                    |

Two-way bindings (user input) are out of scope for the v1 embed API.

## 6. Action descriptors

Each patch can optionally carry an `action` descriptor that triggers
a richer animation (count-up, FLIP reorder, mask reveal …). The full
reference lives in [`action-descriptors.md`](./action-descriptors.md).

## 7. Bundle layout

| Path                              | Format | Purpose                                          |
| --------------------------------- | ------ | ------------------------------------------------ |
| `dist/solar.js`                   | ESM    | Main bundle — `import { PrismScene } from "@zablab/solar"`. |
| `dist/solar.esm.js`               | ESM    | Alias of `solar.js` for ESM-friendly tooling.    |
| `dist/solar.umd.js`               | UMD    | `<script>`-tag embed — exposes `window.Solar.PrismScene`. |
| `dist/solar.d.ts`                 | dts    | Public type definitions.                         |
| `dist/animate/flip.js`            | ESM    | FLIP subpath consumed by Prism preview.          |

React and react-dom are **peer dependencies** — the host loads them
once and Solar links against the host's copies. The UMD bundle
expects `window.React` and `window.ReactDOM` to be set before the
`<script>` tag.

## 8. Performance notes

- `count-up` at 60 Hz × 800 ms = ~48 ticks of JS work, negligible.
- `curve-path` pre-samples its curve and walks the buffer ; no
  `getPointAtLength` calls on the hot path.
- All DOM-side animations (text-reveal, mask-reveal, FLIP) ride
  WAAPI on `opacity`, `transform`, and `clip-path` only —
  GPU-friendly, no layout cost.
- A v1 stress test is intentionally absent. Pick `mockMode` for CI
  if you don't want WebSocket noise.

## 9. Versioning

Once published, the `PrismScene` API and the `Patch.action` schema
are a contract. Breaking either requires a major bump of
`@zablab/solar`. Additive changes (new action kind, new optional
event) stay on minor bumps.
