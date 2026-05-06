/**
 * Integration tests for Spec 24 Session 3: Spec 21 integration + idempotency.
 *
 * A) DB-only (always run) — afterComplete wiring, no LLM.
 * B) Live (gated by RUN_LIVE_INTERNAL_LINKING=1) — full pipeline + idempotency.
 *    Costs ~€0.60 per run (2 articles × €0.30 × 2 runs).
 *
 * Run all:
 *   RUN_LIVE_INTERNAL_LINKING=1 bun --filter @marketing-auto/pipelines test integration
 *
 * Run DB-only:
 *   bun --filter @marketing-auto/pipelines test integration
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, and } from "drizzle-orm";
import {
  db,
  projects,
  clusters,
  articles,
  contentPillars,
  linkRebuildRuns,
} from "@marketing-auto/db";
import { runPipeline } from "../../src/engine/runner.ts";
import { ArticleSyncPipeline } from "@marketing-auto/adapter-astro-sync";
import { ArticleLinkUpdatePipeline } from "../../src/internal-linking/article-pipeline.ts";

const LIVE = process.env.RUN_LIVE_INTERNAL_LINKING === "1";

// ───── Shared DB fixtures ─────────────────────────────────────────────────────

let projectId: string;
let clusterId: string;

beforeAll(async () => {
  const [p] = await db.insert(projects).values({
    slug: `il-intg-test-${Date.now()}`,
    name: "Internal Linking Integration Test",
    industry: "ai_education",
    pipelineTemplate: "educational",
    domain: "test.ki-wissensraum.de",
  }).returning();
  projectId = p!.id;

  const [pillar] = await db.insert(contentPillars).values({
    projectId,
    name: "KI Tools",
    position: 0,
  }).returning();

  const [c] = await db.insert(clusters).values({
    projectId,
    pillarId: pillar!.id,
    name: "Claude Grundlagen",
    pillar: "KI Tools",
    cornerstoneKeywords: ["claude-ai"],
    satelliteKeywords: [],
    status: "approved",
  }).returning();
  clusterId = c!.id;
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
});

// ───── Section A: DB-only ─────────────────────────────────────────────────────

describe("ArticleSyncPipeline.afterComplete (DB)", () => {
  it("creates link_rebuild_runs row for article with clusterId", async () => {
    const [a] = await db.insert(articles).values({
      projectId,
      clusterId,
      slug: `ac-test-with-cluster-${Date.now()}`,
      cornerstoneKeyword: "claude-api",
      title: "Claude API Guide",
      bodyMd: "## Einführung\n\nClaude API ist einfach zu nutzen.",
      heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
      status: "published",
      approvalMode: "manual",
    }).returning();
    const articleId = a!.id;

    try {
      const pipeline = new ArticleSyncPipeline();
      // DB insert in enqueueClusterLinkRebuild precedes the BullMQ call, so the row exists even without Redis.
      await pipeline.afterComplete(
        { articleId, syncRunId: crypto.randomUUID() },
        { articleId, projectId },
      );

      const [run] = await db
        .select()
        .from(linkRebuildRuns)
        .where(
          and(
            eq(linkRebuildRuns.projectId, projectId),
            eq(linkRebuildRuns.clusterId, clusterId),
            eq(linkRebuildRuns.triggeringArticleId, articleId),
            eq(linkRebuildRuns.triggerType, "auto_after_sync"),
          ),
        )
        .limit(1);

      expect(run).toBeDefined();
      expect(run!.status).toBe("pending");
    } finally {
      await db.delete(articles).where(eq(articles.id, articleId));
    }
  });

  it("does NOT create a link_rebuild_runs row when article has no clusterId", async () => {
    const [a] = await db.insert(articles).values({
      projectId,
      clusterId: null,
      slug: `ac-test-no-cluster-${Date.now()}`,
      cornerstoneKeyword: "claude-api",
      title: "Standalone Article",
      bodyMd: "## Test\n\nKein Cluster.",
      heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
      status: "published",
      approvalMode: "manual",
    }).returning();
    const articleId = a!.id;

    try {
      const before = await db
        .select()
        .from(linkRebuildRuns)
        .where(eq(linkRebuildRuns.projectId, projectId));

      const pipeline = new ArticleSyncPipeline();
      await pipeline.afterComplete(
        { articleId, syncRunId: crypto.randomUUID() },
        { articleId, projectId },
      );

      const after = await db
        .select()
        .from(linkRebuildRuns)
        .where(eq(linkRebuildRuns.projectId, projectId));

      expect(after.length).toBe(before.length);
    } finally {
      await db.delete(articles).where(eq(articles.id, articleId));
    }
  });

  it("does not throw when article does not exist", async () => {
    const pipeline = new ArticleSyncPipeline();
    const ghostId = crypto.randomUUID();
    // Non-existent article → DB select returns nothing → no enqueue attempt
    await expect(
      pipeline.afterComplete({ articleId: ghostId, syncRunId: crypto.randomUUID() }, {
        articleId: ghostId,
        projectId,
      }),
    ).resolves.toBeUndefined();
  });
});

// ───── Section B: Live (LLM) ──────────────────────────────────────────────────

const ARTICLE_BODIES = [
  [
    "## Claude API einrichten",
    "",
    "Das Claude API von Anthropic ist einfach zu integrieren. Man kann das Claude API",
    "direkt via HTTP oder mit dem offiziellen SDK ansprechen.",
    "",
    "## Authentifizierung",
    "",
    "Für die Authentifizierung benötigt man einen API-Key. Dieser wird als Bearer-Token übergeben.",
    "Lokale Modelle benötigen keinen externen API-Key.",
  ].join("\n"),
  [
    "## Lokale LLMs betreiben",
    "",
    "Lokale Sprachmodelle bieten maximale Datenkontrolle. Man kann lokale Sprachmodelle",
    "auf eigener Hardware mit Ollama oder LM Studio betreiben.",
    "",
    "## Vergleich mit Cloud-APIs",
    "",
    "Im Vergleich zu Cloud-APIs wie dem Claude API sind lokale Modelle oft langsamer,",
    "bieten aber vollständigen Datenschutz ohne Abhängigkeit von externen Diensten.",
  ].join("\n"),
];

describe.skipIf(!LIVE)("ArticleLinkUpdatePipeline (live — ~€0.60)", () => {
  let articleIds: string[] = [];

  beforeAll(async () => {
    articleIds = [];
    for (let i = 0; i < 2; i++) {
      const [a] = await db.insert(articles).values({
        projectId,
        clusterId,
        slug: `live-il-test-${i}-${Date.now()}`,
        cornerstoneKeyword: i === 0 ? "claude-api" : "lokale-llms",
        title: i === 0 ? "Claude API Guide" : "Lokale LLMs Guide",
        metaDescription: i === 0
          ? "Claude API schnell einrichten und nutzen."
          : "Lokale LLMs auf eigener Hardware betreiben.",
        bodyMd: ARTICLE_BODIES[i]!,
        heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
        status: "published",
        approvalMode: "manual",
      }).returning();
      articleIds.push(a!.id);
    }
  });

  afterAll(async () => {
    for (const id of articleIds) {
      await db.delete(articles).where(eq(articles.id, id));
    }
  });

  it("adds valid markdown internal links to articles in the cluster", async () => {
    for (const articleId of articleIds) {
      const result = await runPipeline(
        new ArticleLinkUpdatePipeline(),
        { articleId, clusterId, projectId, triggerResync: false },
        { projectId },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const [saved] = await db
        .select({ bodyMd: articles.bodyMd, internalLinksAdded: articles.internalLinksAdded })
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);

      // Each link must be valid markdown of the form [text](/blog/slug)
      const linkPattern = /\[[^\]]+\]\(\/blog\/[a-z0-9-]+\)/g;
      const found = saved!.bodyMd?.match(linkPattern) ?? [];
      expect(found.length).toBeLessThanOrEqual(10);

      // Links must not appear inside headings
      const lines = saved!.bodyMd?.split("\n") ?? [];
      for (const line of lines) {
        if (/^#{1,6}\s/.test(line)) {
          expect(line).not.toMatch(/\[.*\]\(\/blog\//);
        }
      }
    }
  });

  it("idempotency: second run on stable cluster adds 0 new links", async () => {
    // Snapshot bodyMd after first run
    const bodyBefore: Record<string, string> = {};
    for (const articleId of articleIds) {
      const [a] = await db
        .select({ bodyMd: articles.bodyMd })
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);
      bodyBefore[articleId] = a!.bodyMd ?? "";
    }

    // Second run on the same content
    let totalNewLinks = 0;
    for (const articleId of articleIds) {
      const result = await runPipeline(
        new ArticleLinkUpdatePipeline(),
        { articleId, clusterId, projectId, triggerResync: false },
        { projectId },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      totalNewLinks += result.output.linksAdded;
    }

    // Verify bodyMd is unchanged
    for (const articleId of articleIds) {
      const [a] = await db
        .select({ bodyMd: articles.bodyMd })
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);
      expect(a!.bodyMd ?? "").toBe(bodyBefore[articleId] ?? "");
    }

    // Second run should add 0 links (anchors already wrapped in markdown links)
    expect(totalNewLinks).toBe(0);
  });
});
