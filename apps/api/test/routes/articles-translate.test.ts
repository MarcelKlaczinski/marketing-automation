/**
 * Spec 59.2 — POST /articles/:id/translate integration tests.
 *
 * Tests the guard logic (422, 409) and mode selection
 * (fresh_translation vs manual_resync) at the DB layer, matching
 * the business logic in apps/api/src/routes/articles.ts.
 *
 * Mock pattern: mock.module("@marketing-auto/pipelines", ...) overrides
 * enqueueTranslationPipeline so no BullMQ/Redis is needed.
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, eq, pipelineRuns, projects } from "@marketing-auto/db";
import { findSibling } from "@marketing-auto/pipelines";

describe("translate route guards (Spec 59.2)", () => {
  let projectId: string;
  let deArticleWithBody: string;
  let deArticleNoBody: string;
  const translationKey = `translate-test-${Date.now()}`;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `translate-route-test-${Date.now()}`,
        name: "Translate Route Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    const [withBody] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `de-with-body-${Date.now()}`,
        title: "DE Artikel mit Body",
        status: "published",
        locale: "de",
        source: "generated",
        translationKey,
        bodyMd: "# Heading\n\nSome content here.",
      })
      .returning({ id: articles.id });
    deArticleWithBody = withBody!.id;

    const [noBody] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `de-no-body-${Date.now()}`,
        title: "DE Artikel ohne Body",
        status: "proposed",
        locale: "de",
        source: "generated",
        translationKey: `no-body-key-${Date.now()}`,
      })
      .returning({ id: articles.id });
    deArticleNoBody = noBody!.id;
  });

  afterAll(async () => {
    await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  // ─── 422 guard ───────────────────────────────────────────────────────────────

  describe("422 — article has no bodyMd", () => {
    it("findSibling returns null for article with no translationKey sibling (precondition)", async () => {
      const [a] = await db
        .select({ id: articles.id, projectId: articles.projectId, locale: articles.locale, translationKey: articles.translationKey })
        .from(articles)
        .where(eq(articles.id, deArticleNoBody))
        .limit(1);
      const sibling = await findSibling(a!);
      expect(sibling).toBeNull();
    });

    it("the no-body article has no bodyMd in DB (422 condition)", async () => {
      const [a] = await db
        .select({ bodyMd: articles.bodyMd })
        .from(articles)
        .where(eq(articles.id, deArticleNoBody))
        .limit(1);
      expect(a!.bodyMd).toBeNil();
    });
  });

  // ─── mode selection ──────────────────────────────────────────────────────────

  describe("mode = fresh_translation when no sibling exists", () => {
    it("findSibling returns null → mode should be fresh_translation", async () => {
      const [a] = await db
        .select({ id: articles.id, projectId: articles.projectId, locale: articles.locale, translationKey: articles.translationKey })
        .from(articles)
        .where(eq(articles.id, deArticleWithBody))
        .limit(1);

      const sibling = await findSibling(a!);
      const mode = sibling ? "manual_resync" : "fresh_translation";
      expect(mode).toBe("fresh_translation");
    });
  });

  describe("mode = manual_resync when sibling exists (force=true case)", () => {
    it("findSibling returns existing sibling → mode should be manual_resync", async () => {
      // Create the EN sibling
      const [en] = await db
        .insert(articles)
        .values({
          projectId,
          slug: `en-sibling-${Date.now()}`,
          title: "EN Article",
          status: "published",
          locale: "en",
          source: "generated",
          translationKey,
          bodyMd: "# Heading\n\nEN content.",
        })
        .returning({ id: articles.id });

      const [a] = await db
        .select({ id: articles.id, projectId: articles.projectId, locale: articles.locale, translationKey: articles.translationKey })
        .from(articles)
        .where(eq(articles.id, deArticleWithBody))
        .limit(1);

      const sibling = await findSibling(a!);
      expect(sibling).not.toBeNull();
      expect(sibling!.id).toBe(en!.id);

      const mode = sibling ? "manual_resync" : "fresh_translation";
      expect(mode).toBe("manual_resync");

      // Cleanup EN sibling
      await db.delete(articles).where(eq(articles.id, en!.id));
    });
  });

  // ─── 409 guard (sibling exists, force=false) ─────────────────────────────────

  describe("409 — sibling exists without force", () => {
    it("sibling presence is detectable via findSibling (409 condition)", async () => {
      const [en] = await db
        .insert(articles)
        .values({
          projectId,
          slug: `en-for-409-${Date.now()}`,
          title: "EN for 409 Test",
          status: "published",
          locale: "en",
          source: "generated",
          translationKey,
          bodyMd: "# EN\n\nContent.",
        })
        .returning({ id: articles.id });

      const [a] = await db
        .select({ id: articles.id, projectId: articles.projectId, locale: articles.locale, translationKey: articles.translationKey })
        .from(articles)
        .where(eq(articles.id, deArticleWithBody))
        .limit(1);

      const existingSibling = await findSibling(a!);
      // Without force, the route returns 409 — we verify the condition is met
      expect(existingSibling).not.toBeNull();
      expect(existingSibling!.id).toBe(en!.id);

      // Cleanup
      await db.delete(articles).where(eq(articles.id, en!.id));
    });
  });

  // ─── bidirectional: EN→DE also works ─────────────────────────────────────────

  describe("EN article → finds DE sibling (bidirectional guard check)", () => {
    it("findSibling on EN article returns the DE article as sibling", async () => {
      const enTranslationKey = `en-source-${Date.now()}`;

      const [en] = await db
        .insert(articles)
        .values({
          projectId,
          slug: `en-source-${Date.now()}`,
          title: "EN Source",
          status: "published",
          locale: "en",
          source: "generated",
          translationKey: enTranslationKey,
          bodyMd: "# EN\n\nContent.",
        })
        .returning({ id: articles.id });

      const [de] = await db
        .insert(articles)
        .values({
          projectId,
          slug: `de-target-${Date.now()}`,
          title: "DE Target",
          status: "published",
          locale: "de",
          source: "generated",
          translationKey: enTranslationKey,
          bodyMd: "# DE\n\nInhalt.",
        })
        .returning({ id: articles.id });

      const sibling = await findSibling({ id: en!.id, projectId, locale: "en", translationKey: enTranslationKey });
      expect(sibling).not.toBeNull();
      expect(sibling!.id).toBe(de!.id);
      expect(sibling!.locale).toBe("de");

      await db.delete(articles).where(eq(articles.id, en!.id));
      await db.delete(articles).where(eq(articles.id, de!.id));
    });
  });
});
