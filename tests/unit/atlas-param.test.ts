import { describe, expect, it } from "vitest";
import { parseAtlasParam } from "../../src/atlas/atlas-param";

// The `?atlas=` reader (ADR 013 Prism §3.1, issue #38). Parsing is total and
// resolves to `null` for every degenerate value so the caller falls back to
// the UNCHANGED default render path.

describe("parseAtlasParam()", () => {
  it("returns null when atlas mode is not requested (absent param)", () => {
    // The non-regression sentinel: no `?atlas=` → null → the caller keeps the
    // default, atlas-less bundle byte-identical to today.
    expect(parseAtlasParam(null)).toBeNull();
    expect(parseAtlasParam(undefined)).toBeNull();
  });

  it("returns null for empty / whitespace-only / comma-only values", () => {
    expect(parseAtlasParam("")).toBeNull();
    expect(parseAtlasParam("   ")).toBeNull();
    expect(parseAtlasParam(",")).toBeNull();
    expect(parseAtlasParam(" , , ")).toBeNull();
  });

  it("parses a two-band below,above spec", () => {
    expect(parseAtlasParam("below,above")).toEqual({
      bands: ["below", "above"],
    });
  });

  it("parses a single-band spec (degenerate N=1)", () => {
    expect(parseAtlasParam("only")).toEqual({ bands: ["only"] });
  });

  it("parses N bands preserving bottom→top order", () => {
    expect(parseAtlasParam("below,mid,above")).toEqual({
      bands: ["below", "mid", "above"],
    });
  });

  it("trims tokens and drops empty ones", () => {
    expect(parseAtlasParam(" below , ,above ")).toEqual({
      bands: ["below", "above"],
    });
  });

  it("returns null on duplicate band labels (ambiguous keying)", () => {
    expect(parseAtlasParam("below,below")).toBeNull();
    expect(parseAtlasParam("a,b,a")).toBeNull();
  });
});
