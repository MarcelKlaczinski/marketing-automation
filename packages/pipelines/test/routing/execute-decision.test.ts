import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  clusters,
  contentPillars,
  cornerstoneSpecs,
  db,
  projects,
  topicBriefs,
  type TopicBrief,
} from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { executeDecision } from "../../src/routing/execute-decision.ts";
import { RoutingNotImplementedError } from "../../src/routing/types.ts";
import type { RoutingDecision } from "../../src/routing/types.ts";

describe("executeDecision", () => {
  let projectId: string;
  let clusterId: string;
  let briefId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `routing-exec-test-${Date.now()}`,
        name: "Routing Exec Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;

    const [pillar] = await db
      .insert(contentPillars)
      .values({ projectId, name: "AI Tools", position: 0 })
      .returning();

    const [c] = await db
      .insert(clusters)
      .values({
        projectId,
        pillarId: pillar!.id,
        name: "Cluster A",
        pillar: "AI Tools",
        cornerstoneKeywords: ["test-keyword"],
        satelliteKeywords: [],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;

    const [b] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        source: "gap_analysis",
        topicTitle: "Test brief",
        primaryKeyword: "test keyword",
        secondaryKeywords: [],
        locale: "de",
        clusterId,
        clusterAction: "append_to_existing",
        approvalRequired: true,
        approvalStatus: "pending",
        suggestedTitle: "Test Article Title",
        suggestedSlug: "test-article-slug",
        suggestedMeta: "A short meta description",
        gapMetadata: { gapType: "missing_spoke_type", priority: 2 },
      })
      .returning();
    briefId = b!.id;
  });

  afterAll(async () => {
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(cornerstoneSpecs).where(eq(cornerstoneSpecs.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  async function freshBrief(): Promise<TopicBrief> {
    const [b] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, briefId))
      .limit(1);
    return b!;
  }

  async function resetBrief(): Promise<void> {
    await db
      .update(topicBriefs)
      .set({
        approvalStatus: "pending",
        approvedAt: null,
        routedArticleId: null,
        routedCornerstoneSpecId: null,
        updatedAt: new Date(),
      })
      .where(eq(topicBriefs.id, briefId));
    // Remove any articles/specs created in previous test
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(cornerstoneSpecs).where(eq(cornerstoneSpecs.projectId, projectId));
  }

  describe("create_article", () => {
    it("inserts article and marks brief as routed", async () => {
      await resetBrief();
      const brief = await freshBrief();
      const decision: RoutingDecision = {
        kind: "create_article",
        clusterId,
        intentType: "how_to",
        mode: "spoke",
      };

      const result = await db.transaction(async (tx) =>
        executeDecision(decision, brief, tx),
      );

      expect(result.kind).toBe("article_created");
      if (result.kind !== "article_created") return;
      expect(result.briefId).toBe(briefId);

      // Verify article was inserted
      const [savedArticle] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, result.articleId))
        .limit(1);
      expect(savedArticle).toBeTruthy();
      expect(savedArticle!.projectId).toBe(projectId);
      expect(savedArticle!.clusterId).toBe(clusterId);
      expect(savedArticle!.intentType).toBe("how_to");
      expect(savedArticle!.status).toBe("proposed");
      expect(savedArticle!.source).toBe("generated");

      // Verify brief was marked routed with article link
      const [updatedBrief] = await db
        .select()
        .from(topicBriefs)
        .where(eq(topicBriefs.id, briefId))
        .limit(1);
      expect(updatedBrief!.approvalStatus).toBe("routed");
      expect(updatedBrief!.routedArticleId).toBe(result.articleId);
      expect(updatedBrief!.routedCornerstoneSpecId).toBeNull();
    });
  });

  describe("create_cornerstone_spec", () => {
    it("inserts spec and marks brief as routed", async () => {
      await resetBrief();
      const brief = await freshBrief();
      const decision: RoutingDecision = {
        kind: "create_cornerstone_spec",
        clusterId,
        mode: "pillar",
      };

      const result = await db.transaction(async (tx) =>
        executeDecision(decision, brief, tx),
      );

      expect(result.kind).toBe("cornerstone_spec_created");
      if (result.kind !== "cornerstone_spec_created") return;
      expect(result.briefId).toBe(briefId);

      // Verify spec was inserted
      const [savedSpec] = await db
        .select()
        .from(cornerstoneSpecs)
        .where(eq(cornerstoneSpecs.id, result.cornerstoneSpecId))
        .limit(1);
      expect(savedSpec).toBeTruthy();
      expect(savedSpec!.projectId).toBe(projectId);
      expect(savedSpec!.clusterId).toBe(clusterId);
      expect(savedSpec!.status).toBe("proposed");

      // Verify brief was marked routed with spec link
      const [updatedBrief] = await db
        .select()
        .from(topicBriefs)
        .where(eq(topicBriefs.id, briefId))
        .limit(1);
      expect(updatedBrief!.approvalStatus).toBe("routed");
      expect(updatedBrief!.routedCornerstoneSpecId).toBe(result.cornerstoneSpecId);
      expect(updatedBrief!.routedArticleId).toBeNull();
    });
  });

  describe("create_translation", () => {
    it("returns skipped when source article not found", async () => {
      await resetBrief();
      const brief = await freshBrief();
      const decision: RoutingDecision = {
        kind: "create_translation",
        sourceTranslationKey: "nonexistent-translation-key",
        targetLocale: "de",
        clusterId,
      };

      const result = await db.transaction(async (tx) =>
        executeDecision(decision, brief, tx),
      );

      expect(result.kind).toBe("skipped");

      // Brief should be superseded (not routed)
      const [updatedBrief] = await db
        .select()
        .from(topicBriefs)
        .where(eq(topicBriefs.id, briefId))
        .limit(1);
      expect(updatedBrief!.approvalStatus).toBe("superseded");
    });

    it("creates translation article when source exists", async () => {
      await resetBrief();

      // Insert a source EN article
      const translationKey = `trans-key-${Date.now()}`;
      const [sourceArticle] = await db
        .insert(articles)
        .values({
          projectId,
          clusterId,
          slug: `source-en-article-${Date.now()}`,
          locale: "en",
          translationKey,
          source: "generated",
          collection: "blog",
          clusterRole: "spoke",
          status: "proposed",
          approvalMode: "manual",
          intentType: "how_to",
        })
        .returning();

      const brief = await freshBrief();
      const decision: RoutingDecision = {
        kind: "create_translation",
        sourceTranslationKey: translationKey,
        targetLocale: "de",
        clusterId,
      };

      const result = await db.transaction(async (tx) =>
        executeDecision(decision, brief, tx),
      );

      expect(result.kind).toBe("translation_created");
      if (result.kind !== "translation_created") return;

      const [savedTranslation] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, result.articleId))
        .limit(1);
      expect(savedTranslation!.locale).toBe("de");
      expect(savedTranslation!.translationKey).toBe(translationKey);
      expect(savedTranslation!.intentType).toBe(sourceArticle!.intentType);

      // Cleanup source article
      await db.delete(articles).where(eq(articles.id, sourceArticle!.id));
    });
  });

  describe("skip", () => {
    it("marks brief as superseded and returns skipped result", async () => {
      await resetBrief();
      const brief = await freshBrief();
      const decision: RoutingDecision = {
        kind: "skip",
        reason: "test skip reason",
      };

      const result = await db.transaction(async (tx) =>
        executeDecision(decision, brief, tx),
      );

      expect(result.kind).toBe("skipped");
      if (result.kind !== "skipped") return;
      expect(result.reason).toBe("test skip reason");

      const [updatedBrief] = await db
        .select()
        .from(topicBriefs)
        .where(eq(topicBriefs.id, briefId))
        .limit(1);
      expect(updatedBrief!.approvalStatus).toBe("superseded");
    });
  });

  describe("unimplemented decision kinds", () => {
    it("throws RoutingNotImplementedError for create_cluster", async () => {
      await resetBrief();
      const brief = await freshBrief();
      const decision: RoutingDecision = {
        kind: "create_cluster",
        pillarHint: null,
      };

      await expect(
        db.transaction(async (tx) => executeDecision(decision, brief, tx)),
      ).rejects.toBeInstanceOf(RoutingNotImplementedError);
    });

    it("throws RoutingNotImplementedError for refresh_article", async () => {
      await resetBrief();
      const brief = await freshBrief();
      const decision: RoutingDecision = {
        kind: "refresh_article",
        targetArticleId: crypto.randomUUID(),
      };

      await expect(
        db.transaction(async (tx) => executeDecision(decision, brief, tx)),
      ).rejects.toBeInstanceOf(RoutingNotImplementedError);
    });
  });

  describe("transaction atomicity", () => {
    it("rolls back article insert when transaction is aborted", async () => {
      await resetBrief();
      const brief = await freshBrief();
      const decision: RoutingDecision = {
        kind: "create_article",
        clusterId,
        intentType: "how_to",
        mode: "spoke",
      };

      let insertedArticleId: string | undefined;

      await expect(
        db.transaction(async (tx) => {
          const result = await executeDecision(decision, brief, tx);
          if (result.kind === "article_created") {
            insertedArticleId = result.articleId;
          }
          throw new Error("forced rollback");
        }),
      ).rejects.toThrow("forced rollback");

      // Article should not exist after rollback
      if (insertedArticleId) {
        const [check] = await db
          .select({ id: articles.id })
          .from(articles)
          .where(eq(articles.id, insertedArticleId))
          .limit(1);
        expect(check).toBeUndefined();
      }

      // Brief should still be pending (not routed)
      const [briefAfter] = await db
        .select()
        .from(topicBriefs)
        .where(eq(topicBriefs.id, briefId))
        .limit(1);
      expect(briefAfter!.approvalStatus).toBe("pending");
    });
  });
});
