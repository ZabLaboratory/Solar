# Action descriptors — `Patch.action` reference

This document is the contract for the `Patch.action` extension of
the Solar wire protocol (`src/transport/protocol.ts`). It is the
authority Prism's compiler targets when producing the deltas Solar
consumes.

The descriptor model is **additive and backward-compatible**. A
patch without `action` flows through the existing
`animate/transitions.ts` mapper untouched. A patch with `action` is
handed to the dispatcher in `animate/action-runner.ts`, which routes
to the matching sub-runner based on `action.kind`.

Once `@zablab/solar` is published, the **shape of `ActionDescriptor`
and the names of `ActionKind` are public contract**. Adding a new
kind is a minor bump ; renaming or removing a kind is a major bump.

---

## 1. Shape

```ts
interface Patch {
  path: string;
  value: unknown;
  transition?: Transition;
  action?: ActionDescriptor;
}

interface ActionDescriptor {
  kind:
    | "count-up"
    | "curve-path"
    | "text-reveal"
    | "stagger-group"
    | "reorder"
    | "mask-reveal";
  params: Record<string, unknown>;
  easing?: string | { stiffness: number; damping: number };
  duration_ms?: number;
  stops?: Array<{ at_pct: number; value: unknown; easing?: string }>;
  curve?: {
    anchors: Array<{
      t_pct: number;
      value: number;
      in_tangent?: { dt: number; dv: number };
      out_tangent?: { dt: number; dv: number };
    }>;
    sample_hz: 30 | 60;
  };
  child_selector?: {
    kind: "index" | "all" | "css-selector";
    value: number | string;
  };
}
```

## 2. Supported kinds

### `count-up`

Numeric tween of a single leaf path.

| Param      | Type   | Default | Description                                |
| ---------- | ------ | ------- | ------------------------------------------ |
| `from`     | number | `0`     | Starting value.                            |
| `to`       | number | `patch.value` if numeric, else `0` | Ending value. |
| `decimals` | number | `0`     | Decimal places for intermediate writes.    |

Writes to `patch.path` at every animation frame via the store.

### `curve-path`

Sample a Bézier-anchored curve and write each sample.

Reads `action.curve.anchors[]` and `action.curve.sample_hz`. Tangents
default to `{dt:0,dv:0}` (linear segments) when omitted.

### `text-reveal`

DOM-side staggered reveal of children matching the configured
selector (default `[data-anim-unit]`). Each child animates `opacity`
and `translateY` ; the runner additionally toggles
`data-anim-state="in"` so CSS can hook into the reveal lifecycle.

| Param         | Type   | Default | Description                          |
| ------------- | ------ | ------- | ------------------------------------ |
| `stagger_ms`  | number | `30`    | Delay between consecutive children.  |
| `per_unit_ms` | number | `240`   | Duration of each unit's animation.   |
| `from_opacity`| number | `0`     | Starting opacity.                    |
| `from_y`      | number | `8`     | Starting translateY in px.           |

Resolution order for the target element : `[data-anim-path=<patch.path>]`
→ `[data-anim-id=<last segment>]` → the mount target itself.

### `stagger-group`

Generic flavour of `text-reveal` with different defaults
(`stagger_ms=60`, `per_unit_ms=320`, selector `[data-anim-child]`).

### `reorder`

FLIP-animated reorder of a list. Operating mode :

1. Capture FIRST positions of all `[data-flip-id]` children of the
   target root.
2. Write `patch.value` (the new ordering) to the store. React
   re-renders the list with the new order.
3. After one animation frame, measure LAST, INVERT each delta, PLAY
   `translate(0,0)` via WAAPI.

The FLIP technique is provided by `@zablab/solar/animate/flip` —
Prism's preview consumes the same module directly so both runtimes
share a single FLIP implementation.

| Param        | Type   | Default            | Description                          |
| ------------ | ------ | ------------------ | ------------------------------------ |
| `selector`   | string | `[data-flip-id]`   | Override the FLIP marker selector.   |
| `duration_ms`| number | `action.duration_ms ?? 400` | Animation duration in ms.   |

### `mask-reveal`

Animate the target's `clip-path` from a hidden state to fully
revealed.

| Param       | Value                                                                 | Default          |
| ----------- | --------------------------------------------------------------------- | ---------------- |
| `direction` | `left-to-right` `right-to-left` `top-to-bottom` `bottom-to-top` `center-out` | `left-to-right`  |

## 3. Easing

`action.easing` accepts :

- A string id resolved by `animate/easing-resolver.ts` :
  `linear`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-in`,
  `cubic-out`, `cubic-in-out`.
- An inline spring config : `{ stiffness, damping }`. Approximated
  as `cubic-bezier(0.22, 1, 0.36, 1)` for the CSS facet.

Omitting `easing` defaults to `cubic-out`.

## 4. Compatibility guarantees

- A `Patch` without `action` is rendered exactly as in Solar v0.1 —
  the existing `transitions.ts` test suite remains green without
  modification.
- Unknown `action.kind` raises `UnknownActionKindError` at dispatch
  time so the host's `animation:error` event can surface the bad
  payload.
- Hosts can register custom kinds via `registerActionRunner(kind, fn)`
  ; built-in kinds always take precedence (the registry overwrites
  in-place).

## 5. Related modules

| Module                                | Purpose                                         |
| ------------------------------------- | ----------------------------------------------- |
| `src/transport/protocol.ts`           | Wire types — `Patch`, `ActionDescriptor`, …     |
| `src/animate/action-runner.ts`        | Dispatcher.                                     |
| `src/animate/runners/*.ts`            | Per-kind implementations.                       |
| `src/animate/flip.ts`                 | FLIP — shared with Prism preview.               |
| `src/animate/easing-resolver.ts`      | `EasingRef` → CSS string + `t → eased t`.       |
| `src/scene/prism-scene.ts`            | Public `PrismScene` class consuming all of above. |
