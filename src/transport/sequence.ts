// Sequence tracker — ADR 002 § 7.
//
// Each subscription sees a monotonic 64-bit sequence in the snapshot
// and every subsequent delta. A gap means we missed a message and
// must request a resync (the WS layer reconnects with `since_sequence`
// or accepts a fresh snapshot).
//
// JS doesn't have native 64-bit ints — `number` is safe up to 2^53,
// which is plenty for any realistic show duration (a 1 kHz delta rate
// for 285 000 years before overflow). We treat sequence as `number`
// and bail early if it ever exceeds Number.MAX_SAFE_INTEGER.

export interface SequenceTracker {
  /** Current expected next sequence (last seen + 1). 0 means no
   *  baseline established yet. */
  readonly expected: number;
  /** Reset to a known baseline (called on snapshot or scene_changed). */
  reset(seq: number): void;
  /** Validate an incoming delta sequence. Returns "ok" if it matches,
   *  "gap" if a resync is needed. */
  observe(seq: number): SequenceObservation;
  /** Last seen sequence (for `since_sequence` on reconnect). */
  readonly last: number;
}

export type SequenceObservation =
  | { kind: "ok" }
  | { kind: "gap"; expected: number; got: number };

class TrackerImpl implements SequenceTracker {
  private _last = -1;

  get expected(): number {
    return this._last < 0 ? 0 : this._last + 1;
  }

  get last(): number {
    return this._last;
  }

  reset(seq: number): void {
    if (!Number.isFinite(seq) || seq < 0) {
      throw new RangeError(`sequence must be a non-negative finite number, got ${seq}`);
    }
    if (seq > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`sequence overflow : ${seq}`);
    }
    this._last = seq;
  }

  observe(seq: number): SequenceObservation {
    if (!Number.isFinite(seq) || seq < 0) {
      return { kind: "gap", expected: this.expected, got: seq };
    }
    const expected = this.expected;
    if (seq === expected) {
      this._last = seq;
      return { kind: "ok" };
    }
    return { kind: "gap", expected, got: seq };
  }
}

export function createSequenceTracker(): SequenceTracker {
  return new TrackerImpl();
}
