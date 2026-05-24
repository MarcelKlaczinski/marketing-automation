/**
 * Spec 005 Sprint IR1.5 — Regression test against Anomaly-A
 *
 * Reproduces the exact slug-rename + cleanup-supersede + re-import scenario
 * from `docs/specs/fix-slug-rename-supersede-conflict/spec.md`. Pre-fix
 * (hard unique index): the second Re-Import would match the superseded
 * rows via onConflictDoUpdate and overwrite their filePath in-place,
 * producing the Anomaly-A state (2 superseded rows with NEW filePath,
 * 0 active rows). Post-fix (partial unique index `WHERE status !=
 * 'superseded'`): the conflict-target naturally only matches active rows,
 * so the new file lands as a fresh INSERT and the superseded rows stay
 * untouched as audit-trail tombstones.
 *
 * Run:
 *   bun --filter @marketing-auto/adapter-astro-sync test upsert-articles-regression-anomaly-a
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, articles, db, eq, inArray, projects } from "@marketing-auto/db";
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

// Slugs from the actual Anomaly-A scenario in
// docs/specs/fix-slug-rename-supersede-conflict/spec.md
const OLD_SLUG_DE = "system-prompts-role-prompting-2026-leitfaden";
const OLD_SLUG_EN = "system-prompts-role-prompting-2026-guide";
const NEW_FILE_PATH_DE =
  "src/content/blog/de/system-prompts-role-prompting-best-practices-2026.mdx";
const NEW_FILE_PATH_EN =
  "src/content/blog/en/system-prompts-role-prompting-best-practices-2026.mdx";

describe("Regression — Anomaly-A (Spec 005 IR1.5)", () => {
  let projectId: string;

  beforeEach(async () => {
    const slug = `anomaly-a-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inserted = await db
      .insert(projects)
      .values({
        slug,
        name: "Anomaly A Regression",
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

  test("Anomaly-A scenario: superseded OLD-slug rows are NOT overwritten by Re-Import with same slug + new filePath", async () => {
    // Step 1 — Pre-Setup: 2 active rows mirror the pre-Branch-B state.
    // The OLD frontmatter had `slug: ...leitfaden` / `slug: ...guide`,
    // matching the OLD filename.
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: OLD_SLUG_DE,
        filePath: `src/content/blog/de/${OLD_SLUG_DE}.mdx`,
        gitSha: "old-de-sha",
        title: "DE Original",
        bodyMd: "DE original body",
        status: "published",
      },
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "en",
        slug: OLD_SLUG_EN,
        filePath: `src/content/blog/en/${OLD_SLUG_EN}.mdx`,
        gitSha: "old-en-sha",
        title: "EN Original",
        bodyMd: "EN original body",
        status: "published",
      },
    ]);

    // Step 2 — Simulate Cleanup-Spec 001 C2: flip both rows to superseded.
    // The cleanup script only touches status + updatedAt — filePath stays.
    await db
      .update(articles)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(articles.projectId, projectId),
          inArray(articles.slug, [OLD_SLUG_DE, OLD_SLUG_EN]),
        ),
      );

    // Confirm pre-Re-Import state: 2 superseded rows with OLD slug + OLD filePath
    const preRows = await db
      .select()
      .from(articles)
      .where(eq(articles.projectId, projectId));
    expect(preRows).toHaveLength(2);
    expect(preRows.every((r) => r.status === "superseded")).toBe(true);
    expect(preRows.find((r) => r.locale === "de")!.filePath).toBe(
      `src/content/blog/de/${OLD_SLUG_DE}.mdx`,
    );

    // Step 3 — Simulate Re-Import (C4) with NEW MDX files whose
    // frontmatter `slug:` field still carries the OLD slug (the actual
    // scenario observed in Toolwiki — see docs/discovery/ir1-...-code-read.md §2).
    const step = new UpsertArticlesStep();
    const result = await step.execute(
      {
        projectId,
        parsed: [
          {
            filePath: NEW_FILE_PATH_DE,
            gitSha: "new-de-sha",
            collection: "blog",
            typed: {
              slug: OLD_SLUG_DE, // ← collides with superseded row's slug
              locale: "de",
              title: "DE Refactored",
            },
            extras: {},
            metadata: {},
            body: "DE refactored body",
          },
          {
            filePath: NEW_FILE_PATH_EN,
            gitSha: "new-en-sha",
            collection: "blog",
            typed: {
              slug: OLD_SLUG_EN, // ← collides with superseded row's slug
              locale: "en",
              title: "EN Refactored",
            },
            extras: {},
            metadata: {},
            body: "EN refactored body",
          },
        ],
      },
      stubCtx,
    );

    // Step 4 — Post-fix assertions:
    // 2 INSERTs (one per locale), 0 UPDATEs, 0 failures
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);

    const postRows = await db
      .select()
      .from(articles)
      .where(eq(articles.projectId, projectId));

    // 4 rows total: 2 superseded (UNTOUCHED) + 2 active (new)
    expect(postRows).toHaveLength(4);

    const supersededDe = postRows.find(
      (r) => r.status === "superseded" && r.locale === "de",
    );
    const supersededEn = postRows.find(
      (r) => r.status === "superseded" && r.locale === "en",
    );
    const activeDe = postRows.find(
      (r) => r.status === "published" && r.locale === "de",
    );
    const activeEn = postRows.find(
      (r) => r.status === "published" && r.locale === "en",
    );

    // Step 5 — Assert: NO in-place filePath update on superseded rows
    expect(supersededDe!.filePath).toBe(`src/content/blog/de/${OLD_SLUG_DE}.mdx`);
    expect(supersededEn!.filePath).toBe(`src/content/blog/en/${OLD_SLUG_EN}.mdx`);
    expect(supersededDe!.title).toBe("DE Original");
    expect(supersededEn!.title).toBe("EN Original");

    // Step 6 — Assert: 2 active rows exist with NEW filePath
    expect(activeDe!.filePath).toBe(NEW_FILE_PATH_DE);
    expect(activeEn!.filePath).toBe(NEW_FILE_PATH_EN);
    expect(activeDe!.title).toBe("DE Refactored");
    expect(activeEn!.title).toBe("EN Refactored");

    // Step 7 — Assert: Anomaly-A NEVER produced again — there is no row
    // where status='superseded' AND filePath matches the NEW path.
    const anomalyARows = postRows.filter(
      (r) =>
        r.status === "superseded" &&
        (r.filePath === NEW_FILE_PATH_DE || r.filePath === NEW_FILE_PATH_EN),
    );
    expect(anomalyARows).toHaveLength(0);
  });
});
