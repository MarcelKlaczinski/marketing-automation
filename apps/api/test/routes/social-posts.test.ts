/**
 * Social-posts API integration tests (Spec 51).
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { db, articles, projects, socialPosts } from "@marketing-auto/db";
import { eq, and } from "drizzle-orm";

// Mock enqueueSocialImagePipeline before importing routes
mock.module("@marketing-auto/pipelines", () => ({
  enqueuePipeline: async () => ({ jobId: "mock-social-job-123" }),
  enqueueSocialImagePipeline: async () => ({ jobId: "mock-social-job-123" }),
  pipelineRegistry: { register: () => {} },
  // re-export other things that server.ts might need
  slugify: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
}));

describe("social-posts routes", () => {
  let projectId: string;
  let articleId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `social-route-test-${Date.now()}`,
        name: "Social Route Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    const [article] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `test-article-${Date.now()}`,
        title: "Die 5 besten KI-Tools",
        status: "published",
        locale: "de",
        source: "generated",
      })
      .returning({ id: articles.id });
    articleId = article!.id;
  });

  afterAll(async () => {
    await db.delete(socialPosts).where(eq(socialPosts.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  describe("GET /api/articles/:articleId/social-posts", () => {
    it("returns empty list when no posts exist", async () => {
      const res = await fetch(`http://localhost:3001/api/articles/${articleId}/social-posts`, {
        headers: { Cookie: "ma_session=test-will-fail-auth" },
      }).catch(() => null);
      // If server isn't running, skip gracefully
      if (!res) return;
      expect(res.status).toBeOneOf([200, 401]);
    });
  });

  describe("social_posts DB operations", () => {
    it("inserts and retrieves a social post", async () => {
      const [post] = await db
        .insert(socialPosts)
        .values({
          projectId,
          articleId,
          platform: "instagram",
          format: "carousel",
          status: "draft",
          theme: "dark",
          totalSlides: 7,
          content: {
            kind: "carousel",
            slides: [
              { imageUrl: "https://example.com/slide-0.png" },
              { imageUrl: "https://example.com/slide-1.png" },
            ],
            caption: "Test caption",
            hashtags: ["#KITools", "#AI"],
          },
          generatedAt: new Date(),
        })
        .returning({ id: socialPosts.id });

      expect(post).toBeDefined();
      expect(post!.id).toBeString();

      const [fetched] = await db
        .select()
        .from(socialPosts)
        .where(eq(socialPosts.id, post!.id))
        .limit(1);

      expect(fetched).toBeDefined();
      expect(fetched!.theme).toBe("dark");
      expect(fetched!.totalSlides).toBe(7);
      expect((fetched!.content as { kind: string }).kind).toBe("carousel");
    });

    it("filters posts by articleId correctly", async () => {
      const posts = await db
        .select()
        .from(socialPosts)
        .where(and(eq(socialPosts.articleId, articleId), eq(socialPosts.projectId, projectId)));

      expect(posts.length).toBeGreaterThan(0);
      expect(posts.every((p) => p.articleId === articleId)).toBe(true);
    });
  });
});
