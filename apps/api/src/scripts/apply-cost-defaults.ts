/**
 * One-shot script: applies DEFAULT_COST_LIMITS to projects that have empty costLimits.
 *
 * Run once after deploying Spec 41:
 *   bun run apps/api/src/scripts/apply-cost-defaults.ts
 *
 * Projects with manually configured limits are skipped (no overwrite).
 */

import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { DEFAULT_COST_LIMITS } from "@marketing-auto/core";

async function main(): Promise<void> {
  const all = await db.select({ id: projects.id, slug: projects.slug, costLimits: projects.costLimits }).from(projects);

  let updated = 0;
  for (const p of all) {
    const isEmpty = !p.costLimits || Object.keys(p.costLimits as object).length === 0;
    if (isEmpty) {
      await db.update(projects).set({ costLimits: DEFAULT_COST_LIMITS }).where(eq(projects.id, p.id));
      console.log(`Applied defaults to: ${p.slug}`);
      updated++;
    } else {
      console.log(`Skipped (limits already set): ${p.slug}`);
    }
  }

  console.log(`\nDone. Updated ${updated} of ${all.length} projects.`);
}

void main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
