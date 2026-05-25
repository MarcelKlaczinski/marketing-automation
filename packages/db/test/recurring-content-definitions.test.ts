/**
 * Spec 65.1 — recurring_content_definitions helper integration tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createRecurringDefinition,
  db,
  eq,
  getRecurringDefinition,
  listDueRecurringDefinitions,
  listRecurringDefinitions,
  markRecurringDefinitionRun,
  projects,
  recurringContentDefinitions,
  setRecurringDefinitionActive,
  updateRecurringDefinition,
} from "../src/index.ts";

describe("recurring_content_definitions helpers (Spec 65.1)", () => {
  let projectId: string;
  let projectIdOther: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [a] = await db
      .insert(projects)
      .values({
        slug: `rcd-test-a-${ts}`,
        name: "RCD Test Project A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [b] = await db
      .insert(projects)
      .values({
        slug: `rcd-test-b-${ts}`,
        name: "RCD Test Project B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!a || !b) throw new Error("project INSERT failed");
    projectId = a.id;
    projectIdOther = b.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(projects).where(eq(projects.id, projectIdOther));
  });

  describe("create + read roundtrip", () => {
    it("creates and reads back with defaults applied", async () => {
      const row = await createRecurringDefinition({
        projectId,
        name: "Top 5 LLMs weekly",
        formatType: "top-5-tools",
        frequency: "weekly",
        nextRunAt: new Date("2026-06-01T00:00:00Z"),
      });
      expect(row.id).toBeTruthy();
      expect(row.projectId).toBe(projectId);
      expect(row.isActive).toBe(true);
      expect(row.templateSelectionStrategy).toBe("lru");
      expect(row.endSlideStrategy).toBe("rotation");
      expect(row.outputTargets).toEqual({ article: false, social: true });

      const fetched = await getRecurringDefinition(row.id);
      expect(fetched?.name).toBe("Top 5 LLMs weekly");
    });
  });

  describe("listRecurringDefinitions", () => {
    it("filters by project_id (multi-tenant isolation)", async () => {
      await createRecurringDefinition({
        projectId,
        name: "A-1",
        formatType: "top-5-tools",
        frequency: "weekly",
        nextRunAt: new Date(),
      });
      await createRecurringDefinition({
        projectId: projectIdOther,
        name: "B-1",
        formatType: "top-5-tools",
        frequency: "weekly",
        nextRunAt: new Date(),
      });
      const aRows = await listRecurringDefinitions({ projectId });
      const bRows = await listRecurringDefinitions({ projectId: projectIdOther });
      expect(aRows.every((r) => r.projectId === projectId)).toBe(true);
      expect(bRows.every((r) => r.projectId === projectIdOther)).toBe(true);
    });

    it("filters by formatType", async () => {
      await createRecurringDefinition({
        projectId,
        name: "Hook-A",
        formatType: "tool-of-the-week",
        frequency: "weekly",
        nextRunAt: new Date(),
      });
      const rows = await listRecurringDefinitions({
        projectId,
        formatType: "tool-of-the-week",
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.formatType === "tool-of-the-week")).toBe(true);
    });

    it("excludes inactive rows by default; includeInactive=true returns them", async () => {
      const row = await createRecurringDefinition({
        projectId,
        name: "Will-Be-Disabled",
        formatType: "myth-busting",
        frequency: "weekly",
        nextRunAt: new Date(),
      });
      await setRecurringDefinitionActive(row.id, false);

      const activeOnly = await listRecurringDefinitions({
        projectId,
        formatType: "myth-busting",
      });
      const all = await listRecurringDefinitions({
        projectId,
        formatType: "myth-busting",
        includeInactive: true,
      });
      expect(activeOnly.find((r) => r.id === row.id)).toBeUndefined();
      expect(all.find((r) => r.id === row.id)).toBeDefined();
    });
  });

  describe("listDueRecurringDefinitions", () => {
    it("returns only active rows past next_run_at and older than the race-buffer", async () => {
      // Past + active + > 30s old → due
      const due = await createRecurringDefinition({
        projectId,
        name: "Due-Now",
        formatType: "due-test",
        frequency: "weekly",
        nextRunAt: new Date(Date.now() - 60_000),
      });
      // Manually back-date created_at to clear the 30s buffer.
      await db
        .update(recurringContentDefinitions)
        .set({ createdAt: new Date(Date.now() - 5 * 60 * 1000) })
        .where(eq(recurringContentDefinitions.id, due.id));

      // Future next_run → not due
      await createRecurringDefinition({
        projectId,
        name: "Future",
        formatType: "due-test",
        frequency: "weekly",
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const rows = await listDueRecurringDefinitions({ limit: 100 });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(due.id);
    });
  });

  describe("updateRecurringDefinition", () => {
    it("patches editable fields and stamps updated_at", async () => {
      const row = await createRecurringDefinition({
        projectId,
        name: "patch-test",
        formatType: "top-5-tools",
        frequency: "weekly",
        nextRunAt: new Date(),
      });
      const before = row.updatedAt;
      await new Promise((r) => setTimeout(r, 20));
      const patched = await updateRecurringDefinition(row.id, {
        name: "patch-test-renamed",
        frequency: "biweekly",
      });
      expect(patched?.name).toBe("patch-test-renamed");
      expect(patched?.frequency).toBe("biweekly");
      expect(patched!.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });

    it("returns null for unknown id", async () => {
      const result = await updateRecurringDefinition(
        "00000000-0000-0000-0000-000000000000",
        { name: "ghost" },
      );
      expect(result).toBeNull();
    });
  });

  describe("markRecurringDefinitionRun", () => {
    it("advances next_run_at and stamps last_run_at", async () => {
      const row = await createRecurringDefinition({
        projectId,
        name: "mark-run-test",
        formatType: "top-5-tools",
        frequency: "weekly",
        nextRunAt: new Date(Date.now() - 60_000),
      });
      const next = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await markRecurringDefinitionRun(row.id, { newNextRunAt: next });
      const after = await getRecurringDefinition(row.id);
      expect(after?.nextRunAt.getTime()).toBe(next.getTime());
      expect(after?.lastRunAt).toBeDefined();
    });
  });
});
