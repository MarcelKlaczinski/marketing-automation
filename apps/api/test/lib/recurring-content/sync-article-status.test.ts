/**
 * Spec 65.10 — Tests for `syncRecurringArticleStatus`.
 *
 * Covers:
 *  - Success path: recurring article in 'generating' → flips to 'published'.
 *  - Failure path: recurring article in 'generating' → flips to 'failed'.
 *  - Non-recurring articles are skipped (collection guard).
 *  - Already-terminal articles are skipped (status guard).
 *  - Missing articles are skipped with reason='not-found'.
 *  - CAS guard: parallel callers don't double-flip.
 *
 * Run: bun --filter @marketing-auto/api test test/lib/recurring-content/sync-article-status.test.ts
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";

import { syncRecurringArticleStatus } from "../../../src/lib/recurring-content/sync-article-status.ts";

describe("syncRecurringArticleStatus (Spec 65.10)", () => {
  let projectId: string;
  const createdArticleIds: string[] = [];

  beforeEach(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `sync-status-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Sync Status Test",
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
  });

  async function insertArticle(
    overrides: Partial<typeof articles.$inferInsert> = {},
  ): Promise<typeof articles.$inferSelect> {
    const [art] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `sync-status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: "Test article",
        source: "generated",
        collection: "recurring_content",
        status: "generating",
        locale: "de",
        approvalMode: "manual",
        ...overrides,
      })
      .returning();
    createdArticleIds.push(art!.id);
    return art!;
  }

  it("success outcome flips 'generating' → 'published' for recurring articles", async () => {
    const art = await insertArticle();

    const result = await syncRecurringArticleStatus({
      articleId: art.id,
      outcome: "success",
    });

    expect(result.flipped).toBe(true);
    expect(result.newStatus).toBe("published");

    const [reloaded] = await db.select().from(articles).where(eq(articles.id, art.id)).limit(1);
    expect(reloaded!.status).toBe("published");
  });

  it("failed outcome flips 'generating' → 'failed' for recurring articles", async () => {
    const art = await insertArticle();

    const result = await syncRecurringArticleStatus({
      articleId: art.id,
      outcome: "failed",
    });

    expect(result.flipped).toBe(true);
    expect(result.newStatus).toBe("failed");

    const [reloaded] = await db.select().from(articles).where(eq(articles.id, art.id)).limit(1);
    expect(reloaded!.status).toBe("failed");
  });

  it("does NOT flip non-recurring articles (collection guard)", async () => {
    const art = await insertArticle({ collection: "blog" });

    const result = await syncRecurringArticleStatus({
      articleId: art.id,
      outcome: "success",
    });

    expect(result.flipped).toBe(false);
    expect(result.skipReason).toBe("not-recurring");

    const [reloaded] = await db.select().from(articles).where(eq(articles.id, art.id)).limit(1);
    expect(reloaded!.status).toBe("generating");
  });

  it("does NOT flip already-terminal articles (status guard)", async () => {
    const art = await insertArticle({ status: "published" });

    const result = await syncRecurringArticleStatus({
      articleId: art.id,
      outcome: "failed",
    });

    expect(result.flipped).toBe(false);
    expect(result.skipReason).toBe("not-generating");

    const [reloaded] = await db.select().from(articles).where(eq(articles.id, art.id)).limit(1);
    expect(reloaded!.status).toBe("published");
  });

  it("returns skipReason='not-found' for missing articles", async () => {
    const result = await syncRecurringArticleStatus({
      articleId: "00000000-0000-0000-0000-000000000000",
      outcome: "success",
    });

    expect(result.flipped).toBe(false);
    expect(result.skipReason).toBe("not-found");
  });

  it("CAS guard: second call with same outcome no-ops after first flip", async () => {
    const art = await insertArticle();

    const first = await syncRecurringArticleStatus({ articleId: art.id, outcome: "success" });
    expect(first.flipped).toBe(true);

    // Article is now 'published' — a second sync with any outcome must no-op.
    const second = await syncRecurringArticleStatus({ articleId: art.id, outcome: "failed" });
    expect(second.flipped).toBe(false);
    expect(second.skipReason).toBe("not-generating");

    const [reloaded] = await db.select().from(articles).where(eq(articles.id, art.id)).limit(1);
    expect(reloaded!.status).toBe("published");
  });
});
