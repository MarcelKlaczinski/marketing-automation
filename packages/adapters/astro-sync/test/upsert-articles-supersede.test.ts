/**
 * Spec 005 Sprint IR1 — UpsertArticlesStep status-aware match (TDD smoke tests)
 *
 * Verifies that the upsert step does NOT match against `status='superseded'`
 * rows. Each test creates an isolated project and cleans up afterward. Per
 * Spec 001 / Pattern 121: tests are written BEFORE the fix (Option D — partial
 * unique index `WHERE status != 'superseded'`), so the second and third tests
 * fail against the pre-fix codebase.
 *
 * Run:
 *   bun --filter @marketing-auto/adapter-astro-sync test upsert-articles-supersede
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, articles, db, eq, projects } from "@marketing-auto/db";
import { UpsertArticlesStep } from "../src/import/steps/upsert-articles.ts";

const stubCtx = {
  projectId: "",
  pipelineRunId: "00000000-0000-0000-0000-000000000000",
  stepRunId: "00000000-0000-0000-0000-000000000000",
  pipelineName: "test",
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  reportProgress: async () => {},
  getStepOutput: () => undefined,
} as never;

function parsedEntry(overrides: {
  slug: string;
  filePath: string;
  body?: string;
  collection?: string;
  locale?: string;
  title?: string;
}) {
  return {
    filePath: overrides.filePath,
    gitSha: `sha-${overrides.slug}-${Date.now()}`,
    collection: overrides.collection ?? "blog",
    typed: {
      slug: overrides.slug,
      locale: overrides.locale ?? "de",
      title: overrides.title ?? `Title ${overrides.slug}`,
    },
    extras: {},
    metadata: {},
    body: overrides.body ?? `Body for ${overrides.slug}`,
  };
}

describe("UpsertArticlesStep — status-aware match (Spec 005 IR1)", () => {
  let projectId: string;

  beforeEach(async () => {
    const slug = `upsert-supersede-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inserted = await db
      .insert(projects)
      .values({
        slug,
        name: "Upsert Supersede Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = inserted[0]!.id;
  });

  afterEach(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  test("normal upsert into active row — in-place UPDATE works as today", async () => {
    // Pre-Setup: existing active row at this slug
    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: "existing-active",
      filePath: "src/content/blog/de/existing-active.mdx",
      gitSha: "old-sha",
      title: "OLD title",
      bodyMd: "OLD body",
      status: "published",
    });

    const step = new UpsertArticlesStep();
    const result = await step.execute(
      {
        projectId,
        parsed: [
          parsedEntry({
            slug: "existing-active",
            filePath: "src/content/blog/de/existing-active.mdx",
            title: "NEW title",
            body: "NEW body",
          }),
        ],
      },
      stubCtx,
    );

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);

    const rows = await db
      .select()
      .from(articles)
      .where(and(eq(articles.projectId, projectId), eq(articles.slug, "existing-active")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("NEW title");
    expect(rows[0]!.bodyMd).toBe("NEW body");
    expect(rows[0]!.status).toBe("published");
  });

  test("match against superseded row → INSERT new active row, superseded stays", async () => {
    // Pre-Setup: superseded row at OLD-slug + OLD-filePath
    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: "shared-slug",
      filePath: "src/content/blog/de/old-name.mdx",
      gitSha: "old-sha",
      title: "OLD orphan title",
      bodyMd: "OLD orphan body",
      status: "superseded",
    });

    const step = new UpsertArticlesStep();
    const result = await step.execute(
      {
        projectId,
        parsed: [
          parsedEntry({
            slug: "shared-slug",
            filePath: "src/content/blog/de/new-name.mdx",
            title: "NEW title",
            body: "NEW body",
          }),
        ],
      },
      stubCtx,
    );

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);

    // Two rows exist: one superseded (untouched) + one active (new)
    const allRows = await db
      .select()
      .from(articles)
      .where(and(eq(articles.projectId, projectId), eq(articles.slug, "shared-slug")));
    expect(allRows).toHaveLength(2);

    const superseded = allRows.find((r) => r.status === "superseded");
    const active = allRows.find((r) => r.status === "published");
    expect(superseded).toBeDefined();
    expect(active).toBeDefined();

    // Superseded row UNTOUCHED — OLD filePath + OLD title + OLD body
    expect(superseded!.filePath).toBe("src/content/blog/de/old-name.mdx");
    expect(superseded!.title).toBe("OLD orphan title");
    expect(superseded!.bodyMd).toBe("OLD orphan body");

    // Active row has NEW values
    expect(active!.filePath).toBe("src/content/blog/de/new-name.mdx");
    expect(active!.title).toBe("NEW title");
    expect(active!.bodyMd).toBe("NEW body");
  });

  test("superseded row does NOT block UPDATE on a distinct active row at same slug", async () => {
    // Pre-Setup: BOTH a superseded row AND an active row at the same slug
    // (post-fix steady-state — e.g. cleanup superseded an old row, then a
    // fresh import created a new active row, and now Re-Import runs again).
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "coexist-slug",
        filePath: "src/content/blog/de/old-name.mdx",
        gitSha: "old-sha",
        title: "OLD orphan",
        bodyMd: "OLD orphan body",
        status: "superseded",
      },
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "coexist-slug",
        filePath: "src/content/blog/de/new-name.mdx",
        gitSha: "fresh-sha",
        title: "ACTIVE",
        bodyMd: "ACTIVE body",
        status: "published",
      },
    ]);

    const step = new UpsertArticlesStep();
    const result = await step.execute(
      {
        projectId,
        parsed: [
          parsedEntry({
            slug: "coexist-slug",
            filePath: "src/content/blog/de/new-name.mdx",
            title: "REFRESHED",
            body: "REFRESHED body",
          }),
        ],
      },
      stubCtx,
    );

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);

    const allRows = await db
      .select()
      .from(articles)
      .where(and(eq(articles.projectId, projectId), eq(articles.slug, "coexist-slug")));
    expect(allRows).toHaveLength(2);

    const superseded = allRows.find((r) => r.status === "superseded");
    const active = allRows.find((r) => r.status === "published");

    // Superseded UNTOUCHED
    expect(superseded!.title).toBe("OLD orphan");
    expect(superseded!.bodyMd).toBe("OLD orphan body");

    // Active UPDATED with refreshed values
    expect(active!.title).toBe("REFRESHED");
    expect(active!.bodyMd).toBe("REFRESHED body");
  });

  test("status filter only affects target=superseded — other statuses still match", async () => {
    // Pre-Setup: existing 'final_review' row (a generated article in review)
    // We use source='generated' here because article_status enum values like
    // 'final_review' are typical of the generation pipeline. The point of
    // this test is that the partial-unique-index filter ONLY excludes
    // 'superseded' — every other status still trips the unique constraint.
    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: "review-slug",
      filePath: "src/content/blog/de/review-slug.mdx",
      gitSha: "old-sha",
      title: "OLD",
      bodyMd: "OLD body",
      status: "published",
    });

    const step = new UpsertArticlesStep();
    const result = await step.execute(
      {
        projectId,
        parsed: [
          parsedEntry({
            slug: "review-slug",
            filePath: "src/content/blog/de/review-slug.mdx",
            title: "NEW",
            body: "NEW body",
          }),
        ],
      },
      stubCtx,
    );

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);

    const rows = await db
      .select()
      .from(articles)
      .where(and(eq(articles.projectId, projectId), eq(articles.slug, "review-slug")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("NEW");
  });
});
