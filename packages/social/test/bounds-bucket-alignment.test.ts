/**
 * Spec 59.3.5 Section G.2 — bounds-bucket alignment unit test.
 *
 * For every template that has declared `bounds` + `slotMap`, verifies that
 * content at the declared max length lands in a valid bucket (i.e. the bucket's
 * maxChars >= bound.max). This is the load-bearing guarantee of the
 * layout-shift-free convention: content that passes Zod validation is
 * guaranteed to fit a known bucket, which renders at a known font-size, which
 * fits a known px container.
 *
 * Templates without bounds/slotMap are skipped (migrations happen in Sessions 2–4).
 * The test grows automatically as each session wires a new template.
 */

import { describe, expect, it } from "bun:test";
import { templateRegistry } from "../src/templates/registry";
import { getFontSize, BUCKETS } from "../src/compositions/_shared/getFontSize";
import type { FieldBound } from "../src/templates/types";

// Bootstrap all templates so the registry is populated.
import { bootstrapTemplates } from "../src/templates/bootstrap";
bootstrapTemplates();

function isFieldBound(v: unknown): v is FieldBound {
  return typeof v === "object" && v !== null && "max" in v && "min" in v;
}

describe("bounds-bucket alignment", () => {
  const templates = templateRegistry.list();

  it("registry is non-empty", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  for (const template of templates) {
    if (!template.bounds || !template.slotMap) {
      // Template not yet migrated — skip silently.
      continue;
    }

    describe(template.key, () => {
      for (const [field, bound] of Object.entries(template.bounds!)) {
        if (!isFieldBound(bound)) continue; // ListBound — no bucket to check

        const slotType = template.slotMap![field];
        if (!slotType) continue; // not a rendered slot (e.g. captionBody)

        it(`field '${field}' (max=${bound.max}) fits within slotType '${slotType}' buckets`, () => {
          const maxContent = "x".repeat(bound.max);
          const bucket = getFontSize(maxContent, slotType);

          // The bucket that getFontSize returns must be able to hold the content.
          // getFontSize falls back to the last bucket when text exceeds all maxChars,
          // so we check the last bucket's maxChars >= bound.max to verify alignment.
          const allBuckets = BUCKETS[slotType];
          const lastBucket = allBuckets[allBuckets.length - 1]!;

          expect(lastBucket.maxChars).toBeGreaterThanOrEqual(bound.max);
          // Also verify the returned bucket is deterministic for the same input.
          const bucket2 = getFontSize(maxContent, slotType);
          expect(bucket2.fontSize).toBe(bucket.fontSize);
        });
      }
    });
  }
});
