/**
 * Spec 005 Sprint IR2.5 — Regression test against Anomaly-B
 *
 * Reproduces the durability gap exposed during the Spec 001 / C4 Re-Import:
 * when `MirrorHeroImagesStep` fails for a new INSERT (e.g. 404 on the
 * default-hero path), the article is INSERTed without hero columns and
 * subsequent Re-Imports skip the row via gitSha-equality, leaving the
 * gap permanent until the operator runs `backfill-imported-heroes --apply`.
 *
 * Post-fix (Option B): a new `MirrorBackfillHeroesStep` runs AFTER
 * `UpsertArticlesStep` in the pipeline. It loads heroless rows and
 * re-mirrors them through `mirrorOneArticle`. The first Re-Import that
 * INSERTs new rows AND successfully mirrors them in the same run produces
 * articles with hero columns populated — no second Re-Import needed.
 *
 * The test exercises the new step in isolation with DI-injected
 * `mirrorOneArticle` and DB ports, so it stays offline (no GitHub-App,
 * no R2). It seeds a project + heroless articles + asserts the step
 * UPDATEs the hero columns.
 *
 * Run:
 *   bun --filter @marketing-auto/adapter-astro-sync test mirror-after-upsert-regression-anomaly-b
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";
import {
  COLLECTIONS_WITHOUT_HERO,
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
    heroImageOriginalR2Key: `toolwiki/articles/hero/originals/${seed}.png`,
    heroImageSourceSha256: `${seed.padEnd(64, "0")}`.slice(0, 64),
    heroImageAltText: `Alt for ${seed}`,
  };
}

describe("Regression — Anomaly-B (Spec 005 IR2.5)", () => {
  let projectId: string;

  beforeEach(async () => {
    const slug = `anomaly-b-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inserted = await db
      .insert(projects)
      .values({
        slug,
        name: "Anomaly B Regression",
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

  test("Anomaly-B scenario: 18 inserts with Mirror failure on first pass → backfill heals 14+2 in same run, 2 tool-categories untouched", async () => {
    // Step 1 — Simulate the post-UpsertArticlesStep state from a Re-Import where
    // Mirror failed for every entry (e.g. default-hero-path bug). All 18 rows
    // are INSERTed without hero columns. 16 are in collections that SHOULD
    // have heroes; 2 are tool-categories (in COLLECTIONS_WITHOUT_HERO).
    const seedRows = [
      // 4 Comparisons (Branch-A migrations)
      ...Array.from({ length: 4 }, (_, i) => ({
        slug: `comparison-${i + 1}`,
        collection: "comparisons" as const,
      })),
      // 12 ki-wissen articles (Branch-A pillar additions)
      ...Array.from({ length: 12 }, (_, i) => ({
        slug: `ki-wissen-${i + 1}`,
        collection: "ki-wissen" as const,
      })),
      // 2 tool-categories — must NOT be touched (no hero by design)
      ...Array.from({ length: 2 }, (_, i) => ({
        slug: `tool-cat-${i + 1}`,
        collection: "tool-categories" as const,
      })),
    ];

    for (const r of seedRows) {
      await db.insert(articles).values({
        projectId,
        source: "imported",
        collection: r.collection,
        locale: "de",
        slug: r.slug,
        filePath: `src/content/${r.collection}/de/${r.slug}.md`,
        gitSha: `git-${r.slug}`,
        title: `Title ${r.slug}`,
        bodyMd: `Body ${r.slug}`,
        status: "published",
        domainExtras: { heroImage: `/heroes/${r.slug}.webp` },
        // heroImageR2Key explicitly NULL (column default) — first-pass mirror failed
      });
    }

    // Confirm pre-backfill state: 18 rows, all heroless
    const pre = await db
      .select({ id: articles.id, slug: articles.slug, collection: articles.collection })
      .from(articles)
      .where(eq(articles.projectId, projectId));
    expect(pre).toHaveLength(18);

    // Step 2 — Inject DI deps that simulate successful mirroring for every
    // non-skipped collection. Counter tracks how many candidates got processed.
    const callsBySlug = new Map<string, HeroFields>();
    const deps: BackfillStepDeps = {
      mirrorOneArticleFn: async (_mirrorDeps, args) => {
        const seed = `${args.entry.typed.slug}`;
        const fields = makeHero(seed);
        callsBySlug.set(seed, fields);
        return { kind: "mirrored", fields };
      },
    };

    // Step 3 — Run the backfill step
    const step = new MirrorBackfillHeroesStep(deps);
    const result = await step.execute({ projectId }, stubCtx);

    // Step 4 — Assertions
    expect(result.candidates).toBe(16); // 4 + 12 = 16 (tool-categories excluded by SELECT)
    expect(result.mirrored).toBe(16);
    expect(result.reused).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skippedByCollection).toBe(0);

    // 14 + 2 spec-call-out (4 comparisons + 12 ki-wissen) — all 16 should be mirrored
    expect(callsBySlug.size).toBe(16);

    // Hero columns populated for comparisons + ki-wissen
    const post = await db
      .select({
        slug: articles.slug,
        collection: articles.collection,
        heroImageR2Key: articles.heroImageR2Key,
        heroImageSourceSha256: articles.heroImageSourceSha256,
        heroImageAltText: articles.heroImageAltText,
      })
      .from(articles)
      .where(eq(articles.projectId, projectId));

    const mirrored = post.filter((r) => r.heroImageR2Key !== null);
    const skipped = post.filter((r) => r.heroImageR2Key === null);

    expect(mirrored).toHaveLength(16);
    expect(mirrored.every((r) => r.collection !== "tool-categories")).toBe(true);
    expect(mirrored.every((r) => r.heroImageSourceSha256 !== null)).toBe(true);

    expect(skipped).toHaveLength(2);
    expect(skipped.every((r) => r.collection === "tool-categories")).toBe(true);

    // Step 5 — Idempotency: a second backfill pass finds 0 candidates (all
    // 16 rows now have heroImageR2Key set, tool-categories excluded by SELECT).
    callsBySlug.clear();
    const second = await step.execute({ projectId }, stubCtx);
    expect(second.candidates).toBe(0);
    expect(second.mirrored).toBe(0);
    expect(callsBySlug.size).toBe(0);

    // Step 6 — Confirm tool-categories rows are STILL heroless after the second pass.
    // The new step never touches them because the SELECT excludes COLLECTIONS_WITHOUT_HERO.
    expect(COLLECTIONS_WITHOUT_HERO.has("tool-categories")).toBe(true);
    const finalSkipped = await db
      .select({ slug: articles.slug, heroImageR2Key: articles.heroImageR2Key })
      .from(articles)
      .where(eq(articles.projectId, projectId));
    expect(finalSkipped.filter((r) => r.heroImageR2Key === null)).toHaveLength(2);
  });
});
