// Acceptance and adversarial scene fixtures used by both unit tests
// and the mock-orion server. They live in tests/ rather than src/
// because they aren't shipped — the bundle for a real scene comes
// from Orion's compiler at push time.

import type { RenderBundle } from "../../src/render/bundle";

export const ACCEPTANCE_SCENE_ID = "acceptance-scene";
export const ACCEPTANCE_SCENE_VERSION = "sha256:acceptance-v1";

export const ACCEPTANCE_BUNDLE: RenderBundle = {
  scene_version: ACCEPTANCE_SCENE_VERSION,
  root: {
    kind: "stack",
    props: { direction: "vertical", gap: 12 },
    children: [
      {
        kind: "text",
        id: "title",
        props: { size: 32, weight: 700, colour: "#f9fafb" },
        bindings: { value: "scene.title" },
      },
      {
        kind: "frame",
        id: "score-box",
        props: { width: 240, height: 64 },
        bindings: { opacity: "score.visible_opacity" },
        transitions: {
          opacity: { kind: "tween", duration_ms: 200, ease: "cubic-out" },
        },
        children: [
          {
            kind: "text",
            id: "score-team-a",
            props: { size: 48, weight: 800, colour: "#22c55e" },
            bindings: { value: "score.team_a" },
            transitions: {
              value: { kind: "tween", duration_ms: 200 },
            },
          },
        ],
      },
      {
        kind: "repeat",
        id: "roster-list",
        bindings: { items: "roster" },
        children: [
          {
            kind: "stack",
            props: { direction: "horizontal", gap: 8 },
            children: [
              {
                kind: "text",
                bindings: { value: "name" },
                props: { weight: 600 },
              },
              {
                kind: "text",
                bindings: { value: "score" },
              },
            ],
          },
        ],
      },
    ],
  },
  operator_inputs: [
    {
      path: "scene.title",
      label: "Scene title",
      type: "text",
      max_length: 80,
      group: "Scene",
    },
    {
      path: "score.team_a",
      label: "Team A score",
      type: "number",
      group: "Score",
      min: 0,
      max: 999,
      step: 1,
    },
    {
      path: "score.visible_opacity",
      label: "Score box opacity",
      type: "number",
      min: 0,
      max: 1,
      step: 0.1,
      group: "Score",
    },
  ],
  external_adapters: [
    {
      key: "ranking-poll",
      label: "ZabRanking — current match",
      kind: "http-poll",
      target_paths: ["score.team_a"],
      frequency_hz: 5,
    },
  ],
  assets: [],
};

export const ACCEPTANCE_INITIAL_STATE: Record<string, unknown> = {
  "scene.title": "Acceptance scene",
  "score.team_a": 14,
  "score.visible_opacity": 1,
  roster: [
    { name: "Alice", score: 12 },
    { name: "Bob", score: 9 },
  ],
};

// --- adversarial scene : exercises the unhappy paths --------------

export const ADVERSARIAL_SCENE_ID = "adversarial-scene";
export const ADVERSARIAL_SCENE_VERSION = "sha256:adversarial-v1";

export const ADVERSARIAL_BUNDLE: RenderBundle = {
  scene_version: ADVERSARIAL_SCENE_VERSION,
  root: {
    kind: "stack",
    children: [
      // Unknown kind — Solar must skip it without crashing.
      { kind: "totally-fake" as never, id: "unknown" },
      // Empty bindings, all defaults.
      { kind: "text", id: "empty-text" },
      // Repeat with empty array.
      {
        kind: "repeat",
        id: "empty-repeat",
        bindings: { items: "no-such-array" },
        children: [{ kind: "text" }],
      },
    ],
  },
  operator_inputs: [],
  external_adapters: [],
  assets: [],
};

export const ADVERSARIAL_INITIAL_STATE: Record<string, unknown> = {};

// --- alt scene : used by the criterion-4 scene_changed e2e ----------

export const ALT_SCENE_ID = "alt-scene";
export const ALT_SCENE_VERSION = "sha256:alt-v1";

export const ALT_BUNDLE: RenderBundle = {
  scene_version: ALT_SCENE_VERSION,
  root: {
    kind: "stack",
    children: [
      {
        kind: "text",
        id: "alt-title",
        props: { size: 32, weight: 700, colour: "#fbbf24" },
        bindings: { value: "scene.title" },
      },
    ],
  },
  operator_inputs: [],
  external_adapters: [],
  assets: [],
};

export const ALT_INITIAL_STATE: Record<string, unknown> = {
  "scene.title": "Alt scene running",
};
