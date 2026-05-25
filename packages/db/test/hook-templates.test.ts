/**
 * Spec 65.1 — hook_templates helper integration tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createHookTemplate,
  db,
  eq,
  getHookTemplate,
  listHookTemplates,
  listLruEligibleHooks,
  markHookUsed,
  projects,
  setHookTemplateActive,
} from "../src/index.ts";

describe("hook_templates helpers (Spec 65.1)", () => {
  let projectId: string;
  let projectIdOther: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [a] = await db
      .insert(projects)
      .values({
        slug: `hooks-a-${ts}`,
        name: "Hooks A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [b] = await db
      .insert(projects)
      .values({
        slug: `hooks-b-${ts}`,
        name: "Hooks B",
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

  it("create + read roundtrip", async () => {
    const row = await createHookTemplate({
      projectId,
      formatType: "tool-of-the-week",
      pattern: "I lost my {profession} job because of {tool}",
      language: "en",
      variables: ["profession", "tool"],
    });
    expect(row.id).toBeTruthy();
    expect(row.usageCount).toBe(0);
    expect(row.lastUsedAt).toBeNull();

    const fetched = await getHookTemplate(row.id);
    expect(fetched?.pattern).toContain("I lost my");
  });

  it("multi-tenant isolation by project_id", async () => {
    await createHookTemplate({
      projectId,
      formatType: "tool-of-the-week",
      pattern: "A-hook",
      language: "de",
    });
    await createHookTemplate({
      projectId: projectIdOther,
      formatType: "tool-of-the-week",
      pattern: "B-hook",
      language: "de",
    });
    const aRows = await listHookTemplates({ projectId });
    const bRows = await listHookTemplates({ projectId: projectIdOther });
    expect(aRows.every((r) => r.projectId === projectId)).toBe(true);
    expect(bRows.every((r) => r.projectId === projectIdOther)).toBe(true);
  });

  it("filters by formatType + language + active", async () => {
    await createHookTemplate({
      projectId,
      formatType: "format-X",
      pattern: "X-DE",
      language: "de",
    });
    await createHookTemplate({
      projectId,
      formatType: "format-X",
      pattern: "X-EN",
      language: "en",
    });
    const ende = await listHookTemplates({ projectId, formatType: "format-X", language: "en" });
    expect(ende.every((r) => r.language === "en" && r.formatType === "format-X")).toBe(true);
    expect(ende.length).toBeGreaterThan(0);
  });

  it("listLruEligibleHooks orders NULLS FIRST then by usage_count", async () => {
    const ts = Date.now();
    const formatType = `lru-${ts}`;
    // Hook A: never used (NULL last_used_at, usage 0) — should be picked first.
    const a = await createHookTemplate({
      projectId,
      formatType,
      pattern: "A",
      language: "de",
    });
    // Hook B: used once.
    const b = await createHookTemplate({
      projectId,
      formatType,
      pattern: "B",
      language: "de",
    });
    await markHookUsed(b.id);
    // Hook C: used twice.
    const c = await createHookTemplate({
      projectId,
      formatType,
      pattern: "C",
      language: "de",
    });
    await markHookUsed(c.id);
    await markHookUsed(c.id);

    const eligible = await listLruEligibleHooks({
      projectId,
      formatType,
      language: "de",
      limit: 10,
    });
    const ids = eligible.map((r) => r.id);
    expect(ids[0]).toBe(a.id);
    expect(ids[1]).toBe(b.id);
    expect(ids[2]).toBe(c.id);
  });

  it("markHookUsed increments usage_count + stamps last_used_at", async () => {
    const row = await createHookTemplate({
      projectId,
      formatType: "bump",
      pattern: "bump",
      language: "de",
    });
    await markHookUsed(row.id);
    await markHookUsed(row.id);
    const after = await getHookTemplate(row.id);
    expect(after?.usageCount).toBe(2);
    expect(after?.lastUsedAt).not.toBeNull();
  });

  it("setHookTemplateActive flips is_active", async () => {
    const row = await createHookTemplate({
      projectId,
      formatType: "toggle",
      pattern: "toggle",
      language: "de",
    });
    await setHookTemplateActive(row.id, false);
    const after = await getHookTemplate(row.id);
    expect(after?.isActive).toBe(false);
  });
});
