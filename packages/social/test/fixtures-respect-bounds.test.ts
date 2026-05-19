/**
 * Spec 59.3.5 Section G.3 — fixture validation test.
 *
 * For every template that has a `generatedSchema`, verifies that all three
 * fixtures (characteristic, edgeMin, edgeMax) conform to the schema.
 * Build fails if any fixture violates the declared bounds.
 *
 * Templates without generatedSchema are skipped until sessions 2–4 wire them.
 */

import { describe, expect, it } from "bun:test";
import { templateRegistry } from "../src/templates/registry";

// Bootstrap all templates.
import { bootstrapTemplates } from "../src/templates/bootstrap";
bootstrapTemplates();

describe("fixtures respect declared bounds", () => {
  const templates = templateRegistry.list();

  it("registry is non-empty", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  for (const template of templates) {
    if (!template.generatedSchema || !template.mockFixtures) continue;

    describe(template.key, () => {
      for (const fixtureKey of ["characteristic", "edge-min", "edge-max"] as const) {
        const fixture = template.mockFixtures[fixtureKey];
        if (!fixture) {
          it(`fixture '${fixtureKey}' exists`, () => {
            expect(fixture).toBeDefined();
          });
          continue;
        }

        it(`fixture '${fixtureKey}' passes generatedSchema`, () => {
          // Fixtures store raw input in fixture.input; generated content is
          // in fixture.generatedContent when it exists, otherwise we skip.
          const generated = (fixture as { generatedContent?: unknown }).generatedContent;
          if (generated === undefined) return; // not wired yet

          expect(() => template.generatedSchema!.parse(generated)).not.toThrow();
        });
      }
    });
  }
});
