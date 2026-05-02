import { describe, expect, it } from "vitest";
import { createStore } from "../../src/state/store";
import { applySnapshot } from "../../src/state/apply-snapshot";
import { applyDelta } from "../../src/state/apply-delta";
import { PROTOCOL_VERSION } from "../../src/transport/protocol";

describe("Store — basic ops", () => {
  it("creates a signal lazily", () => {
    const s = createStore();
    const sig = s.signal("score.team_a");
    expect(sig.value).toBeUndefined();
  });

  it("set updates the signal", () => {
    const s = createStore();
    s.set("score.team_a", 14);
    expect(s.signal("score.team_a").value).toBe(14);
  });

  it("set records the transition", () => {
    const s = createStore();
    s.set("score.team_a", 14, { kind: "tween", duration_ms: 200 });
    expect(s.transitionFor("score.team_a")).toMatchObject({ kind: "tween" });
  });

  it("set without transition clears any previous one", () => {
    const s = createStore();
    s.set("score.team_a", 14, { kind: "tween", duration_ms: 200 });
    s.set("score.team_a", 15);
    expect(s.transitionFor("score.team_a")).toBeUndefined();
  });
});

describe("applySnapshot", () => {
  it("seeds the store with the snapshot's state", () => {
    const s = createStore();
    applySnapshot(s, {
      type: "snapshot",
      v: PROTOCOL_VERSION,
      scene_id: "scene-1",
      scene_version: "v1",
      sequence: 1,
      state: { "score.team_a": 14, "logo.visible": true },
    });
    expect(s.signal("score.team_a").value).toBe(14);
    expect(s.signal("logo.visible").value).toBe(true);
  });

  it("resets paths not present in the snapshot to undefined", () => {
    const s = createStore();
    s.set("ticker.text", "hello");
    applySnapshot(s, {
      type: "snapshot",
      v: PROTOCOL_VERSION,
      scene_id: "scene-1",
      scene_version: "v1",
      sequence: 1,
      state: { "score.team_a": 14 },
    });
    expect(s.signal("ticker.text").value).toBeUndefined();
  });

  it("clears transitions on snapshot", () => {
    const s = createStore();
    s.set("score.team_a", 14, { kind: "tween", duration_ms: 200 });
    applySnapshot(s, {
      type: "snapshot",
      v: PROTOCOL_VERSION,
      scene_id: "scene-1",
      scene_version: "v1",
      sequence: 1,
      state: { "score.team_a": 14 },
    });
    expect(s.transitionFor("score.team_a")).toBeUndefined();
  });
});

describe("applyDelta", () => {
  it("applies multiple patches atomically", () => {
    const s = createStore();
    applyDelta(s, {
      type: "delta",
      v: PROTOCOL_VERSION,
      scene_id: "scene-1",
      sequence: 2,
      patches: [
        { path: "score.team_a", value: 15 },
        { path: "score.team_a_diff", value: 1 },
      ],
    });
    expect(s.signal("score.team_a").value).toBe(15);
    expect(s.signal("score.team_a_diff").value).toBe(1);
  });

  it("supports deep paths through arrays and objects", () => {
    const s = createStore();
    applyDelta(s, {
      type: "delta",
      v: PROTOCOL_VERSION,
      scene_id: "scene-1",
      sequence: 1,
      patches: [
        { path: "composites.7.players.3.score", value: 12 },
      ],
    });
    expect(s.signal("composites.7.players.3.score").value).toBe(12);
  });
});
