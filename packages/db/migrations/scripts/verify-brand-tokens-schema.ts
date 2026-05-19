/**
 * Post-migration verification script (Spec 60.0 Section F.3)
 *
 * Queries all projects and validates each brand_tokens JSONB blob against
 * brandTokensSchema. Exits 1 if any row fails validation.
 *
 * Run:
 *   bun run --cwd packages/db verify:brand-tokens-schema
 * Or directly:
 *   bun --env-file ../../.env migrations/scripts/verify-brand-tokens-schema.ts
 */

import { db } from "../../src/client.ts";
import { projects } from "../../src/schema/projects.ts";
import { brandTokensSchema } from "@marketing-auto/shared/brand-tokens";

const allProjects = await db
  .select({ id: projects.id, name: projects.name, brandTokens: projects.brandTokens })
  .from(projects);

let failures = 0;

for (const project of allProjects) {
  const result = brandTokensSchema.safeParse(project.brandTokens ?? {});
  if (!result.success) {
    console.error(`✗ ${project.name} (${project.id}):`);
    console.error("  ", JSON.stringify(result.error.format(), null, 2));
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${allProjects.length} project(s) FAIL brand_tokens schema validation.`);
  console.error("Run the migration: bun --env-file ../../.env migrations/scripts/0042-brand-tokens-schema-sync.ts");
  process.exit(1);
}

console.log(`All ${allProjects.length} project(s) pass brand_tokens schema validation. ✓`);
