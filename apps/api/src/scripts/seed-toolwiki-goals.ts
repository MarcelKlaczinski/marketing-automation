/**
 * Spec 62.2: seed default Planner goals + budget for the Toolwiki project.
 *
 * Run once after migration 0071 to populate Toolwiki without going through the UI.
 * The seed is idempotent: re-running replaces the active goal set with the defaults
 * (any previously-active rows for the same content_type are updated, never duplicated).
 *
 * Run:
 *   bun --filter @marketing-auto/api seed-toolwiki-goals
 *   # or
 *   bun --env-file .env apps/api/src/scripts/seed-toolwiki-goals.ts [slug]
 *
 * The optional positional argument overrides the project slug (default: "toolwiki").
 */

import {
  db,
  eq,
  projects,
  replaceProjectGoals,
  upsertProjectPlannerConfig,
} from "@marketing-auto/db";

const DEFAULT_SLUG = "toolwiki";

const DEFAULTS = {
  config: {
    weeklyBudgetEur: 50.0,
    perTypeMaxEur: null,
    topNSignalsAllowedOverage: 3,
    maxOveragePerSignal: 1,
  },
  goals: [
    {
      contentType: "cluster",
      cadenceUnit: "per_day" as const,
      minCount: 1,
      maxCount: null,
    },
    {
      contentType: "comparison",
      cadenceUnit: "per_week" as const,
      minCount: 1,
      maxCount: 3,
    },
    {
      contentType: "social_post",
      cadenceUnit: "per_day" as const,
      minCount: 3,
      maxCount: 5,
    },
    {
      contentType: "ki_wissen",
      cadenceUnit: "per_week" as const,
      minCount: 3,
      maxCount: 5,
    },
  ],
};

async function main(): Promise<void> {
  const slug = process.argv[2] ?? DEFAULT_SLUG;

  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.error(`Project not found: ${slug}`);
    process.exit(1);
  }

  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`Seeding Planner goals + config for ${project.name} (${slug})…`);

  const config = await upsertProjectPlannerConfig({
    projectId: project.id,
    weeklyBudgetEur: DEFAULTS.config.weeklyBudgetEur,
    perTypeMaxEur: DEFAULTS.config.perTypeMaxEur,
    topNSignalsAllowedOverage: DEFAULTS.config.topNSignalsAllowedOverage,
    maxOveragePerSignal: DEFAULTS.config.maxOveragePerSignal,
  });

  const result = await replaceProjectGoals({
    projectId: project.id,
    goals: DEFAULTS.goals,
  });

  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(
    `  config: weeklyBudgetEur=${config.weeklyBudgetEur}, topN=${config.topNSignalsAllowedOverage}`
  );
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(
    `  goals: ${result.inserted.length} inserted, ${result.updated.length} updated, ${result.deactivated.length} deactivated`
  );
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log("Done.");
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.error(err);
    process.exit(1);
  });
