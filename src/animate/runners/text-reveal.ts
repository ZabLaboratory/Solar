// text-reveal — stagger child elements that the host marked with the
// configured selector. The runner toggles `data-anim-state` on each
// child and animates opacity + transform via WAAPI ; CSS authored by
// the host can hook into the state attribute for richer effects.
//
// Params :
//   - unit            : "letter" | "word" — informational, the host
//                       decides how to split. Default "letter".
//   - stagger_ms      : delay between consecutive children. Default 30.
//   - per_unit_ms     : duration of each unit's animation. Default 240.

import type { ActionRunner } from "../action-runner";
import { runChildStagger } from "./stagger-group";

export const runTextReveal: ActionRunner = async (ctx) => {
  // text-reveal is a stagger-group with text-friendly defaults.
  await runChildStagger(ctx, {
    defaultStaggerMs: 30,
    defaultPerUnitMs: 240,
    defaultSelector: "[data-anim-unit]",
    stateAttr: "data-anim-state",
  });
};
