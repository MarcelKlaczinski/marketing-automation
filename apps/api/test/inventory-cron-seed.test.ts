// Spec 64.20 — cron-seed unit tests.
// Verifies `seedGithubInventoryRefreshCron()` is idempotent and inserts the
// expected `cron_state` row per project.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, cronState, db, eq, projects } from "@marketing-auto/db";
import {
  GITHUB_INVENTORY_REFRESH_DEFAULT_PATTERN,
  seedGithubInventoryRefreshCron,
} from "../src/workers/github-inventory-refresh.worker.ts";

let projectId: string;

beforeAll(async () => {
  const ts = Date.now();
  const [proj] = await db
    .insert(projects)
    .values({
      slug: `inv-cron-seed-${ts}`,
      name: "Inv Cron Seed Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;
});

afterAll(async () => {
  // CASCADE drops cron_state row along with the project
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("seedGithubInventoryRefreshCron", () => {
  it("inserts a cron_state row with the default pattern and is_active=true", async () => {
    await seedGithubInventoryRefreshCron();

    const [row] = await db
      .select()
      .from(cronState)
      .where(
        and(
          eq(cronState.projectId, projectId),
          eq(cronState.jobType, "github_inventory_refresh"),
        ),
      )
      .limit(1);

    expect(row).toBeDefined();
    expect(row?.cronPattern).toBe(GITHUB_INVENTORY_REFRESH_DEFAULT_PATTERN);
    expect(row?.isActive).toBe(true);
  });

  it("is idempotent — re-running does not duplicate the row", async () => {
    await seedGithubInventoryRefreshCron();
    await seedGithubInventoryRefreshCron();

    const rows = await db
      .select()
      .from(cronState)
      .where(
        and(
          eq(cronState.projectId, projectId),
          eq(cronState.jobType, "github_inventory_refresh"),
        ),
      );

    expect(rows.length).toBe(1);
  });
});
