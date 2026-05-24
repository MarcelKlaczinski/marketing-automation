/**
 * Spec 005 Sprint IR2 — MirrorBackfillHeroesStep smoke tests
 *
 * Verifies the new post-Upsert backfill step that picks up any
 * `source='imported'` rows where `hero_image_r2_key IS NULL` and
 * re-mirrors them through the same `mirrorOneArticle` helper used by
 * `MirrorHeroImagesStep` + the `backfill-imported-heroes` CLI.
 *
 * Run:
 *   bun --filter @marketing-auto/adapter-astro-sync test mirror-after-upsert
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";
import {
  MirrorBackfillHeroesStep,
  type BackfillStepDeps,
  type HeroFields,
} from "../src/import/steps/mirror-backfill-heroes.ts";

const stubCtx = {
  projectId: "",
  pipelineRunId: "00000000-0000-0000-0000-000000000000",
  stepRunId: "00000000-0000-0000-0000-000000000000",
  pipelineName: "test",
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  reportProgress: async () => {},
  getStepOutput: () => undefined,
} as never;

function makeHero(seed: string): HeroFields {
  return {
    heroImageR2Key: `toolwiki/articles/hero/${seed}.webp`,
    heroImagePublicUrl: `https://cdn.example.com/toolwiki/articles/hero/${seed}.webp`,
    heroImageOriginalR2Key: null,
    heroImageSourceSha256: `${seed.padEnd(64, "0")}`.slice(0, 64),
    heroImageAltText: `Alt ${seed}`,
  };
}

describe("MirrorBackfillHeroesStep (Spec 005 IR2)", () => {
  let projectId: string;

  beforeEach(async () => {
    const slug = `mirror-after-upsert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inserted = await db
      .insert(projects)
      .values({
        slug,
        name: "Mirror After Upsert Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        astroRepo: {
          owner: "test-owner",
          name: "test-repo",
          installationId: 1,
          defaultBranch: "main",
          contentRoot: "src/content",
          assetsRoot: "src/assets",
        },
      })
      .returning({ id: projects.id });
    projectId = inserted[0]!.id;
  });

  afterEach(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  test("new heroless INSERT + existing-with-hero row: only heroless row is mirrored", async () => {
    // Pre-Setup: 2 rows. First has hero already; second is heroless.
    const existing = makeHero("existing-already");
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "with-hero",
        filePath: "src/content/blog/de/with-hero.mdx",
        gitSha: "git-with-hero",
        title: "With Hero",
        bodyMd: "Body",
        status: "published",
        heroImageR2Key: existing.heroImageR2Key,
        heroImagePublicUrl: existing.heroImagePublicUrl,
        heroImageOriginalR2Key: existing.heroImageOriginalR2Key,
        heroImageSourceSha256: existing.heroImageSourceSha256,
        heroImageAltText: existing.heroImageAltText,
        domainExtras: { heroImage: "/heroes/with-hero.webp" },
      },
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "no-hero",
        filePath: "src/content/blog/de/no-hero.mdx",
        gitSha: "git-no-hero",
        title: "No Hero",
        bodyMd: "Body",
        status: "published",
        domainExtras: { heroImage: "/heroes/no-hero.webp" },
      },
    ]);

    const callSlugs: string[] = [];
    const deps: BackfillStepDeps = {
      mirrorOneArticleFn: async (_mirrorDeps, args) => {
        const slug = `${args.entry.typed.slug}`;
        callSlugs.push(slug);
        return { kind: "mirrored", fields: makeHero(slug) };
      },
    };

    const step = new MirrorBackfillHeroesStep(deps);
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.candidates).toBe(1);
    expect(result.mirrored).toBe(1);
    expect(callSlugs).toEqual(["no-hero"]);

    // Existing-with-hero row is untouched
    const withHeroRow = await db
      .select()
      .from(articles)
      .where(eq(articles.slug, "with-hero"))
      .limit(1);
    expect(withHeroRow[0]!.heroImageR2Key).toBe(existing.heroImageR2Key);

    // Newly-mirrored row has hero columns populated
    const noHeroRow = await db
      .select()
      .from(articles)
      .where(eq(articles.slug, "no-hero"))
      .limit(1);
    expect(noHeroRow[0]!.heroImageR2Key).toBe("toolwiki/articles/hero/no-hero.webp");
    expect(noHeroRow[0]!.heroImageAltText).toBe("Alt no-hero");
  });

  test("multiple heroless rows in eligible collections are all mirrored in one pass", async () => {
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "comparisons",
        locale: "de",
        slug: "a-vs-b",
        filePath: "src/content/comparisons/de/a-vs-b.md",
        gitSha: "git-a-vs-b",
        title: "A vs B",
        bodyMd: "Body",
        status: "published",
        domainExtras: { heroImage: "/heroes/a-vs-b.webp" },
      },
      {
        projectId,
        source: "imported",
        collection: "ki-wissen",
        locale: "de",
        slug: "what-is-rag",
        filePath: "src/content/ki-wissen/de/what-is-rag.md",
        gitSha: "git-rag",
        title: "What is RAG",
        bodyMd: "Body",
        status: "published",
        domainExtras: { heroImage: "/heroes/rag.webp" },
      },
    ]);

    const slugs: string[] = [];
    const deps: BackfillStepDeps = {
      mirrorOneArticleFn: async (_mirrorDeps, args) => {
        const slug = `${args.entry.typed.slug}`;
        slugs.push(slug);
        return { kind: "mirrored", fields: makeHero(slug) };
      },
    };

    const step = new MirrorBackfillHeroesStep(deps);
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.candidates).toBe(2);
    expect(result.mirrored).toBe(2);
    expect(slugs.sort()).toEqual(["a-vs-b", "what-is-rag"]);
  });

  test("idempotency: re-running with no heroless rows is a no-op", async () => {
    // Setup: 1 row WITH hero (so no candidates)
    const h = makeHero("already");
    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: "already-mirrored",
      filePath: "src/content/blog/de/already.mdx",
      gitSha: "git-already",
      title: "Already Mirrored",
      bodyMd: "Body",
      status: "published",
      heroImageR2Key: h.heroImageR2Key,
      heroImagePublicUrl: h.heroImagePublicUrl,
      heroImageOriginalR2Key: h.heroImageOriginalR2Key,
      heroImageSourceSha256: h.heroImageSourceSha256,
      heroImageAltText: h.heroImageAltText,
    });

    let mirrorCalls = 0;
    const deps: BackfillStepDeps = {
      mirrorOneArticleFn: async () => {
        mirrorCalls++;
        return { kind: "mirrored", fields: makeHero("never-called") };
      },
    };

    const step = new MirrorBackfillHeroesStep(deps);
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.candidates).toBe(0);
    expect(result.mirrored).toBe(0);
    expect(mirrorCalls).toBe(0);
  });

  test("Mirror failure does NOT corrupt other rows in the same pass; failure counted in stats", async () => {
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "will-fail",
        filePath: "src/content/blog/de/fail.mdx",
        gitSha: "git-fail",
        title: "Will Fail",
        bodyMd: "Body",
        status: "published",
        domainExtras: { heroImage: "/heroes/fail.webp" },
      },
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "will-succeed",
        filePath: "src/content/blog/de/succ.mdx",
        gitSha: "git-succ",
        title: "Will Succeed",
        bodyMd: "Body",
        status: "published",
        domainExtras: { heroImage: "/heroes/succ.webp" },
      },
    ]);

    const deps: BackfillStepDeps = {
      mirrorOneArticleFn: async (_mirrorDeps, args) => {
        const slug = `${args.entry.typed.slug}`;
        if (slug === "will-fail") return { kind: "failed", reason: "source_not_found" };
        return { kind: "mirrored", fields: makeHero(slug) };
      },
    };

    const step = new MirrorBackfillHeroesStep(deps);
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.candidates).toBe(2);
    expect(result.mirrored).toBe(1);
    expect(result.failed).toBe(1);

    // Failing row stays heroless (so the next Re-Import gets another shot)
    const failed = await db
      .select({ heroImageR2Key: articles.heroImageR2Key })
      .from(articles)
      .where(eq(articles.slug, "will-fail"))
      .limit(1);
    expect(failed[0]!.heroImageR2Key).toBeNull();

    // Successful row has hero populated
    const succeeded = await db
      .select({ heroImageR2Key: articles.heroImageR2Key })
      .from(articles)
      .where(eq(articles.slug, "will-succeed"))
      .limit(1);
    expect(succeeded[0]!.heroImageR2Key).toBe("toolwiki/articles/hero/will-succeed.webp");
  });
});
