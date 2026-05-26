/**
 * Spec 65.10 — Tests for `createRecurringContentArticle`.
 *
 * Covers:
 *  - Happy path: brief → articles row with collection='recurring_content',
 *    status='generating', clusterId=null, domainExtras snapshot complete.
 *  - Idempotent re-entry: brief.routedArticleId already set → existing row
 *    flipped back to 'generating' (re-trigger path).
 *  - Slug uniqueness: two briefs with identical topicTitle get suffixed slugs.
 *  - Locale resolution: `brief.locale === 'en'` produces an EN row.
 *  - Validation: missing recurringMetadata throws; non-recurring source throws.
 *
 * Run: bun --filter @marketing-auto/api test test/lib/recurring-content/create-article.test.ts
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  type Transaction,
  articles,
  db,
  eq,
  projects,
  topicBriefs,
} from "@marketing-auto/db";

import {
  CreateRecurringArticleError,
  createRecurringContentArticle,
} from "../../../src/lib/recurring-content/create-article.ts";

describe("createRecurringContentArticle (Spec 65.10)", () => {
  let projectId: string;
  const createdBriefIds: string[] = [];
  const createdArticleIds: string[] = [];

  beforeEach(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `create-article-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Create Article Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    for (const id of createdArticleIds) {
      await db.delete(articles).where(eq(articles.id, id)).catch(() => undefined);
    }
    for (const id of createdBriefIds) {
      await db.delete(topicBriefs).where(eq(topicBriefs.id, id)).catch(() => undefined);
    }
  });

  async function insertRecurringBrief(
    overrides: Partial<typeof topicBriefs.$inferInsert> = {},
  ): Promise<typeof topicBriefs.$inferSelect> {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        source: "recurring",
        topicTitle: "5 KI-Tools für Marketing 2026",
        primaryKeyword: "ki marketing tools",
        secondaryKeywords: [],
        clusterAction: "standalone",
        locale: "de",
        approvalStatus: "plan_pending",
        recurringMetadata: {
          definitionId: "11111111-1111-1111-1111-111111111111",
          runNumber: 1,
          previousToolIds: [],
          formatType: "top-n-comparison",
          formatConfig: {
            outputTargets: { social: true },
            selectedTemplateKey: "comparison-grid-3",
            selectedTemplateVia: "lru" as const,
            toolIds: [],
          },
        },
        ...overrides,
      })
      .returning();
    createdBriefIds.push(brief!.id);
    return brief!;
  }

  it("creates an articles row with collection='recurring_content' + status='generating'", async () => {
    const brief = await insertRecurringBrief();

    const result = await db.transaction(async (tx: Transaction) =>
      createRecurringContentArticle({ brief, tx }),
    );
    createdArticleIds.push(result.articleId);

    expect(result.created).toBe(true);
    // Slug shape: lowercased + non-alphanumeric collapsed to '-'. Exact umlaut
    // handling is delegated to the shared `slugify()` helper — we just assert
    // structural invariants here, not the exact umlaut mapping.
    expect(result.slug).toMatch(/^5-ki-tools-[a-z0-9-]+-marketing-2026$/);

    const [art] = await db.select().from(articles).where(eq(articles.id, result.articleId)).limit(1);
    expect(art).toBeDefined();
    expect(art!.collection).toBe("recurring_content");
    expect(art!.status).toBe("generating");
    expect(art!.source).toBe("generated");
    expect(art!.clusterId).toBeNull();
    expect(art!.locale).toBe("de");
    expect(art!.title).toBe(brief.topicTitle);
    expect(art!.approvalMode).toBe("manual");

    const extras = art!.domainExtras as Record<string, unknown>;
    expect(extras.recurring).toBeDefined();
    const recurring = extras.recurring as Record<string, unknown>;
    expect(recurring.sourceBriefId).toBe(brief.id);
    expect(recurring.definitionId).toBe("11111111-1111-1111-1111-111111111111");
    expect(recurring.runNumber).toBe(1);
    expect(recurring.formatType).toBe("top-n-comparison");

    // brief.routedArticleId now stamped
    const [reloadedBrief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloadedBrief!.routedArticleId).toBe(result.articleId);
  });

  it("re-entry: brief.routedArticleId set → flips existing row back to 'generating'", async () => {
    // First create.
    const brief = await insertRecurringBrief();
    const first = await db.transaction(async (tx: Transaction) =>
      createRecurringContentArticle({ brief, tx }),
    );
    createdArticleIds.push(first.articleId);

    // Flip article to 'published' (simulating a successful render).
    await db
      .update(articles)
      .set({ status: "published" })
      .where(eq(articles.id, first.articleId));

    // Re-load brief (now has routedArticleId set).
    const [reloadedBrief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);

    // Re-entry should NOT INSERT — should flip existing back to 'generating'.
    const second = await db.transaction(async (tx: Transaction) =>
      createRecurringContentArticle({ brief: reloadedBrief!, tx }),
    );

    expect(second.created).toBe(false);
    expect(second.articleId).toBe(first.articleId);

    const [art] = await db.select().from(articles).where(eq(articles.id, first.articleId)).limit(1);
    expect(art!.status).toBe("generating");
  });

  it("slug-uniqueness: two briefs with same title get suffixed slugs (-2, -3, ...)", async () => {
    const briefA = await insertRecurringBrief({ topicTitle: "Identical title here" });
    const resultA = await db.transaction(async (tx: Transaction) =>
      createRecurringContentArticle({ brief: briefA, tx }),
    );
    createdArticleIds.push(resultA.articleId);

    const briefB = await insertRecurringBrief({ topicTitle: "Identical title here" });
    const resultB = await db.transaction(async (tx: Transaction) =>
      createRecurringContentArticle({ brief: briefB, tx }),
    );
    createdArticleIds.push(resultB.articleId);

    expect(resultA.slug).toBe("identical-title-here");
    expect(resultB.slug).toBe("identical-title-here-2");
  });

  it("locale='en' produces an EN article row", async () => {
    const brief = await insertRecurringBrief({ locale: "en" });

    const result = await db.transaction(async (tx: Transaction) =>
      createRecurringContentArticle({ brief, tx }),
    );
    createdArticleIds.push(result.articleId);

    const [art] = await db.select().from(articles).where(eq(articles.id, result.articleId)).limit(1);
    expect(art!.locale).toBe("en");
  });

  it("throws when brief.source !== 'recurring'", async () => {
    const brief = await insertRecurringBrief({
      source: "gap_analysis",
      recurringMetadata: null,
    });

    await expect(
      db.transaction(async (tx: Transaction) =>
        createRecurringContentArticle({ brief, tx }),
      ),
    ).rejects.toBeInstanceOf(CreateRecurringArticleError);
  });

  it("throws when recurringMetadata is null on a recurring brief", async () => {
    // Bypass schema by direct UPDATE — exercise the runtime guard.
    const brief = await insertRecurringBrief();
    await db
      .update(topicBriefs)
      .set({ recurringMetadata: null })
      .where(eq(topicBriefs.id, brief.id));
    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);

    await expect(
      db.transaction(async (tx: Transaction) =>
        createRecurringContentArticle({ brief: reloaded!, tx }),
      ),
    ).rejects.toBeInstanceOf(CreateRecurringArticleError);
  });
});
