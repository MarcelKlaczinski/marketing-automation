import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";
import { AuthorPickerError, pickAuthor } from "../../../src/article/author-picker/index.ts";
import type { TopicBrief } from "@marketing-auto/db";

const RUN_DB = process.env.RUN_DB_TESTS === "1";

function makeBrief(projectId: string, overrides: Partial<TopicBrief> = {}): TopicBrief {
  return {
    id: crypto.randomUUID(),
    projectId,
    topicTitle: "Test Topic",
    primaryKeyword: "test-keyword",
    locale: "de",
    source: "manual",
    status: "approved",
    clusterId: null,
    intentType: null,
    routedArticleId: null,
    suggestedSlug: null,
    suggestedTitle: null,
    suggestedMeta: null,
    secondaryKeywords: [],
    targetAudience: null,
    trendMetadata: null,
    gapMetadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TopicBrief;
}

describe.skipIf(!RUN_DB)("defaultFallbackAuthor (DB)", () => {
  let projectId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `test-default-fallback-${Date.now()}`,
        name: "test-default-fallback",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns the author with the most imported blog posts when they exist in authors collection", async () => {
    // Seed 3 authors in the authors collection
    await db.insert(articles).values([
      {
        projectId,
        slug: "anna-weidner",
        title: "Anna Weidner",
        collection: "authors",
        source: "imported",
        locale: "de",
      },
      {
        projectId,
        slug: "lukas-hoffmann",
        title: "Lukas Hoffmann",
        collection: "authors",
        source: "imported",
        locale: "de",
      },
      {
        projectId,
        slug: "david-krueger",
        title: "David Krüger",
        collection: "authors",
        source: "imported",
        locale: "de",
      },
    ]);

    // Seed blog posts: lukas=4, anna=3, david=1
    const blogSeeds = [
      ...Array(4).fill({ author: "lukas-hoffmann" }),
      ...Array(3).fill({ author: "anna-weidner" }),
      ...Array(1).fill({ author: "david-krueger" }),
    ];
    for (const seed of blogSeeds) {
      await db.insert(articles).values({
        projectId,
        slug: `blog-${Math.random().toString(36).slice(2)}`,
        title: "Blog Post",
        collection: "blog",
        source: "imported",
        locale: "de",
        author: seed.author,
      });
    }

    // No historic or embedding signal — brief has no clusterId or intentType
    const brief = makeBrief(projectId);
    const result = await pickAuthor(projectId, brief);

    // Should pick lukas-hoffmann (4 posts — most)
    expect(result.matchStrategy).toBe("default_fallback");
    expect(result.authorSlug).toBe("lukas-hoffmann");
    expect(result.authorName).toBe("Lukas Hoffmann");
  });

  it("throws AuthorPickerError when no imported blog authors exist for the locale", async () => {
    // Fresh project with no blog posts
    const [emptyProj] = await db
      .insert(projects)
      .values({
        slug: `test-no-authors-${Date.now()}`,
        name: "test-no-authors",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    const emptyProjectId = emptyProj!.id;

    try {
      const brief = makeBrief(emptyProjectId);
      await expect(pickAuthor(emptyProjectId, brief)).rejects.toThrow(AuthorPickerError);
    } finally {
      await db.delete(projects).where(eq(projects.id, emptyProjectId));
    }
  });

  it("throws AuthorPickerError when top historic author is not in authors collection", async () => {
    // Fresh project with blog posts but no matching authors collection entries
    const orphanProjRows = await db
      .insert(projects)
      .values({
        slug: `test-orphan-author-${Date.now()}`,
        name: "test-orphan-author",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    const orphanProjectId = orphanProjRows[0]!.id;

    try {
      // Blog posts reference 'ghost-author' but there's no authors collection entry
      for (let i = 0; i < 3; i++) {
        await db.insert(articles).values({
          projectId: orphanProjectId,
          slug: `orphan-blog-${i}`,
          title: "Orphan Post",
          collection: "blog",
          source: "imported",
          locale: "de",
          author: "ghost-author",
        });
      }

      const brief = makeBrief(orphanProjectId);
      await expect(pickAuthor(orphanProjectId, brief)).rejects.toThrow(AuthorPickerError);
    } finally {
      await db.delete(articles).where(eq(articles.projectId, orphanProjectId));
      await db.delete(projects).where(eq(projects.id, orphanProjectId));
    }
  });

  it("excludes toolwiki-prefixed authors from fallback query", async () => {
    // Fresh project with only toolwiki-prefixed and one real author
    const [twProj] = await db
      .insert(projects)
      .values({
        slug: `test-toolwiki-exclude-${Date.now()}`,
        name: "test-toolwiki-exclude",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    const twProjectId = twProj!.id;

    try {
      // Add real author to authors collection
      await db.insert(articles).values({
        projectId: twProjectId,
        slug: "sophie-renner",
        title: "Sophie Renner",
        collection: "authors",
        source: "imported",
        locale: "de",
      });

      // toolwiki-author has most posts but should be excluded
      for (let i = 0; i < 5; i++) {
        await db.insert(articles).values({
          projectId: twProjectId,
          slug: `tw-blog-${i}`,
          title: "Toolwiki Post",
          collection: "blog",
          source: "imported",
          locale: "de",
          author: "toolwiki-editorial",
        });
      }
      // sophie has fewer posts but is not excluded
      for (let i = 0; i < 2; i++) {
        await db.insert(articles).values({
          projectId: twProjectId,
          slug: `sophie-blog-${i}`,
          title: "Sophie Post",
          collection: "blog",
          source: "imported",
          locale: "de",
          author: "sophie-renner",
        });
      }

      const brief = makeBrief(twProjectId);
      const result = await pickAuthor(twProjectId, brief);

      expect(result.matchStrategy).toBe("default_fallback");
      expect(result.authorSlug).toBe("sophie-renner");
    } finally {
      await db.delete(articles).where(eq(articles.projectId, twProjectId));
      await db.delete(projects).where(eq(projects.id, twProjectId));
    }
  });
});
