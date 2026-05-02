import { describe, expect, it } from "vitest";
import { createSequenceTracker } from "../../src/transport/sequence";

describe("SequenceTracker", () => {
  it("starts with no baseline", () => {
    const t = createSequenceTracker();
    expect(t.last).toBe(-1);
    expect(t.expected).toBe(0);
  });

  it("reset establishes the baseline", () => {
    const t = createSequenceTracker();
    t.reset(100);
    expect(t.last).toBe(100);
    expect(t.expected).toBe(101);
  });

  it("observe accepts contiguous sequences", () => {
    const t = createSequenceTracker();
    t.reset(100);
    expect(t.observe(101).kind).toBe("ok");
    expect(t.observe(102).kind).toBe("ok");
    expect(t.last).toBe(102);
  });

  it("observe reports a gap on skip", () => {
    const t = createSequenceTracker();
    t.reset(100);
    const obs = t.observe(105);
    expect(obs.kind).toBe("gap");
    if (obs.kind === "gap") {
      expect(obs.expected).toBe(101);
      expect(obs.got).toBe(105);
    }
  });

  it("observe reports a gap on regress", () => {
    const t = createSequenceTracker();
    t.reset(100);
    const obs = t.observe(99);
    expect(obs.kind).toBe("gap");
  });

  it("rejects negative reset", () => {
    const t = createSequenceTracker();
    expect(() => t.reset(-1)).toThrow(/non-negative/);
  });

  it("rejects non-finite reset", () => {
    const t = createSequenceTracker();
    expect(() => t.reset(Number.NaN)).toThrow();
    expect(() => t.reset(Number.POSITIVE_INFINITY)).toThrow();
  });
});
