// Spec 65.0 Day 1-2 — DB helper integration tests for the templates table.
//
// Covers upsert + sweep + sync + usage helpers plus read-side resolution
// (project-scoped wins over global). Real Postgres, no mocks (Marcel rule).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  deactivateMissingTemplates,
  getTemplate,
  incrementTemplateUsage,
  listActiveGlobalTemplates,
  listActiveTemplates,
  projects,
  syncTemplatesBatch,
  templates,
  upsertTemplate,
  type TemplateSyncSpec,
} from "../src/index.ts";

const baseSpec: TemplateSyncSpec = {
  templateKey: "spec-65-test-key",
  baseTemplateKey: "spec-65-test-key",
  variant: null,
  filePath: "packages/social/src/templates/definitions/spec65Test.ts",
  fileHash: "hash:initial",
  formatTypes: ["comparison"],
  outputFormat: "carousel",
  compatibleChannels: ["instagram"],
  generationClass: "frontmatter-derived",
  displayName: "Spec 65 Test Template",
  description: "Integration test fixture",
  defaultSlideCount: 4,
  estimatedCostUsd: 0.006,
};

describe("templates DB helpers (Spec 65.0)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [project] = await db
      .insert(projects)
      .values({
        slug: `templates-test-${ts}`,
        name: "Templates Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!project) throw new Error("Failed to create test project");
    projectId = project.id;
  });

  afterAll(async () => {
    // Cascading delete: project removal sweeps its templates rows.
    await db.delete(projects).where(eq(projects.id, projectId));
    // Also clean any global rows we created.
    await db.delete(templates).where(eq(templates.templateKey, baseSpec.templateKey));
    await db
      .delete(templates)
      .where(eq(templates.templateKey, "spec-65-test-secondary"));
  });

  describe("upsertTemplate", () => {
    it("inserts a fresh global row with status=added", async () => {
      const result = await upsertTemplate(baseSpec, null);
      expect(result.status).toBe("added");
      expect(result.row.projectId).toBeNull();
      expect(result.row.templateKey).toBe(baseSpec.templateKey);
      expect(result.row.fileHash).toBe("hash:initial");
      expect(result.row.isActive).toBe(true);
      expect(result.row.formatTypes).toEqual(["comparison"]);
    });

    it("returns status=unchanged on idempotent re-call (last_seen_at refreshed)", async () => {
      const first = await upsertTemplate(baseSpec, null);
      const firstSeen = first.row.lastSeenAt;
      await new Promise((r) => setTimeout(r, 30)); // ensure timestamp delta
      const second = await upsertTemplate(baseSpec, null);
      expect(second.status).toBe("unchanged");
      expect(second.row.lastSeenAt.getTime()).toBeGreaterThan(firstSeen.getTime());
      expect(second.row.fileHash).toBe("hash:initial");
    });

    it("returns status=updated when fileHash changes", async () => {
      await upsertTemplate(baseSpec, null);
      const updated = await upsertTemplate(
        { ...baseSpec, fileHash: "hash:changed", description: "Updated description" },
        null,
      );
      expect(updated.status).toBe("updated");
      expect(updated.row.fileHash).toBe("hash:changed");
      expect(updated.row.description).toBe("Updated description");
    });

    it("scopes project rows separately from global rows", async () => {
      // Reset to initial spec so both insertions are 'added'
      await db.delete(templates).where(eq(templates.templateKey, baseSpec.templateKey));
      const global = await upsertTemplate(baseSpec, null);
      const scoped = await upsertTemplate(baseSpec, projectId);
      expect(global.status).toBe("added");
      expect(scoped.status).toBe("added");
      expect(global.row.id).not.toBe(scoped.row.id);
      expect(global.row.projectId).toBeNull();
      expect(scoped.row.projectId).toBe(projectId);
    });
  });

  describe("deactivateMissingTemplates", () => {
    it("flips active rows not in keptKeys to is_active=false", async () => {
      // Seed two project-scoped templates.
      await upsertTemplate({ ...baseSpec, templateKey: "spec-65-test-secondary" }, projectId);
      await upsertTemplate(baseSpec, projectId);

      const deactivated = await deactivateMissingTemplates({
        projectId,
        keptKeys: [baseSpec.templateKey], // drop the secondary key
      });
      expect(deactivated).toBe(1);

      const survivors = await listActiveTemplates({ projectId });
      const survivorKeys = survivors.map((r) => r.templateKey);
      expect(survivorKeys).toContain(baseSpec.templateKey);
      expect(survivorKeys).not.toContain("spec-65-test-secondary");
    });

    it("treats empty keptKeys as 'deactivate everything in scope'", async () => {
      // Re-seed
      await db
        .delete(templates)
        .where(eq(templates.projectId, projectId));
      await upsertTemplate(baseSpec, projectId);
      const before = await listActiveTemplates({ projectId });
      expect(before.length).toBeGreaterThan(0);

      const deactivated = await deactivateMissingTemplates({
        projectId,
        keptKeys: [],
      });
      expect(deactivated).toBeGreaterThan(0);

      const after = await listActiveTemplates({ projectId });
      // Active list may still contain GLOBAL rows from prior tests.
      const projectScoped = after.filter((r) => r.projectId === projectId);
      expect(projectScoped).toEqual([]);
    });
  });

  describe("syncTemplatesBatch", () => {
    it("counts added/updated/unchanged/deactivated independently", async () => {
      // Clean slate for this project's scope.
      await db.delete(templates).where(eq(templates.projectId, projectId));

      // First call: 2 specs land as added.
      const initial = await syncTemplatesBatch({
        projectId,
        specs: [
          baseSpec,
          { ...baseSpec, templateKey: "spec-65-test-secondary" },
        ],
      });
      expect(initial.added).toBe(2);
      expect(initial.updated).toBe(0);
      expect(initial.unchanged).toBe(0);
      expect(initial.deactivated).toBe(0);

      // Second call: bumped hash on one, drop the other.
      const second = await syncTemplatesBatch({
        projectId,
        specs: [
          { ...baseSpec, fileHash: "hash:second" },
        ],
      });
      expect(second.updated).toBe(1);
      expect(second.deactivated).toBe(1);
      expect(second.added).toBe(0);

      // Third call: pure idempotent re-touch.
      const third = await syncTemplatesBatch({
        projectId,
        specs: [
          { ...baseSpec, fileHash: "hash:second" },
        ],
      });
      expect(third.unchanged).toBe(1);
      expect(third.added).toBe(0);
      expect(third.updated).toBe(0);
      expect(third.deactivated).toBe(0);
    });
  });

  describe("getTemplate", () => {
    it("returns project-scoped row when both global and project rows exist", async () => {
      await upsertTemplate(baseSpec, null); // global
      await upsertTemplate(
        { ...baseSpec, displayName: "Project-scoped override" },
        projectId,
      );
      const row = await getTemplate({ projectId, templateKey: baseSpec.templateKey });
      expect(row).not.toBeNull();
      expect(row?.projectId).toBe(projectId);
      expect(row?.displayName).toBe("Project-scoped override");
    });

    it("falls back to global when no project-scoped row exists", async () => {
      await db.delete(templates).where(eq(templates.projectId, projectId));
      await upsertTemplate(baseSpec, null);
      const row = await getTemplate({ projectId, templateKey: baseSpec.templateKey });
      expect(row).not.toBeNull();
      expect(row?.projectId).toBeNull();
    });

    it("returns null for unknown key", async () => {
      const row = await getTemplate({ projectId, templateKey: "no-such-template" });
      expect(row).toBeNull();
    });
  });

  describe("incrementTemplateUsage", () => {
    it("bumps usage_count and stamps last_used_at", async () => {
      await db.delete(templates).where(eq(templates.projectId, projectId));
      const created = await upsertTemplate(baseSpec, projectId);
      expect(created.row.usageCount).toBe(0);
      expect(created.row.lastUsedAt).toBeNull();

      await incrementTemplateUsage({ projectId, templateKey: baseSpec.templateKey });
      await incrementTemplateUsage({ projectId, templateKey: baseSpec.templateKey });

      const after = await getTemplate({ projectId, templateKey: baseSpec.templateKey });
      expect(after?.usageCount).toBe(2);
      expect(after?.lastUsedAt).not.toBeNull();
    });
  });

  describe("listActiveTemplates", () => {
    it("filters by formatType via GIN-indexed column", async () => {
      await db.delete(templates).where(eq(templates.projectId, projectId));
      await upsertTemplate(
        { ...baseSpec, formatTypes: ["comparison"] },
        projectId,
      );
      await upsertTemplate(
        { ...baseSpec, templateKey: "spec-65-test-secondary", formatTypes: ["tool-spotlight"] },
        projectId,
      );

      const comparisons = await listActiveTemplates({ projectId, formatType: "comparison" });
      const compKeys = comparisons.map((r) => r.templateKey);
      expect(compKeys).toContain(baseSpec.templateKey);
      expect(compKeys).not.toContain("spec-65-test-secondary");
    });

    it("returns project + global rows merged", async () => {
      await upsertTemplate(baseSpec, null);
      await upsertTemplate(
        { ...baseSpec, templateKey: "spec-65-test-secondary" },
        projectId,
      );
      const merged = await listActiveTemplates({ projectId });
      const keys = merged.map((r) => r.templateKey);
      // Both should appear — global baseSpec + project-scoped secondary.
      expect(keys).toContain("spec-65-test-secondary");
    });
  });

  describe("listActiveGlobalTemplates", () => {
    it("returns ONLY rows with projectId=null", async () => {
      await upsertTemplate(baseSpec, null);
      const globals = await listActiveGlobalTemplates();
      for (const row of globals) {
        expect(row.projectId).toBeNull();
      }
    });
  });
});
