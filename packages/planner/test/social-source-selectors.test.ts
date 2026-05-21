// Spec 62.4-followup Theme-62 Task-2: regression for the SQL crash in
// `pickFromSuggestionPool`. Pre-fix the empty-exclude branch produced a
// stray `and )` in the WHERE clause and Postgres rejected the query with
// `42601 syntax error at or near ")"`. Both shapes must round-trip cleanly
// against a real DB.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  articles,
  db,
  eq,
  projects,
  refreshSuggestions,
} from "@marketing-auto/db";
import {
  countSuggestionPool,
  pickFromRefreshSuggestions,
  pickFromSuggestionPool,
} from "../src/index.ts";

let projectId: string;

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `social-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "social-source-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  return row!.id;
}

beforeEach(async () => {
  projectId = await freshProject();
});

afterEach(async () => {
  await db
    .delete(refreshSuggestions)
    .where(eq(refreshSuggestions.projectId, projectId));
  await db.delete(articles).where(eq(articles.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("pickFromSuggestionPool — exclude-list edge cases", () => {
  it("runs cleanly with no excludeArticleIds (regression for syntax error at or near ')')", async () => {
    // Before the fix this call crashed at the postgres bind step with
    // PostgresError 42601 because Drizzle's `and(...)` rendered the empty
    // `sql\`\`` slot as a trailing `and `.
    const rows = await pickFromSuggestionPool({ projectId, limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("runs cleanly with an empty excludeArticleIds array", async () => {
    const rows = await pickFromSuggestionPool({
      projectId,
      limit: 5,
      excludeArticleIds: [],
    });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("honours a non-empty exclude list", async () => {
    // Insert two published DE articles. Exclude one — only the other should
    // come back.
    const inserted = await db
      .insert(articles)
      .values([
        {
          projectId,
          slug: "kept",
          title: "Kept article",
          // Spec 63.2: pool filters to tools/comparisons; default 'blog' would
          // be excluded by the allow-list.
          collection: "tools",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
        {
          projectId,
          slug: "excluded",
          title: "Excluded article",
          collection: "tools",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
      ])
      .returning({ id: articles.id, slug: articles.slug });
    const excludedId = inserted.find((r) => r.slug === "excluded")!.id;

    const rows = await pickFromSuggestionPool({
      projectId,
      limit: 10,
      excludeArticleIds: [excludedId],
    });
    const ids = rows.map((r) => r.articleId);
    expect(ids).not.toContain(excludedId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });
});

// Spec 63.1: author profiles are reference data, not generatable social-post
// hooks. They must never reach the social-post selection pool.
describe("authors collection exclusion (Spec 63.1)", () => {
  it("excludes authors-collection articles from pickFromSuggestionPool", async () => {
    const inserted = await db
      .insert(articles)
      .values([
        {
          projectId,
          slug: "blog-post",
          title: "Tool candidate",
          collection: "tools",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
        {
          projectId,
          slug: "anna-weidner",
          title: "Anna Weidner",
          collection: "authors",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
      ])
      .returning({ id: articles.id, collection: articles.collection });

    const authorId = inserted.find((r) => r.collection === "authors")!.id;
    const blogId = inserted.find((r) => r.collection === "tools")!.id;

    const rows = await pickFromSuggestionPool({ projectId, limit: 10 });
    const ids = rows.map((r) => r.articleId);

    expect(ids).toContain(blogId);
    expect(ids).not.toContain(authorId);
  });

  it("countSuggestionPool ignores authors-collection rows", async () => {
    await db.insert(articles).values([
      {
        projectId,
        slug: "blog-post",
        title: "Tool candidate",
        collection: "tools",
        locale: "de",
        status: "published",
        publishedAt: new Date(),
      },
      {
        projectId,
        slug: "anna-weidner",
        title: "Anna Weidner",
        collection: "authors",
        locale: "de",
        status: "published",
        publishedAt: new Date(),
      },
    ]);

    const count = await countSuggestionPool({ projectId });
    expect(count).toBe(1);
  });

  it("excludes authors-collection articles from pickFromRefreshSuggestions", async () => {
    const inserted = await db
      .insert(articles)
      .values([
        {
          projectId,
          slug: "blog-post",
          title: "Tool candidate",
          collection: "tools",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
        {
          projectId,
          slug: "anna-weidner",
          title: "Anna Weidner",
          collection: "authors",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
      ])
      .returning({ id: articles.id, collection: articles.collection });

    const blogId = inserted.find((r) => r.collection === "tools")!.id;
    const authorId = inserted.find((r) => r.collection === "authors")!.id;

    await db.insert(refreshSuggestions).values([
      {
        projectId,
        articleId: blogId,
        source: "time",
        reasoning: "test fixture",
      },
      {
        projectId,
        articleId: authorId,
        source: "time",
        reasoning: "test fixture",
      },
    ]);

    const rows = await pickFromRefreshSuggestions({ projectId, limit: 10 });
    const articleIds = rows.map((r) => r.articleId);

    expect(articleIds).toContain(blogId);
    expect(articleIds).not.toContain(authorId);
  });
});

// Spec 63.2: source-pool selectors must only return articles from collections
// that have at least one social template (currently `tools` and `comparisons`).
// Articles from non-eligible collections (ki-wissen, usecases, blog, …) would
// die at generation time on the per-article eligibility check and inflate the
// plan cost / item count.
describe("social-eligible collections filter (Spec 63.2)", () => {
  async function seedMixedCollectionPool() {
    return db
      .insert(articles)
      .values([
        {
          projectId,
          slug: "tool-spotlight",
          title: "Tool spotlight",
          collection: "tools",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
        {
          projectId,
          slug: "tool-vs-tool",
          title: "Tool comparison",
          collection: "comparisons",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
        {
          projectId,
          slug: "ki-explainer",
          title: "Was ist Transfer Learning",
          collection: "ki-wissen",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
        {
          projectId,
          slug: "marketing-use-case",
          title: "ChatGPT für Marketing",
          collection: "usecases",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
        {
          projectId,
          slug: "vanilla-blog",
          title: "Generic blog post",
          collection: "blog",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
      ])
      .returning({ id: articles.id, collection: articles.collection });
  }

  it("pickFromSuggestionPool returns only tools + comparisons rows", async () => {
    const inserted = await seedMixedCollectionPool();

    const rows = await pickFromSuggestionPool({ projectId, limit: 10 });
    const ids = new Set(rows.map((r) => r.articleId));
    const byCollection = (collection: string) =>
      inserted.find((r) => r.collection === collection)!.id;

    expect(ids).toContain(byCollection("tools"));
    expect(ids).toContain(byCollection("comparisons"));
    expect(ids).not.toContain(byCollection("ki-wissen"));
    expect(ids).not.toContain(byCollection("usecases"));
    expect(ids).not.toContain(byCollection("blog"));
  });

  it("countSuggestionPool counts only tools + comparisons rows", async () => {
    await seedMixedCollectionPool();

    const count = await countSuggestionPool({ projectId });
    expect(count).toBe(2);
  });

  it("pickFromRefreshSuggestions returns only tools + comparisons rows", async () => {
    const inserted = await seedMixedCollectionPool();

    await db.insert(refreshSuggestions).values(
      inserted.map((row) => ({
        projectId,
        articleId: row.id,
        source: "time" as const,
        reasoning: "test fixture",
      })),
    );

    const rows = await pickFromRefreshSuggestions({ projectId, limit: 10 });
    const ids = new Set(rows.map((r) => r.articleId));
    const byCollection = (collection: string) =>
      inserted.find((r) => r.collection === collection)!.id;

    expect(ids).toContain(byCollection("tools"));
    expect(ids).toContain(byCollection("comparisons"));
    expect(ids).not.toContain(byCollection("ki-wissen"));
    expect(ids).not.toContain(byCollection("usecases"));
    expect(ids).not.toContain(byCollection("blog"));
  });
});
