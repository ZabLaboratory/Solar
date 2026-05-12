# Solar — React embed example

Two files :

- `PrismSceneEmbed.tsx` — a `forwardRef` wrapper that owns the
  PrismScene lifecycle (mount/unmount), forwards `play` props as
  imperative triggers, and surfaces `animation:completed` /
  `animation:error` as callbacks.
- `App.tsx` — example consumer.

## Drop-in usage

```bash
npm install @zablab/solar react@^19 react-dom@^19
```

```tsx
import { PrismSceneEmbed } from "@zablab/solar-examples/embed-react/PrismSceneEmbed";
// …or copy the file into your own project, it has no external
// dependency beyond @zablab/solar itself.

<PrismSceneEmbed
  scene={mySceneJson}
  play={{ assetId: "Score Update", params: { score_to: 1891 } }}
  onCompleted={(id) => console.log(id, "done")}
/>
```

See `../../docs/embed-on-website.md` for the full integration guide
including action descriptors, DOM contract, and lifecycle.
