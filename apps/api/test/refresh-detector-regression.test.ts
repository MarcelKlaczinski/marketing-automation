// Spec 62.0a Section 8.4.4: refresh-detector regression tests covering the Pre-flight
// Task 3 fixes — idempotent INSERT, auto-dismiss-on-rerun, and effective-freshness
// fallback order (frontmatterUpdatedAt → lastRefreshedAt → publishedAt → updatedAt).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  and,
  articles,
  db,
  eq,
  isNull,
  projects,
  refreshSuggestions,
} from "@marketing-auto/db";
import { detectStaleArticles } from "../src/workers/refresh-detector.ts";

const THRESHOLD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("refresh-detector regression (Spec 62.0a D-PF3)", () => {
  let projectId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `refresh-d-test-${Date.now()}`,
        name: "Refresh-Detector D-PF3 Regression",
        industry: "ai_education",
        pipelineTemplate: "educational",
        refreshStalenessThresholdDays: THRESHOLD_DAYS,
      })
      .returning();
    if (!p) throw new Error("project insert failed");
    projectId = p.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("INSERTs a refresh_suggestions row for each stale article (no SSE-only emission)", async () => {
    const articleId = await insertStaleArticle(projectId, {
      publishedAt: new Date(Date.now() - 90 * DAY_MS),
    });

    const before = await countActiveSuggestions(projectId);
    const result = await detectStaleArticles(projectId);
    const after = await countActiveSuggestions(projectId);

    expect(result.candidateCount).toBeGreaterThanOrEqual(1);
    expect(after).toBe(before + 1);

    // Cleanup
    await db.delete(articles).where(eq(articles.id, articleId));
    await db
      .delete(refreshSuggestions)
      .where(eq(refreshSuggestions.articleId, articleId));
  });

  it("is idempotent: a second run on the same stale set adds 0 new rows", async () => {
    const articleId = await insertStaleArticle(projectId, {
      publishedAt: new Date(Date.now() - 120 * DAY_MS),
    });

    await detectStaleArticles(projectId);
    const after1 = await countActiveSuggestions(projectId);
    await detectStaleArticles(projectId);
    const after2 = await countActiveSuggestions(projectId);

    expect(after2).toBe(after1);

    await db.delete(articles).where(eq(articles.id, articleId));
    await db
      .delete(refreshSuggestions)
      .where(eq(refreshSuggestions.articleId, articleId));
  });

  it("auto-dismisses the suggestion when the article becomes fresh between runs", async () => {
    const articleId = await insertStaleArticle(projectId, {
      publishedAt: new Date(Date.now() - 90 * DAY_MS),
    });
    await detectStaleArticles(projectId);

    const [active] = await db
      .select({ id: refreshSuggestions.id })
      .from(refreshSuggestions)
      .where(
        and(
          eq(refreshSuggestions.articleId, articleId),
          eq(refreshSuggestions.source, "time"),
          isNull(refreshSuggestions.dismissedAt),
        ),
      )
      .limit(1);
    expect(active).toBeDefined();

    // Mark the article as freshly updated via frontmatter (author edit).
    await db
      .update(articles)
      .set({ frontmatterUpdatedAt: new Date(Date.now() - 1 * DAY_MS) })
      .where(eq(articles.id, articleId));

    await detectStaleArticles(projectId);

    const [stillActive] = await db
      .select({ id: refreshSuggestions.id, dismissedAt: refreshSuggestions.dismissedAt })
      .from(refreshSuggestions)
      .where(eq(refreshSuggestions.id, active!.id))
      .limit(1);
    expect(stillActive!.dismissedAt).not.toBeNull();

    await db.delete(articles).where(eq(articles.id, articleId));
    await db
      .delete(refreshSuggestions)
      .where(eq(refreshSuggestions.articleId, articleId));
  });

  it("respects frontmatterUpdatedAt as the wins-over-publishedAt freshness signal", async () => {
    // Article: publishedAt 200 days ago, frontmatterUpdatedAt 2 days ago. Should NOT be stale.
    const articleId = await insertStaleArticle(projectId, {
      publishedAt: new Date(Date.now() - 200 * DAY_MS),
      frontmatterUpdatedAt: new Date(Date.now() - 2 * DAY_MS),
    });

    const result = await detectStaleArticles(projectId);
    const candidateIds = result.candidates.map((c) => c.id);
    expect(candidateIds).not.toContain(articleId);

    await db.delete(articles).where(eq(articles.id, articleId));
  });

  it("uses lastRefreshedAt when frontmatterUpdatedAt is null", async () => {
    // Article: publishedAt 200d ago, lastRefreshedAt 200d ago (stale via this fallback).
    const articleId = await insertStaleArticle(projectId, {
      publishedAt: new Date(Date.now() - 200 * DAY_MS),
      lastRefreshedAt: new Date(Date.now() - 200 * DAY_MS),
    });

    const result = await detectStaleArticles(projectId);
    const candidateIds = result.candidates.map((c) => c.id);
    expect(candidateIds).toContain(articleId);

    await db.delete(articles).where(eq(articles.id, articleId));
    await db
      .delete(refreshSuggestions)
      .where(eq(refreshSuggestions.articleId, articleId));
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function insertStaleArticle(
  projectId: string,
  fields: {
    publishedAt?: Date;
    frontmatterUpdatedAt?: Date;
    lastRefreshedAt?: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(articles)
    .values({
      projectId,
      title: "Stale fixture",
      slug: `stale-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cornerstoneKeyword: "stale",
      status: "published",
      collection: "blog",
      source: "imported",
      locale: "de",
      ...(fields.publishedAt ? { publishedAt: fields.publishedAt } : {}),
      ...(fields.frontmatterUpdatedAt
        ? { frontmatterUpdatedAt: fields.frontmatterUpdatedAt }
        : {}),
      ...(fields.lastRefreshedAt ? { lastRefreshedAt: fields.lastRefreshedAt } : {}),
    })
    .returning({ id: articles.id });
  if (!row) throw new Error("article insert failed");
  return row.id;
}

async function countActiveSuggestions(projectId: string): Promise<number> {
  const rows = await db
    .select({ id: refreshSuggestions.id })
    .from(refreshSuggestions)
    .where(
      and(
        eq(refreshSuggestions.projectId, projectId),
        eq(refreshSuggestions.source, "time"),
        isNull(refreshSuggestions.dismissedAt),
        isNull(refreshSuggestions.approvedAt),
      ),
    );
  return rows.length;
}
