/**
 * Spec 65.V1.5a Bridge #4 — planner-executor recurring-content preprocessing.
 *
 * Verifies the new preprocessing block in `execute-plan.ts` that materialises
 * the article BEFORE dispatching to `article:social-image`:
 *
 *   1. Recurring brief sitting in `topic_briefs` with `source='recurring'`
 *      and `routedArticleId IS NULL` lands in a `planned_items` row with
 *      `content_type='recurring_content'` and `pipelineInput.briefId` set.
 *   2. `executePlan(planId)` reaches the social-image branch, detects the
 *      `briefId-but-no-articleId` shape, calls `createRecurringContentArticle`
 *      inside a transaction, stamps `articleId` into the dispatch payload,
 *      then proceeds with `enqueueSocialImagePipeline`.
 *
 * What we assert:
 *   - `articles` row created with `collection='recurring_content'`,
 *     `status='generating'`, `clusterId=null`.
 *   - `topic_briefs.routedArticleId` updated to the new article ID.
 *   - `planned_items.pipelineRunId` is set (executor pre-INSERTed the
 *     `pipeline_runs` row) and the item flipped past 'pending'.
 *
 * The BullMQ enqueue side-effect happens at the end (a real `add()` call
 * against Redis). We don't wait for the job to be picked up; just verify
 * the DB state immediately after `executePlan` returns. Redis cleanup is
 * handled by the test's project CASCADE — the queued job becomes
 * unreachable orphan once its brief / planned_item are gone.
 *
 * Multi-tenant guard is also exercised: a brief belonging to a different
 * project than the plan's is rejected (helper throws, item flipped to
 * 'failed').
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  and,
  articles,
  db,
  eq,
  plannedItems,
  projects,
  recurringContentDefinitions,
  topicBriefs,
  weeklyPlans,
} from "@marketing-auto/db";
import { executePlan } from "../../src/execution/execute-plan.ts";

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `bridge4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "bridge4-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  return row!.id;
}

async function freshPlan(projectId: string): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(weeklyPlans)
    .values({
      projectId,
      year: now.getUTCFullYear(),
      // CHECK constraint requires 1..53. Pick a value unlikely to collide with
      // the partial unique index by using week 53.
      isoWeek: 53,
      weekStartDate: now,
      weekEndDate: now,
      status: "approved",
      estimatedCostEur: "0",
      inputSnapshot: {} as never,
    })
    .returning();
  return row!.id;
}

async function freshDefinition(projectId: string): Promise<string> {
  const [row] = await db
    .insert(recurringContentDefinitions)
    .values({
      projectId,
      name: "bridge4 def",
      formatType: "top_n_comparison",
      formatConfig: { topN: 5 },
      frequency: "weekly",
      nextRunAt: new Date(),
    })
    .returning({ id: recurringContentDefinitions.id });
  return row!.id;
}

async function freshBrief(projectId: string, definitionId: string): Promise<string> {
  const [row] = await db
    .insert(topicBriefs)
    .values({
      projectId,
      source: "recurring",
      topicTitle: "Top 5 tools for marketers in 2026",
      primaryKeyword: "marketing tools",
      secondaryKeywords: [],
      clusterAction: "standalone",
      locale: "de",
      approvalStatus: "plan_pending",
      suggestedMeta: "Brief preview body",
      recurringMetadata: {
        definitionId,
        runNumber: 1,
        previousToolIds: [],
        formatType: "top_n_comparison",
        formatConfig: {
          selectedTemplateKey: "comparison-grid-5",
          selectedTemplateVia: "lru",
          outputTargets: { social: true, article: false },
          toolIds: [],
        },
      },
    })
    .returning({ id: topicBriefs.id });
  return row!.id;
}

async function freshPlannedItem(
  projectId: string,
  planId: string,
  briefId: string,
): Promise<string> {
  const [row] = await db
    .insert(plannedItems)
    .values({
      weeklyPlanId: planId,
      projectId,
      contentType: "recurring_content",
      pipelineName: "article:social-image",
      slotDate: new Date(),
      sourceKind: "floor",
      sourceBriefId: briefId,
      pipelineInput: {
        briefId,
        templateKey: "comparison-grid-5",
      },
      estimatedCostEur: "0",
      status: "pending",
    })
    .returning({ id: plannedItems.id });
  return row!.id;
}

let projectId: string;
let planId: string;
let definitionId: string;

beforeEach(async () => {
  projectId = await freshProject();
  planId = await freshPlan(projectId);
  definitionId = await freshDefinition(projectId);
});

afterEach(async () => {
  // Cascade: project deletes weekly_plans + planned_items + topic_briefs +
  // recurring_content_definitions; articles created during the test fall out
  // via their projectId FK.
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("executePlan — Bridge #4 recurring-content preprocessing", () => {
  it("materialises an article for a recurring brief before dispatch", async () => {
    const briefId = await freshBrief(projectId, definitionId);
    const itemId = await freshPlannedItem(projectId, planId, briefId);

    const result = await executePlan(planId);

    // The item dispatched as an enqueue (not failed, not blocked).
    expect(result.enqueued).toBe(1);
    expect(result.inlineFailed).toBe(0);
    expect(result.blocked).toBe(0);

    // Brief now has routedArticleId stamped.
    const [briefAfter] = await db
      .select({ routedArticleId: topicBriefs.routedArticleId })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, briefId))
      .limit(1);
    expect(briefAfter?.routedArticleId).not.toBeNull();
    const articleId = briefAfter!.routedArticleId!;

    // Article row landed with the expected shape.
    const [art] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(art).toBeDefined();
    expect(art!.collection).toBe("recurring_content");
    expect(art!.status).toBe("generating");
    expect(art!.clusterId).toBeNull();
    expect(art!.projectId).toBe(projectId);
    // domainExtras carries the frozen snapshot per Spec 65.10.
    const recurring = (art!.domainExtras as { recurring?: { sourceBriefId?: string } } | null)
      ?.recurring;
    expect(recurring?.sourceBriefId).toBe(briefId);

    // Planned item moved past pending and got a runId.
    const [pi] = await db
      .select()
      .from(plannedItems)
      .where(eq(plannedItems.id, itemId))
      .limit(1);
    expect(pi).toBeDefined();
    expect(pi!.status).not.toBe("pending");
    expect(pi!.pipelineRunId).not.toBeNull();
  });

  it("is idempotent on re-entry — brief already has routedArticleId", async () => {
    // Seed an already-materialised brief (mirrors the re-trigger path).
    const briefId = await freshBrief(projectId, definitionId);

    // Pre-insert article + stamp routedArticleId — simulating a prior partial
    // executePlan that already created the article but failed the BullMQ
    // enqueue. The next executePlan must re-use the existing article and
    // flip it back to 'generating' (not create a duplicate).
    const [existing] = await db
      .insert(articles)
      .values({
        projectId,
        slug: "pre-existing-recurring-stub",
        title: "Top 5 tools for marketers in 2026",
        source: "generated",
        collection: "recurring_content",
        status: "ready_to_publish", // not 'generating' — verify the helper flips it back
        locale: "de",
        clusterId: null,
        approvalMode: "manual",
      })
      .returning({ id: articles.id });
    const preExistingArticleId = existing!.id;
    await db
      .update(topicBriefs)
      .set({ routedArticleId: preExistingArticleId })
      .where(eq(topicBriefs.id, briefId));

    await freshPlannedItem(projectId, planId, briefId);

    const result = await executePlan(planId);
    expect(result.enqueued).toBe(1);

    // Same article (not a fresh INSERT) — confirms idempotent re-entry.
    const [updated] = await db
      .select({ id: articles.id, status: articles.status })
      .from(articles)
      .where(eq(articles.id, preExistingArticleId))
      .limit(1);
    expect(updated?.id).toBe(preExistingArticleId);
    expect(updated?.status).toBe("generating");

    // No second article was created — only the pre-existing one.
    const allArticles = await db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.collection, "recurring_content"),
        ),
      );
    expect(allArticles.length).toBe(1);
  });

  it("fails the item when the brief belongs to a different project (multi-tenant guard)", async () => {
    // Brief in OTHER project; planned_item in this plan's project.
    const otherProjectId = await freshProject();
    const otherDefId = await freshDefinition(otherProjectId);
    const foreignBriefId = await freshBrief(otherProjectId, otherDefId);
    const itemId = await freshPlannedItem(projectId, planId, foreignBriefId);

    const result = await executePlan(planId);

    expect(result.enqueued).toBe(0);
    expect(result.inlineFailed).toBe(1);

    const [pi] = await db
      .select()
      .from(plannedItems)
      .where(eq(plannedItems.id, itemId))
      .limit(1);
    expect(pi!.status).toBe("failed");
    expect(pi!.failureReason).toContain("belongs to project");

    // No article was created.
    const articlesFound = await db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.collection, "recurring_content"),
        ),
      );
    expect(articlesFound.length).toBe(0);

    // Cleanup the other project (afterEach only deletes the primary one).
    await db.delete(projects).where(eq(projects.id, otherProjectId));
  });
});
