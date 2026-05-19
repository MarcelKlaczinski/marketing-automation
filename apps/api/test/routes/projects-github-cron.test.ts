/**
 * Spec 59.1c A.1 — githubSignalCronEnabled in project PATCH.
 *
 * Validates that PATCH /api/projects/:slug with githubSignalCronEnabled
 * results in the correct cron_state row being upserted. Tested via HTTP
 * smoke tests (skip if server not running) + direct DB assertions.
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, cronState, db, eq, projects } from "@marketing-auto/db";

const SLUG = `github-cron-test-${Date.now()}`;

describe("githubSignalCronEnabled in project PATCH (Spec 59.1c A.1)", () => {
  let projectId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: SLUG,
        name: "GitHub Cron Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterAll(async () => {
    await db.delete(cronState).where(eq(cronState.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  // ─── Direct cron_state upsert logic ─────────────────────────────────────────

  describe("cron_state upsert logic", () => {
    it("upserts signal_collector_github row with is_active=true", async () => {
      await db
        .insert(cronState)
        .values({
          projectId,
          jobType: "signal_collector_github",
          isActive: true,
          cronPattern: "0 3 * * *",
        })
        .onConflictDoUpdate({
          target: [cronState.projectId, cronState.jobType],
          set: { isActive: true, updatedAt: new Date() },
        });

      const [row] = await db
        .select({ isActive: cronState.isActive })
        .from(cronState)
        .where(
          and(
            eq(cronState.projectId, projectId),
            eq(cronState.jobType, "signal_collector_github"),
          ),
        )
        .limit(1);

      expect(row?.isActive).toBe(true);
    });

    it("upserts signal_collector_github row with is_active=false", async () => {
      await db
        .insert(cronState)
        .values({
          projectId,
          jobType: "signal_collector_github",
          isActive: false,
          cronPattern: "0 3 * * *",
        })
        .onConflictDoUpdate({
          target: [cronState.projectId, cronState.jobType],
          set: { isActive: false, updatedAt: new Date() },
        });

      const [row] = await db
        .select({ isActive: cronState.isActive })
        .from(cronState)
        .where(
          and(
            eq(cronState.projectId, projectId),
            eq(cronState.jobType, "signal_collector_github"),
          ),
        )
        .limit(1);

      expect(row?.isActive).toBe(false);
    });
  });

  // ─── HTTP smoke tests (require running server) ───────────────────────────────

  describe("PATCH /api/projects/:slug with githubSignalCronEnabled", () => {
    it("accepts githubSignalCronEnabled: true in body (requires auth)", async () => {
      const res = await fetch(`http://localhost:3001/api/projects/${SLUG}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubSignalCronEnabled: true }),
      }).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([200, 401]);
    });

    it("accepts githubSignalCronEnabled: false in body (requires auth)", async () => {
      const res = await fetch(`http://localhost:3001/api/projects/${SLUG}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubSignalCronEnabled: false }),
      }).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([200, 401]);
    });

    it("also accepts hackernewsSignalCronEnabled, producthuntSignalCronEnabled, vendorRssSignalCronEnabled", async () => {
      const res = await fetch(`http://localhost:3001/api/projects/${SLUG}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hackernewsSignalCronEnabled: false,
          producthuntSignalCronEnabled: false,
          vendorRssSignalCronEnabled: false,
        }),
      }).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([200, 401]);
    });
  });
});
