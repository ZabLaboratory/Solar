import { describe, expect, it } from "vitest";
import { createReconnectSchedule } from "../../src/transport/reconnect";

describe("ReconnectSchedule", () => {
  it("computes increasing delays without jitter", () => {
    const s = createReconnectSchedule({
      initial: 100,
      max: 10_000,
      factor: 2,
      jitter: 0,
    });
    expect(s.delayFor(1)).toBe(100);
    expect(s.delayFor(2)).toBe(200);
    expect(s.delayFor(3)).toBe(400);
    expect(s.delayFor(4)).toBe(800);
  });

  it("caps delays at max", () => {
    const s = createReconnectSchedule({
      initial: 100,
      max: 1000,
      factor: 4,
      jitter: 0,
    });
    expect(s.delayFor(1)).toBe(100);
    expect(s.delayFor(2)).toBe(400);
    expect(s.delayFor(3)).toBe(1000);
    expect(s.delayFor(10)).toBe(1000);
  });

  it("applies jitter within the configured fraction", () => {
    // Deterministic random : 0 → -jitter*base ; 1 → +jitter*base ; 0.5 → 0.
    const s = createReconnectSchedule({
      initial: 100,
      max: 10_000,
      factor: 1,
      jitter: 0.2,
      random: () => 0,
    });
    expect(s.delayFor(1)).toBe(80);
  });

  it("reset zeroes the attempt counter", () => {
    const s = createReconnectSchedule({ jitter: 0 });
    s.delayFor(3);
    expect(s.attempt).toBe(3);
    s.reset();
    expect(s.attempt).toBe(0);
  });

  it("rejects bad config", () => {
    expect(() => createReconnectSchedule({ initial: 0 })).toThrow();
    expect(() => createReconnectSchedule({ initial: 200, max: 100 })).toThrow();
    expect(() => createReconnectSchedule({ factor: 0.5 })).toThrow();
    expect(() => createReconnectSchedule({ jitter: 1.5 })).toThrow();
  });
});
