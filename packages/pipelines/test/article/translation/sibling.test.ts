import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";
import { findSibling, findEnSibling } from "../../../src/article/translation/sibling.ts";

describe("findSibling (bidirectional)", () => {
  let projectId: string;
  let deArticleId: string;
  let enArticleId: string;
  const translationKey = `sibling-test-${Date.now()}`;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `sibling-test-${Date.now()}`,
        name: "Sibling Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    const [de] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `de-article-${Date.now()}`,
        title: "DE Artikel",
        status: "published",
        locale: "de",
        source: "generated",
        translationKey,
      })
      .returning({ id: articles.id });
    deArticleId = de!.id;

    const [en] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `en-article-${Date.now()}`,
        title: "EN Article",
        status: "published",
        locale: "en",
        source: "generated",
        translationKey,
      })
      .returning({ id: articles.id });
    enArticleId = en!.id;
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("DE article → finds EN sibling", async () => {
    const sibling = await findSibling({
      id: deArticleId,
      projectId,
      locale: "de",
      translationKey,
    });
    expect(sibling).not.toBeNull();
    expect(sibling!.id).toBe(enArticleId);
    expect(sibling!.locale).toBe("en");
  });

  it("EN article → finds DE sibling (bidirectional)", async () => {
    const sibling = await findSibling({
      id: enArticleId,
      projectId,
      locale: "en",
      translationKey,
    });
    expect(sibling).not.toBeNull();
    expect(sibling!.id).toBe(deArticleId);
    expect(sibling!.locale).toBe("de");
  });

  it("returns null when translationKey is null", async () => {
    const sibling = await findSibling({
      id: deArticleId,
      projectId,
      locale: "de",
      translationKey: null,
    });
    expect(sibling).toBeNull();
  });

  it("returns null when no sibling exists for the translation key", async () => {
    // A solo article with a unique translationKey — no sibling in DB
    const [solo] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `solo-de-${Date.now()}`,
        title: "Solo DE",
        status: "proposed",
        locale: "de",
        source: "generated",
        translationKey: `orphan-${Date.now()}`,
      })
      .returning({ id: articles.id, translationKey: articles.translationKey });

    const sibling = await findSibling({
      id: solo!.id,
      projectId,
      locale: "de",
      translationKey: solo!.translationKey,
    });
    expect(sibling).toBeNull();

    await db.delete(articles).where(eq(articles.id, solo!.id));
  });

  it("does not cross project boundaries (multi-tenant safety)", async () => {
    const [otherProj] = await db
      .insert(projects)
      .values({
        slug: `sibling-other-${Date.now()}`,
        name: "Other Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });

    // Another project has an EN article with the SAME translationKey
    const [decoy] = await db
      .insert(articles)
      .values({
        projectId: otherProj!.id,
        slug: `decoy-en-${Date.now()}`,
        title: "Decoy EN",
        status: "proposed",
        locale: "en",
        source: "generated",
        translationKey,
      })
      .returning({ id: articles.id });

    // findSibling on DE article must return the correct EN sibling, not the decoy
    const sibling = await findSibling({
      id: deArticleId,
      projectId,
      locale: "de",
      translationKey,
    });
    expect(sibling!.id).toBe(enArticleId);
    expect(sibling!.id).not.toBe(decoy!.id);

    await db.delete(articles).where(eq(articles.projectId, otherProj!.id));
    await db.delete(projects).where(eq(projects.id, otherProj!.id));
  });

  it("findEnSibling is an alias for findSibling", async () => {
    const via_findSibling = await findSibling({ id: deArticleId, projectId, locale: "de", translationKey });
    const via_findEnSibling = await findEnSibling({ id: deArticleId, projectId, locale: "de", translationKey });
    expect(via_findEnSibling?.id).toBe(via_findSibling?.id);
  });
});
