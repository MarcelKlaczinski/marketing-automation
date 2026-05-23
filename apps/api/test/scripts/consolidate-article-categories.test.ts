/**
 * Spec multi-domain-evolution S3.5 — slugifyCategory helper unit tests.
 * Mirrors the canonical Toolwiki Astro `slugifyCategory` function (live at
 * /Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/lib/taxonomy.ts).
 *
 * The helper is the only pure piece of the consolidation script — the rest
 * is DB I/O exercised manually via dry-run. Locking the slug-derivation
 * rule here prevents silent drift if the script is reused for future
 * tenants.
 */
import { describe, expect, it } from "bun:test";
import { slugifyCategory } from "../../src/scripts/consolidate-article-categories.ts";

describe("slugifyCategory (mirror of Astro taxonomy.ts)", () => {
  it("returns empty string for empty/undefined input", () => {
    expect(slugifyCategory("")).toBe("");
    expect(slugifyCategory(undefined)).toBe("");
  });

  it("returns already-canonical lowercase-hyphen strings unchanged", () => {
    expect(slugifyCategory("audio-music")).toBe("audio-music");
    expect(slugifyCategory("a-b-c")).toBe("a-b-c");
    expect(slugifyCategory("foo")).toBe("foo");
  });

  it("maps the 6 Toolwiki blog labels to the seeded slugs", () => {
    expect(slugifyCategory("Guides & Tutorials")).toBe("guides-und-tutorials");
    expect(slugifyCategory("Tool-Reviews")).toBe("tool-reviews");
    expect(slugifyCategory("Vergleiche")).toBe("vergleiche");
    expect(slugifyCategory("Trends & Zukunft")).toBe("trends-und-zukunft");
    expect(slugifyCategory("Praxis & Use Cases")).toBe("praxis-und-use-cases");
    expect(slugifyCategory("Ethik & Recht")).toBe("ethik-und-recht");
  });

  it("maps the 5 Toolwiki ki-wissen labels to the seeded slugs", () => {
    expect(slugifyCategory("Grundlagen")).toBe("grundlagen");
    expect(slugifyCategory("Technik")).toBe("technik");
    expect(slugifyCategory("Ethik & Recht")).toBe("ethik-und-recht");
    expect(slugifyCategory("Praxis")).toBe("praxis");
    expect(slugifyCategory("Zukunft")).toBe("zukunft");
  });

  it("replaces & with `und` (matches Astro convention)", () => {
    expect(slugifyCategory("A & B")).toBe("a-und-b");
  });

  it("folds German diacritics via NFKD normalize", () => {
    // ä → a (after stripping combining mark)
    expect(slugifyCategory("Übersetzung")).toBe("ubersetzung");
    expect(slugifyCategory("Größe")).toBe("grosse");
  });

  it("replaces ß with ss", () => {
    expect(slugifyCategory("Straße")).toBe("strasse");
  });

  it("collapses non-alphanumeric runs to single hyphen", () => {
    expect(slugifyCategory("foo  bar")).toBe("foo-bar");
    expect(slugifyCategory("foo___bar")).toBe("foo-bar");
    expect(slugifyCategory("foo!!!bar")).toBe("foo-bar");
  });

  it("strips leading/trailing hyphens in the slow path", () => {
    // The fast path short-circuits already-lowercase-hyphen strings (mirror of
    // Astro's `if (/^[a-z0-9-]+$/.test(value)) return value;`), so `-foo-`
    // passes through unchanged. Only inputs that go through normalize+replace
    // get the strip. Documented for parity with the canonical Astro helper.
    expect(slugifyCategory("___foo___")).toBe("foo");
    expect(slugifyCategory("!foo!")).toBe("foo");
    expect(slugifyCategory("-foo-")).toBe("-foo-"); // fast path passthrough
  });
});
