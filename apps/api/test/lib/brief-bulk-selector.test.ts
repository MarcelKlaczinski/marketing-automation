/**
 * Spec 64.17 — brief-bulk-selector tests.
 *
 * Covers `resolveBulkBriefIds()` for both body shapes plus `buildBriefsWhere()`
 * via the filter-shape branch. Real DB; per-suite project to keep the
 * multi-tenant invariant honest (a brief in projectA must NEVER come back
 * when resolving a filter scoped to projectB).
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  clusters,
  contentPillars,
  db,
  eq,
  inArray,
  projects,
  topicBriefs,
} from "@marketing-auto/db";

import { resolveBulkBriefIds } from "../../src/lib/brief-bulk-selector.ts";

describe("brief-bulk-selector resolveBulkBriefIds (Spec 64.17)", () => {
  let projectId: string;
  let otherProjectId: string;
  let clusterId: string;
  const createdBriefIds: string[] = [];

  beforeAll(async () => {
    const suite = `bulk-selector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [p] = await db
      .insert(projects)
      .values({
        slug: `${suite}-a`,
        name: "Bulk Selector A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;

    const [other] = await db
      .insert(projects)
      .values({
        slug: `${suite}-b`,
        name: "Bulk Selector B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    otherProjectId = other!.id;

    const [pillar] = await db
      .insert(contentPillars)
      .values({ projectId, name: "AI Tools", position: 0 })
      .returning();

    const [c] = await db
      .insert(clusters)
      .values({
        projectId,
        pillarId: pillar!.id,
        name: "KI Tools",
        pillar: "AI Tools",
        cornerstoneKeywords: ["ki-tools"],
        satelliteKeywords: [],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;
  });

  beforeEach(async () => {
    // Wipe per-test briefs so each `it` works against a clean slate.
    if (createdBriefIds.length > 0) {
      await db.delete(topicBriefs).where(inArray(topicBriefs.id, createdBriefIds));
      createdBriefIds.length = 0;
    }
  });

  afterAll(async () => {
    if (createdBriefIds.length > 0) {
      await db.delete(topicBriefs).where(inArray(topicBriefs.id, createdBriefIds));
    }
    await db.delete(clusters).where(eq(clusters.id, clusterId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(projects).where(eq(projects.id, otherProjectId));
  });

  async function insertBrief(overrides: Partial<typeof topicBriefs.$inferInsert> = {}) {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        source: "gap_analysis",
        topicTitle: "Test topic",
        primaryKeyword: "test keyword",
        secondaryKeywords: [],
        clusterId,
        clusterAction: "append_to_existing",
        locale: "de",
        intentType: "general",
        generationMode: "spoke",
        approvalStatus: "pending",
        ...overrides,
      })
      .returning();
    createdBriefIds.push(brief!.id);
    return brief!;
  }

  // ─── Test #9: briefIds shape pass-through ─────────────────────────────────
  it("briefIds shape: returns the input list unchanged with reQueried=false", async () => {
    const b1 = await insertBrief();
    const b2 = await insertBrief({ topicTitle: "Topic 2" });

    const result = await resolveBulkBriefIds(projectId, { briefIds: [b1.id, b2.id] });

    expect(result.reQueried).toBe(false);
    expect(result.briefIds.sort()).toEqual([b1.id, b2.id].sort());
  });

  // ─── Test #10: filter shape with section+source ───────────────────────────
  it("filter shape: section=pending + source filter returns matching IDs only", async () => {
    const gap = await insertBrief({ source: "gap_analysis" });
    const trend = await insertBrief({ source: "trend_discovery", topicTitle: "Trend topic" });
    await insertBrief({ source: "manual", topicTitle: "Manual topic" });

    const result = await resolveBulkBriefIds(projectId, {
      filter: { section: "pending", source: ["gap_analysis", "trend_discovery"] },
    });

    expect(result.reQueried).toBe(true);
    expect(result.briefIds.sort()).toEqual([gap.id, trend.id].sort());
  });

  // ─── Test #11: filter shape with excludeIds ───────────────────────────────
  it("filter shape: excludeIds subtracts from the re-query result", async () => {
    const b1 = await insertBrief();
    const b2 = await insertBrief({ topicTitle: "Topic 2" });
    const b3 = await insertBrief({ topicTitle: "Topic 3" });

    const result = await resolveBulkBriefIds(projectId, {
      filter: { section: "pending" },
      excludeIds: [b1.id, b3.id],
    });

    expect(result.reQueried).toBe(true);
    expect(result.briefIds).toEqual([b2.id]);
  });

  // ─── Test #12: multi-tenant isolation ─────────────────────────────────────
  it("filter shape: project-scoped — briefs in other projects are NOT returned", async () => {
    const own = await insertBrief();
    // Insert a brief in the OTHER project that would match the filter.
    const [foreign] = await db
      .insert(topicBriefs)
      .values({
        projectId: otherProjectId,
        source: "gap_analysis",
        topicTitle: "Foreign topic",
        primaryKeyword: "foreign",
        secondaryKeywords: [],
        clusterAction: "standalone",
        approvalStatus: "pending",
      })
      .returning();
    createdBriefIds.push(foreign!.id);

    const result = await resolveBulkBriefIds(projectId, {
      filter: { section: "pending" },
    });

    expect(result.briefIds).toContain(own.id);
    expect(result.briefIds).not.toContain(foreign!.id);
  });

  // ─── Filter shape: readiness=plan_ready returns plan_pending briefs ───────
  it("filter shape: readiness=plan_ready resolves plan_pending briefs", async () => {
    const pending = await insertBrief();
    const planPending = await insertBrief({
      approvalStatus: "plan_pending",
      topicTitle: "Plan pending topic",
    });

    const result = await resolveBulkBriefIds(projectId, {
      filter: { section: "pending", readiness: "plan_ready" },
    });

    expect(result.briefIds).toContain(planPending.id);
    expect(result.briefIds).not.toContain(pending.id);
  });
});
