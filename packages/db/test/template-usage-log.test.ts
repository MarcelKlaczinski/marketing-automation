/**
 * Spec 65.1 — template_usage_log helper integration tests.
 *
 * Covers logTemplateUsage + listRecentTemplateUsage + the cap-50 auto-prune
 * helpers (pruneTemplateUsageLog + pruneAllTemplateUsageLog) per
 * Marcel-Decision Q3.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createRecurringDefinition,
  db,
  eq,
  listRecentTemplateUsage,
  logTemplateUsage,
  projects,
  pruneAllTemplateUsageLog,
  pruneTemplateUsageLog,
  recurringContentDefinitions,
} from "../src/index.ts";

describe("template_usage_log helpers (Spec 65.1)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [project] = await db
      .insert(projects)
      .values({
        slug: `tul-test-${ts}`,
        name: "TemplateUsageLog Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!project) throw new Error("project INSERT failed");
    projectId = project.id;
  });

  afterAll(async () => {
    // CASCADE removes all child rows (definitions + usage logs).
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  async function createTestDefinition(name: string) {
    return await createRecurringDefinition({
      projectId,
      name,
      formatType: "top-5-tools",
      frequency: "weekly",
      nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  }

  describe("logTemplateUsage + listRecentTemplateUsage", () => {
    it("INSERT round-trips and returns rows ordered by used_at DESC", async () => {
      const def = await createTestDefinition("logging-roundtrip");
      for (let i = 0; i < 3; i++) {
        await logTemplateUsage({
          recurringDefinitionId: def.id,
          templateKey: `key-${i}`,
        });
      }
      const rows = await listRecentTemplateUsage({
        recurringDefinitionId: def.id,
        limit: 10,
      });
      expect(rows).toHaveLength(3);
      // DESC order — most recent first; we inserted 0 → 1 → 2 so row[0] is "key-2"
      expect(rows[0]?.templateKey).toBe("key-2");
      expect(rows[2]?.templateKey).toBe("key-0");
    });

    it("default limit is 10", async () => {
      const def = await createTestDefinition("logging-default-limit");
      for (let i = 0; i < 15; i++) {
        await logTemplateUsage({ recurringDefinitionId: def.id, templateKey: "k" });
      }
      const rows = await listRecentTemplateUsage({ recurringDefinitionId: def.id });
      expect(rows).toHaveLength(10);
    });
  });

  describe("pruneTemplateUsageLog", () => {
    it("keeps only the last N entries per definition", async () => {
      const def = await createTestDefinition("prune-cap");
      for (let i = 0; i < 100; i++) {
        await logTemplateUsage({ recurringDefinitionId: def.id, templateKey: "k" });
      }
      const deleted = await pruneTemplateUsageLog({
        recurringDefinitionId: def.id,
        keepLastN: 50,
      });
      expect(deleted).toBe(50);
      const remaining = await listRecentTemplateUsage({
        recurringDefinitionId: def.id,
        limit: 200,
      });
      expect(remaining).toHaveLength(50);
    });

    it("no-op when row count ≤ keepLastN", async () => {
      const def = await createTestDefinition("prune-noop");
      for (let i = 0; i < 10; i++) {
        await logTemplateUsage({ recurringDefinitionId: def.id, templateKey: "k" });
      }
      const deleted = await pruneTemplateUsageLog({
        recurringDefinitionId: def.id,
        keepLastN: 50,
      });
      expect(deleted).toBe(0);
    });

    it("keepLastN=0 deletes everything", async () => {
      const def = await createTestDefinition("prune-zero");
      for (let i = 0; i < 5; i++) {
        await logTemplateUsage({ recurringDefinitionId: def.id, templateKey: "k" });
      }
      const deleted = await pruneTemplateUsageLog({
        recurringDefinitionId: def.id,
        keepLastN: 0,
      });
      expect(deleted).toBe(5);
      const remaining = await listRecentTemplateUsage({
        recurringDefinitionId: def.id,
      });
      expect(remaining).toHaveLength(0);
    });

    it("rejects negative keepLastN", async () => {
      const def = await createTestDefinition("prune-negative");
      await expect(
        pruneTemplateUsageLog({
          recurringDefinitionId: def.id,
          keepLastN: -5,
        }),
      ).rejects.toThrow(/keepLastN must be >= 0/);
    });
  });

  describe("pruneAllTemplateUsageLog", () => {
    it("iterates across every distinct definition", async () => {
      const def1 = await createTestDefinition("prune-all-1");
      const def2 = await createTestDefinition("prune-all-2");
      for (let i = 0; i < 75; i++) {
        await logTemplateUsage({ recurringDefinitionId: def1.id, templateKey: "k1" });
        await logTemplateUsage({ recurringDefinitionId: def2.id, templateKey: "k2" });
      }
      const result = await pruneAllTemplateUsageLog({ keepLastN: 50 });
      expect(result.definitionsPruned).toBeGreaterThanOrEqual(2);
      // Each definition with > 50 rows contributes 25 deletes.
      expect(result.rowsDeleted).toBeGreaterThanOrEqual(50);

      // Verify each definition is at the cap.
      const rows1 = await listRecentTemplateUsage({
        recurringDefinitionId: def1.id,
        limit: 200,
      });
      const rows2 = await listRecentTemplateUsage({
        recurringDefinitionId: def2.id,
        limit: 200,
      });
      expect(rows1).toHaveLength(50);
      expect(rows2).toHaveLength(50);
    });
  });

  describe("FK cascade", () => {
    it("deleting a recurring_content_definitions row cascades the usage rows", async () => {
      const def = await createTestDefinition("cascade-test");
      for (let i = 0; i < 5; i++) {
        await logTemplateUsage({ recurringDefinitionId: def.id, templateKey: "k" });
      }
      await db
        .delete(recurringContentDefinitions)
        .where(eq(recurringContentDefinitions.id, def.id));
      const remaining = await listRecentTemplateUsage({
        recurringDefinitionId: def.id,
        limit: 10,
      });
      expect(remaining).toHaveLength(0);
    });
  });
});
