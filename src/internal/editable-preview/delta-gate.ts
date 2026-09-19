import { parseEditableFastPatch, type EditableFastPatch } from "./patch";

/**
 * Mirror the LSDP sequence gate before touching pixels. The regular Lumencast
 * client remains authoritative and consumes the same frame immediately after
 * this hook; duplicates, gaps, pre-snapshot deltas and scene transitions are
 * deliberately inert here as well.
 */
export class EditablePreviewDeltaGate {
  private sequence: number | null = null;

  accept(data: unknown): EditableFastPatch[] {
    if (typeof data !== "string") return [];
    let frame: unknown;
    try {
      frame = JSON.parse(data) as unknown;
    } catch {
      return [];
    }
    if (!frame || typeof frame !== "object") return [];
    const candidate = frame as {
      type?: unknown;
      seq?: unknown;
      patches?: unknown;
    };
    if (candidate.type === "snapshot") {
      this.sequence =
        Number.isInteger(candidate.seq) && (candidate.seq as number) >= 1
          ? (candidate.seq as number)
          : null;
      return [];
    }
    if (candidate.type === "scene_changed") {
      this.sequence = null;
      return [];
    }
    if (candidate.type !== "delta" || !Number.isInteger(candidate.seq)) {
      return [];
    }
    const sequence = candidate.seq as number;
    if (this.sequence === null || sequence <= this.sequence) return [];
    if (sequence !== this.sequence + 1) {
      this.sequence = null;
      return [];
    }
    this.sequence = sequence;
    if (!Array.isArray(candidate.patches)) return [];
    return candidate.patches
      .map(parseEditableFastPatch)
      .filter((patch): patch is EditableFastPatch => patch !== null);
  }
}
