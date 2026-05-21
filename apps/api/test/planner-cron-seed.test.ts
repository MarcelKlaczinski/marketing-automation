// Spec 62.7: seedPlannerWeeklyGenerationCron is the worker-startup helper that
// ensures every project has a (project_id, 'planner_weekly_generation') row in
// cron_state. Without it the orchestrator skips projects silently.
//
// Two guards under test:
//   1. Idempotent — running twice doesn't create duplicates (UNIQUE constraint
//      via onConflictDoNothing).
//   2. New projects added after the first seed are picked up on the second run.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { cronState, db, projects } from "@marketing-auto/db";
import {
  PLANNER_WEEKLY_GENERATION_DEFAULT_PATTERN,
  seedPlannerWeeklyGenerationCron,
} from "../src/workers/planner-weekly-generation.worker.ts";

describe("seedPlannerWeeklyGenerationCron (Spec 62.7)", () => {
  const createdProjectIds: string[] = [];

  beforeEach(async () => {
    const ts = Date.now();
    const [p1] = await db
      .insert(projects)
      .values({
        slug: `cron-seed-a-${ts}`,
        name: "Cron Seed A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [p2] = await db
      .insert(projects)
      .values({
        slug: `cron-seed-b-${ts}`,
        name: "Cron Seed B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p1 || !p2) throw new Error("project insert failed");
    createdProjectIds.push(p1.id, p2.id);
  });

  afterEach(async () => {
    // Cleanup: FK CASCADE removes cron_state rows when project is deleted.
    for (const id of createdProjectIds) {
      await db.delete(projects).where(eq(projects.id, id));
    }
    createdProjectIds.length = 0;
  });

  async function countSeedRows(projectId: string): Promise<number> {
    const rows = await db
      .select({ id: cronState.id })
      .from(cronState)
      .where(
        and(
          eq(cronState.projectId, projectId),
          eq(cronState.jobType, "planner_weekly_generation"),
        ),
      );
    return rows.length;
  }

  it("seeds one row per project with is_active=false + default pattern", async () => {
    await seedPlannerWeeklyGenerationCron();
    for (const id of createdProjectIds) {
      const rows = await db
        .select()
        .from(cronState)
        .where(
          and(
            eq(cronState.projectId, id),
            eq(cronState.jobType, "planner_weekly_generation"),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.isActive).toBe(false);
      expect(rows[0]!.cronPattern).toBe(PLANNER_WEEKLY_GENERATION_DEFAULT_PATTERN);
    }
  });

  it("is idempotent — running twice does not create duplicates", async () => {
    await seedPlannerWeeklyGenerationCron();
    await seedPlannerWeeklyGenerationCron();
    for (const id of createdProjectIds) {
      expect(await countSeedRows(id)).toBe(1);
    }
  });

  it("picks up projects added after the first seed", async () => {
    await seedPlannerWeeklyGenerationCron();
    expect(await countSeedRows(createdProjectIds[0]!)).toBe(1);

    const ts = Date.now();
    const [p3] = await db
      .insert(projects)
      .values({
        slug: `cron-seed-c-${ts}`,
        name: "Cron Seed C",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p3) throw new Error("project insert failed");
    createdProjectIds.push(p3.id);
    expect(await countSeedRows(p3.id)).toBe(0);

    await seedPlannerWeeklyGenerationCron();
    expect(await countSeedRows(p3.id)).toBe(1);
  });
});
