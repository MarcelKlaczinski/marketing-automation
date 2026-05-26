/**
 * Spec 65.3 — applyToolDataChanges DB integration test.
 *
 * Confirms the four side-effects of a material refresh:
 *   1. articles.tool_data_refresh_metadata gets the audit blob.
 *   2. articles.last_refreshed_at advances to NOW().
 *   3. articles.domain_extras.toolDataRefresh contains the LLM extract.
 *   4. tool_persona_scores rows for the tool are deleted on material change.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  db,
  eq,
  listPersonaScoresForTool,
  projects,
  upsertPersonaScore,
} from "@marketing-auto/db";
import { applyToolDataChanges } from "../../../src/lib/tool-data-refresh/apply-changes.ts";
import { computeToolDataDiff } from "../../../src/lib/tool-data-refresh/compute-diff.ts";
import type { ToolDataExtract } from "../../../src/lib/tool-data-refresh/extract-tool-data.ts";

const sampleExtract: ToolDataExtract = {
  pricing: {
    hasFreeTier: false,
    cheapestPaidEur: 29,
    paidTierNames: ["Pro"],
    billingModel: "monthly",
  },
  features: {
    apiAccess: true,
    selfHosted: false,
    recentMajorFeatures: "API v2 launched.",
  },
  materialChangeJudgment: {
    isMaterial: true,
    reasoning: "Free tier was removed.",
    summary: "Free tier removed; Pro tier €29/mo.",
  },
  sources: ["https://example.com/pricing"],
};

describe("applyToolDataChanges (Spec 65.3)", () => {
  let projectId: string;
  let toolId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `apply-tdr-${ts}`,
        name: "ApplyTDR test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;

    const [tool] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `tool-${ts}`,
        title: "Tool Under Test",
        collection: "tools",
        locale: "de",
        status: "proposed",
        source: "imported",
        domainExtras: { existingSibling: "keep-me" },
      })
      .returning();
    if (!tool) throw new Error("article INSERT failed");
    toolId = tool.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("writes metadata + advances last_refreshed_at + preserves sibling domain_extras keys", async () => {
    const diff = computeToolDataDiff({
      extract: sampleExtract,
      priorPricingFingerprint: null,
      priorFeatureFingerprint: null,
    });

    await applyToolDataChanges({
      toolId,
      extract: sampleExtract,
      diff,
      priorMetadata: null,
    });

    const [row] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, toolId))
      .limit(1);

    expect(row).toBeTruthy();
    expect(row?.lastRefreshedAt).not.toBeNull();
    expect(row?.toolDataRefreshMetadata).toBeTruthy();
    expect(row?.toolDataRefreshMetadata?.lastMaterialChange).toBe(true);
    expect(row?.toolDataRefreshMetadata?.lastChangeSummary).toBe(
      "Free tier removed; Pro tier €29/mo."
    );
    expect(row?.toolDataRefreshMetadata?.lastSources).toEqual([
      "https://example.com/pricing",
    ]);
    expect(row?.toolDataRefreshMetadata?.recentRefreshes).toHaveLength(1);

    // domain_extras: jsonb_set must preserve sibling keys.
    const domainExtras = row?.domainExtras as Record<string, unknown>;
    expect(domainExtras.existingSibling).toBe("keep-me");
    const refreshBucket = domainExtras.toolDataRefresh as Record<string, unknown>;
    expect(refreshBucket.materialChange).toBe(true);
    expect((refreshBucket.pricing as Record<string, unknown>).cheapestPaidEur).toBe(29);
  });

  it("ring buffer keeps newest-first and caps at 5", async () => {
    // First refresh wrote 1 entry; now add 5 more via successive applies.
    for (let i = 0; i < 5; i++) {
      const diff = computeToolDataDiff({
        extract: sampleExtract,
        priorPricingFingerprint: null,
        priorFeatureFingerprint: null,
      });
      const [priorRow] = await db
        .select({ md: articles.toolDataRefreshMetadata })
        .from(articles)
        .where(eq(articles.id, toolId))
        .limit(1);
      await applyToolDataChanges({
        toolId,
        extract: sampleExtract,
        diff,
        priorMetadata: priorRow?.md ?? null,
      });
    }
    const [row] = await db
      .select({ md: articles.toolDataRefreshMetadata })
      .from(articles)
      .where(eq(articles.id, toolId))
      .limit(1);
    expect(row?.md?.recentRefreshes).toHaveLength(5);
  });

  it("invalidates persona-scores on material change", async () => {
    // Seed scores against this tool.
    for (const persona of ["beginners", "developers"]) {
      await upsertPersonaScore({
        toolId,
        projectId,
        persona,
        score: 8,
        reasoning: "pre-invalidation",
      });
    }
    const before = await listPersonaScoresForTool({ toolId, projectId });
    expect(before).toHaveLength(2);

    const diff = computeToolDataDiff({
      extract: sampleExtract,
      priorPricingFingerprint: null,
      priorFeatureFingerprint: null,
    });

    const result = await applyToolDataChanges({
      toolId,
      extract: sampleExtract,
      diff,
      priorMetadata: null,
    });

    expect(result.materialChange).toBe(true);
    expect(result.invalidatedPersonaScores).toBe(2);

    const after = await listPersonaScoresForTool({ toolId, projectId });
    expect(after).toHaveLength(0);
  });

  it("does NOT invalidate persona-scores on non-material refresh", async () => {
    // Re-seed scores.
    for (const persona of ["beginners", "developers"]) {
      await upsertPersonaScore({
        toolId,
        projectId,
        persona,
        score: 6,
        reasoning: "re-seed for non-material test",
      });
    }

    const nonMaterialExtract: ToolDataExtract = {
      ...sampleExtract,
      materialChangeJudgment: {
        isMaterial: false,
        reasoning: "Only cosmetic copy changed.",
        summary: null,
      },
    };
    const diff = computeToolDataDiff({
      extract: nonMaterialExtract,
      priorPricingFingerprint: null,
      priorFeatureFingerprint: null,
    });

    const result = await applyToolDataChanges({
      toolId,
      extract: nonMaterialExtract,
      diff,
      priorMetadata: null,
    });

    expect(result.materialChange).toBe(false);
    expect(result.invalidatedPersonaScores).toBe(0);

    const after = await listPersonaScoresForTool({ toolId, projectId });
    expect(after).toHaveLength(2);
  });
});
