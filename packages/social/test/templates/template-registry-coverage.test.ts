/**
 * Spec 65.cleanup — Drift-protection for the template registry.
 *
 * The compile-time exhaustivity guard in
 * `apps/api/src/workers/social-render.worker.ts` catches additions to the
 * `TemplateKey` union that aren't classified into one of the four buckets
 * (Family-A, Family-B, Unsupported, Deprecated). This runtime test catches
 * the OTHER direction: a template that's registered in `bootstrap.ts` but
 * doesn't have a matching `ShippedTemplateKey` value, OR a deprecated /
 * unsupported key accidentally registered, OR a shipped key forgotten in
 * the registry.
 *
 * If this test fails, fix `bootstrap.ts` or extend `ShippedTemplateKey` —
 * never silence the test.
 */

import { describe, expect, it, beforeAll } from "bun:test";
import { bootstrapTemplates } from "../../src/templates/bootstrap.ts";
import { templateRegistry } from "../../src/templates/registry.ts";
import type {
  DeprecatedTemplateKey,
  ShippedTemplateKey,
  TemplateKey,
  UnsupportedTemplateKey,
} from "../../src/templates/types.ts";

/**
 * Authoritative list of templates that V1 ships + the bootstrap registry
 * must register. Kept as a typed `as const` so a typo (or a key missing
 * from `ShippedTemplateKey`) fails compile.
 *
 * When adding a new template:
 *   1. Add the key to `TemplateKey` in `types.ts`
 *   2. Add the definition to `bootstrap.ts`
 *   3. Add the key to this array
 *   4. Add to `FAMILY_A_TEMPLATE_KEYS` or `FAMILY_B_TEMPLATE_KEYS` in
 *      `social-render.worker.ts`
 *   5. Add a render-server function + a worker dispatch branch
 */
const EXPECTED_SHIPPED_KEYS = [
  "comparison-grid-3",
  "comparison-grid-4",
  "comparison-grid-5",
  "verdict-per-use-case",
  "single-tool-spotlight",
  "pro-con-verdict",
  "head-to-head-vs",
  "head-to-head-deep-dive",
  "story-arc-clickbait",
  "lifestyle-listicle",
  "opinion-recommendation",
] as const satisfies readonly ShippedTemplateKey[];

/**
 * Deprecated V1-cut variants — listed explicitly so the test asserts each
 * one is NOT in the registry. The cast-via-string-array pattern keeps the
 * runtime check honest while staying type-safe at PR-time.
 */
const DEPRECATED_KEYS = [
  "opinion-recommendation-dramatic",
  "opinion-recommendation-minimal",
  "story-arc-clickbait-dramatic",
  "story-arc-clickbait-minimal",
  "lifestyle-listicle-dramatic",
  "lifestyle-listicle-minimal",
] as const satisfies readonly DeprecatedTemplateKey[];

/**
 * Templates present in the `TemplateKey` union but never wired into a render
 * path. Same NOT-in-registry assertion as deprecated keys.
 */
const UNSUPPORTED_KEYS = [
  "news-slide",
  "concept-explainer-deck",
  "price-comparison",
] as const satisfies readonly UnsupportedTemplateKey[];

describe("template-registry coverage (Spec 65.cleanup)", () => {
  beforeAll(() => {
    // bootstrap is idempotent — calling it here ensures the registry is
    // populated even if no prior import triggered it.
    bootstrapTemplates();
  });

  it("registers every ShippedTemplateKey value", () => {
    const registered = new Set(templateRegistry.list().map((t) => t.key));
    for (const key of EXPECTED_SHIPPED_KEYS) {
      expect(registered.has(key), `expected shipped template "${key}" to be registered`).toBe(true);
    }
  });

  it("does NOT register any DeprecatedTemplateKey value", () => {
    const registered = new Set(templateRegistry.list().map((t) => t.key));
    for (const key of DEPRECATED_KEYS) {
      // Use `as TemplateKey` so the type-system doesn't complain about checking
      // a forbidden value — we WANT to assert it's absent.
      expect(
        registered.has(key as TemplateKey),
        `deprecated template "${key}" must NOT be registered (V1-cut, ships as toneIntensity config)`,
      ).toBe(false);
    }
  });

  it("does NOT register any UnsupportedTemplateKey value", () => {
    const registered = new Set(templateRegistry.list().map((t) => t.key));
    for (const key of UNSUPPORTED_KEYS) {
      expect(
        registered.has(key as TemplateKey),
        `unsupported template "${key}" must NOT be registered (never shipped)`,
      ).toBe(false);
    }
  });

  it("registry size matches EXPECTED_SHIPPED_KEYS count exactly", () => {
    const registered = templateRegistry.list();
    expect(
      registered.length,
      `registry has ${registered.length} templates; expected ${EXPECTED_SHIPPED_KEYS.length} (${EXPECTED_SHIPPED_KEYS.join(", ")})`,
    ).toBe(EXPECTED_SHIPPED_KEYS.length);
  });

  it("EXPECTED_SHIPPED_KEYS, DEPRECATED_KEYS, UNSUPPORTED_KEYS are disjoint", () => {
    // Type-level: ShippedTemplateKey = Exclude<TemplateKey, Deprecated | Unsupported>
    // is structurally guaranteed at compile time. This runtime assertion
    // double-checks the const arrays don't accidentally overlap (would be a
    // copy-paste error rather than a type error).
    const shipped = new Set<string>(EXPECTED_SHIPPED_KEYS);
    const deprecated = new Set<string>(DEPRECATED_KEYS);
    const unsupported = new Set<string>(UNSUPPORTED_KEYS);

    for (const k of deprecated) {
      expect(shipped.has(k), `"${k}" cannot be both shipped and deprecated`).toBe(false);
      expect(unsupported.has(k), `"${k}" cannot be both deprecated and unsupported`).toBe(false);
    }
    for (const k of unsupported) {
      expect(shipped.has(k), `"${k}" cannot be both shipped and unsupported`).toBe(false);
    }
  });
});
