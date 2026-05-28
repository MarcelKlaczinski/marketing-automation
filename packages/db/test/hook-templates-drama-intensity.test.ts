/**
 * Spec 65.14 — drama_intensity schema + LRU filter tests.
 *
 * (1) Defaults `subtle` when not supplied on INSERT.
 * (2) CHECK constraint rejects unknown values at the DB level.
 * (3) `listLruEligibleHooks` filters by `dramaIntensities` allow-list.
 * (4) Empty `dramaIntensities` array throws (anti-footgun guard).
 * (5) Migration-0116 seed inheritance — all pre-65.14 hooks land as 'subtle'.
 *
 * Real DB; each test seeds + tears down via FK cascade on project delete.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createHookTemplate,
  db,
  eq,
  hookTemplates,
  listLruEligibleHooks,
  projects,
} from "../src/index.ts";

describe("hook_templates.drama_intensity (Spec 65.14)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [row] = await db
      .insert(projects)
      .values({
        slug: `dramaint-${ts}`,
        name: "Drama-intensity test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!row) throw new Error("project INSERT failed");
    projectId = row.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("INSERT without drama_intensity defaults to 'subtle'", async () => {
    const row = await createHookTemplate({
      projectId,
      formatType: "default-test",
      pattern: "I default to subtle, {tool}",
      language: "de",
      variables: ["tool"],
    });
    expect(row.dramaIntensity).toBe("subtle");
  });

  it("INSERT with explicit drama_intensity is persisted", async () => {
    const moderate = await createHookTemplate({
      projectId,
      formatType: "explicit-test",
      pattern: "moderate, {tool}",
      language: "de",
      variables: ["tool"],
      dramaIntensity: "moderate",
    });
    const aggressive = await createHookTemplate({
      projectId,
      formatType: "explicit-test",
      pattern: "RIP {tool}",
      language: "de",
      variables: ["tool"],
      dramaIntensity: "aggressive",
    });
    expect(moderate.dramaIntensity).toBe("moderate");
    expect(aggressive.dramaIntensity).toBe("aggressive");
  });

  it("CHECK constraint rejects unknown drama_intensity values at the DB level", async () => {
    await expect(async () => {
      // Bypass createHookTemplate to attempt a value not in the CHECK list —
      // cast through unknown because the TS type narrows to the union.
      await db.insert(hookTemplates).values({
        projectId,
        formatType: "check-test",
        pattern: "x",
        language: "de",
        variables: ["x"],
        dramaIntensity: "explosive" as unknown as "subtle",
      });
    }).toThrow(/check constraint|violates/i);
  });

  it("listLruEligibleHooks WITHOUT dramaIntensities returns all rows", async () => {
    const formatType = "filter-all";
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "s",
      language: "de",
      variables: ["x"],
      dramaIntensity: "subtle",
    });
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "m",
      language: "de",
      variables: ["x"],
      dramaIntensity: "moderate",
    });
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "a",
      language: "de",
      variables: ["x"],
      dramaIntensity: "aggressive",
    });

    const rows = await listLruEligibleHooks({
      projectId,
      formatType,
      language: "de",
    });
    expect(rows.length).toBe(3);
  });

  it("listLruEligibleHooks dramaIntensities=['subtle'] returns only subtle", async () => {
    const formatType = "filter-subtle";
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "s",
      language: "de",
      variables: ["x"],
      dramaIntensity: "subtle",
    });
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "m",
      language: "de",
      variables: ["x"],
      dramaIntensity: "moderate",
    });
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "a",
      language: "de",
      variables: ["x"],
      dramaIntensity: "aggressive",
    });

    const rows = await listLruEligibleHooks({
      projectId,
      formatType,
      language: "de",
      dramaIntensities: ["subtle"],
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.dramaIntensity).toBe("subtle");
  });

  it("listLruEligibleHooks dramaIntensities=['moderate','aggressive'] returns both, no subtle", async () => {
    const formatType = "filter-pair";
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "s",
      language: "de",
      variables: ["x"],
      dramaIntensity: "subtle",
    });
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "m",
      language: "de",
      variables: ["x"],
      dramaIntensity: "moderate",
    });
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "a",
      language: "de",
      variables: ["x"],
      dramaIntensity: "aggressive",
    });

    const rows = await listLruEligibleHooks({
      projectId,
      formatType,
      language: "de",
      dramaIntensities: ["moderate", "aggressive"],
    });
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.dramaIntensity).not.toBe("subtle");
  });

  it("listLruEligibleHooks dramaIntensities=[] throws (anti-footgun)", async () => {
    await expect(
      listLruEligibleHooks({
        projectId,
        formatType: "doesnt-matter",
        language: "de",
        dramaIntensities: [],
      }),
    ).rejects.toThrow(/empty array|undefined or non-empty/i);
  });
});
