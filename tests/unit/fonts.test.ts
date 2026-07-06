// Self-hosted Geist @font-face regression guard.
//
// The bug: a scene whose LSML text carries `fontFamily: "Geist"` (the Prism
// picker default, emitted verbatim by from-scene.ts) rendered with the system
// fallback in preview AND on-air, because Solar's OWN served page declared no
// `@font-face` for Geist and bundled no font file — Prism's editor CSS never
// reaches Solar's page. This test pins the fix at the source level so it cannot
// silently regress: both entry points must load the fonts CSS, the CSS must
// declare Geist + Geist Mono, and every referenced woff2 must exist on disk
// (i.e. the asset URL resolves — no 404 once Vite emits it).
//
// The served-page counterpart (the built dist/host page actually carries a
// <link> stylesheet with the @font-face and the woff2 fetches 200) is asserted
// in tests/e2e/host-bundle.spec.ts.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONTS_CSS = resolve(ROOT, "src", "styles", "fonts.css");
const STYLES_DIR = dirname(FONTS_CSS);

const css = readFileSync(FONTS_CSS, "utf8");

describe("Geist self-hosting", () => {
  it("is imported by BOTH entry points (preview + host/CEF)", () => {
    // Preview / editor / e2e harness path.
    const dev = readFileSync(resolve(ROOT, "src", "dev-entry.tsx"), "utf8");
    // Served host / Pulsar CEF / atlas path.
    const host = readFileSync(resolve(ROOT, "src", "host-entry.tsx"), "utf8");
    expect(dev).toMatch(/import\s+["']\.\/styles\/fonts\.css["']/);
    expect(host).toMatch(/import\s+["']\.\/styles\/fonts\.css["']/);
  });

  it("declares an @font-face for Geist and Geist Mono", () => {
    // A weight-range @font-face per family, mirroring Prism (Geist 400–700,
    // Geist Mono 400–600) — one variable woff2 covers the whole axis.
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    const families = faces.map((f) => {
      const m = f.match(/font-family:\s*["']([^"']+)["']/);
      return m?.[1];
    });
    expect(families).toContain("Geist");
    expect(families).toContain("Geist Mono");

    // Every declared face must use font-display: swap (instant first paint).
    for (const face of faces) {
      expect(face).toMatch(/font-display:\s*swap/);
    }
  });

  it("references only woff2 assets that exist on disk (URL resolves)", () => {
    const urls = [...css.matchAll(/url\(\s*["']([^"']+)["']\s*\)/g)].map(
      (m) => m[1]!,
    );
    // At least the two Geist families must be wired.
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) {
      const assetPath = resolve(STYLES_DIR, url);
      expect(
        existsSync(assetPath),
        `font asset referenced by fonts.css does not exist: ${url}`,
      ).toBe(true);
    }
  });

  it("gives the scene root a Geist-first fallback stack", () => {
    // A text node with no explicit fontFamily inherits a coherent baseline
    // instead of the bare browser default.
    expect(css).toMatch(
      /#scene\s*\{[^}]*font-family:\s*["']?Geist["']?\s*,/,
    );
  });
});
