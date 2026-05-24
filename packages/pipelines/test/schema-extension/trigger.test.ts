/**
 * Spec 004 / F3 — trigger-layer source gate.
 *
 * `enqueueSchemaExtension` now short-circuits with `{ skipped: 'imported-article' }`
 * for rows with `source='imported'`. Generated rows still flip to
 * `schema_extending` + enqueue a BullMQ job. Wrong-status rows still throw
 * (unchanged behaviour — internal afterComplete callers rely on the throw to
 * surface programming errors).
 *
 * No Anthropic calls. Plain DB + the trigger function. The BullMQ enqueue
 * side-effect lands in Redis but tests don't assert on it — `enqueuePipeline`
 * has its own coverage and the test would otherwise need a worker tear-down.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  contentPillars,
  clusters,
  db,
  eq,
  projects,
} from "@marketing-auto/db";
import { enqueueSchemaExtension } from "../../src/schema-extension/trigger.ts";

let projectId: string;
let clusterId: string;
let pillarId: string;

beforeAll(async () => {
  const [p] = await db
    .insert(projects)
    .values({
      slug: `schema-trigger-test-${Date.now()}`,
      name: "Schema Trigger F3 Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      domain: "trigger-f3-test.example.com",
    })
    .returning();
  projectId = p!.id;

  const [pillar] = await db
    .insert(contentPillars)
    .values({ projectId, name: "F3 Pillar", position: 0 })
    .returning();
  pillarId = pillar!.id;

  const [c] = await db
    .insert(clusters)
    .values({
      projectId,
      pillarId,
      name: "F3 Cluster",
      pillar: "F3 Pillar",
      cornerstoneKeywords: ["f3-trigger-test"],
      satelliteKeywords: [],
    })
    .returning();
  clusterId = c!.id;
});

afterAll(async () => {
  // Delete in FK-dependency order: articles → clusters → contentPillars → projects.
  await db.delete(articles).where(eq(articles.projectId, projectId));
  await db.delete(clusters).where(eq(clusters.projectId, projectId));
  await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

async function makeArticle(opts: {
  source: "generated" | "imported";
  status: "proposed" | "final_review" | "schema_extending";
  slug: string;
}): Promise<string> {
  const [a] = await db
    .insert(articles)
    .values({
      projectId,
      clusterId,
      cornerstoneKeyword: "f3-trigger-test",
      slug: opts.slug,
      title: `F3 Trigger Test ${opts.slug}`,
      collection: "blog",
      locale: "de",
      source: opts.source,
      status: opts.status,
    })
    .returning({ id: articles.id });
  return a!.id;
}

describe("enqueueSchemaExtension — source gate (Spec 004 F3)", () => {
  // ── Test 1: generated + final_review → enqueued ────────────────────────
  it("enqueues for generated articles in final_review", async () => {
    const articleId = await makeArticle({
      source: "generated",
      status: "final_review",
      slug: "f3-generated-final-review",
    });

    const result = await enqueueSchemaExtension({ articleId, projectId });

    expect("jobId" in result).toBe(true);
    if ("jobId" in result) {
      expect(typeof result.jobId).toBe("string");
      expect(result.jobId.length).toBeGreaterThan(0);
    }

    // Side-effect: status flipped to schema_extending.
    const [after] = await db
      .select({ status: articles.status })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(after?.status).toBe("schema_extending");
  });

  // ── Test 2: generated + proposed → throws (wrong-status, unchanged) ────
  it("throws for generated articles in wrong status (regression guard)", async () => {
    const articleId = await makeArticle({
      source: "generated",
      status: "proposed",
      slug: "f3-generated-proposed",
    });

    await expect(
      enqueueSchemaExtension({ articleId, projectId }),
    ).rejects.toThrow(/expected "final_review" or "schema_extending"/);

    // Side-effect guarantee: status is NOT mutated by the throw path.
    const [after] = await db
      .select({ status: articles.status })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(after?.status).toBe("proposed");
  });

  // ── Test 3: imported + final_review → skipped (NEW) ────────────────────
  it("skips imported articles in final_review", async () => {
    const articleId = await makeArticle({
      source: "imported",
      status: "final_review",
      slug: "f3-imported-final-review",
    });

    const result = await enqueueSchemaExtension({ articleId, projectId });

    expect("skipped" in result).toBe(true);
    if ("skipped" in result) {
      expect(result.skipped).toBe("imported-article");
    }

    // Side-effect guarantee: status stays at final_review (no flip).
    const [after] = await db
      .select({ status: articles.status })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(after?.status).toBe("final_review");
  });

  // ── Test 4: imported + schema_extending → skipped (NEW) ────────────────
  it("skips imported articles in schema_extending (mid-flight import)", async () => {
    // This case shouldn't happen in production (imported articles never reach
    // schema_extending), but the gate must short-circuit even if it does.
    const articleId = await makeArticle({
      source: "imported",
      status: "schema_extending",
      slug: "f3-imported-extending",
    });

    const result = await enqueueSchemaExtension({ articleId, projectId });

    expect("skipped" in result).toBe(true);
    if ("skipped" in result) {
      expect(result.skipped).toBe("imported-article");
    }
  });
});
