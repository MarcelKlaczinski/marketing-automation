import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";
import { BlogPipelineError, updateArticleAuthor } from "../../../src/article/blog/persist.ts";

const RUN_DB = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!RUN_DB)("updateArticleAuthor persist guard (DB)", () => {
  let projectId: string;
  let articleId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `test-persist-author-${Date.now()}`,
        name: "test-persist-author",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    // Create an author in the authors collection
    await db.insert(articles).values({
      projectId,
      slug: "anna-weidner",
      title: "Anna Weidner",
      collection: "authors",
      source: "imported",
      locale: "de",
    });

    // Create a blog article to test against
    const [art] = await db
      .insert(articles)
      .values({
        projectId,
        slug: "test-article",
        title: "Test Article",
        collection: "blog",
        source: "generated",
        locale: "de",
        status: "generating",
      })
      .returning({ id: articles.id });
    articleId = art!.id;
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("succeeds when author exists in authors collection", async () => {
    await expect(
      updateArticleAuthor(articleId, "anna-weidner", "default_fallback"),
    ).resolves.toBeUndefined();

    const [updated] = await db
      .select({ author: articles.author })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(updated?.author).toBe("anna-weidner");
  });

  it("throws BlogPipelineError when author does not exist in authors collection", async () => {
    await expect(
      updateArticleAuthor(articleId, "thomas-mueller", "default_fallback"),
    ).rejects.toThrow(BlogPipelineError);

    // Article author should be unchanged
    const [unchanged] = await db
      .select({ author: articles.author })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(unchanged?.author).toBe("anna-weidner");
  });

  it("throws BlogPipelineError for non-existent article", async () => {
    await expect(
      updateArticleAuthor(crypto.randomUUID(), "anna-weidner", "historic_score"),
    ).rejects.toThrow(BlogPipelineError);
  });
});
