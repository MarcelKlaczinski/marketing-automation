/**
 * Integration tests for the Schema Extension Pipeline (Spec 23).
 *
 * Split into two sections:
 *
 * A) DB-only tests (always run) — LoadArticleStep, PersistSchemaStep, graceful degradation.
 *    No Anthropic calls. Costs nothing.
 *
 * B) Live tests (gated by RUN_LIVE_SCHEMA_EXTENSION=1) — full pipeline with LLM detection.
 *    Costs ~€0.05 per run.
 *
 * Run all:
 *   RUN_LIVE_SCHEMA_EXTENSION=1 bun --filter @marketing-auto/pipelines test schema-extension
 *
 * Run DB-only:
 *   bun --filter @marketing-auto/pipelines test schema-extension
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  clusters,
  contentPillars,
  db,
  projects,
  schemaExtensionRuns,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { runPipeline } from "../../src/engine/runner.ts";
import type { StepContext } from "../../src/engine/step.ts";
import { SchemaExtensionPipeline } from "../../src/schema-extension/pipeline.ts";
import { LoadArticleStep } from "../../src/schema-extension/steps/load-article.ts";
import { PersistSchemaStep } from "../../src/schema-extension/steps/persist-schema.ts";
import { SchemaExtensionError } from "../../src/schema-extension/types.ts";

const LIVE = process.env.RUN_LIVE_SCHEMA_EXTENSION === "1";

const mockCtx = (projectId: string): StepContext => ({
  projectId,
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  llmMode: "sync",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

// ───── Shared DB fixtures ─────────────────────────────────────────────────────

let projectId: string;
let clusterId: string;

const EXISTING_ARTICLE_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Was ist Claude AI? Der vollständige Leitfaden",
};

beforeAll(async () => {
  const [p] = await db
    .insert(projects)
    .values({
      slug: `schema-ext-test-${Date.now()}`,
      name: "Schema Extension Test Project",
      industry: "ai_education",
      pipelineTemplate: "educational",
      domain: "ki-wissensraum.de",
    })
    .returning();
  projectId = p!.id;

  const [pillar] = await db
    .insert(contentPillars)
    .values({
      projectId,
      name: "AI Tools",
      position: 0,
    })
    .returning();

  const [c] = await db
    .insert(clusters)
    .values({
      projectId,
      pillarId: pillar!.id,
      name: "Claude AI",
      pillar: "AI Tools",
      cornerstoneKeywords: ["claude-ai"],
      satelliteKeywords: [],
      status: "approved",
    })
    .returning();
  clusterId = c!.id;
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
});

// ───── Section A: DB-only tests ───────────────────────────────────────────────

describe("LoadArticleStep (DB)", () => {
  it("loads article, project, and cluster successfully", async () => {
    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `load-test-${Date.now()}`,
        cornerstoneKeyword: "claude-ai",
        title: "Was ist Claude AI?",
        metaDescription: "Claude AI erklärt.",
        bodyMd: "# Claude AI\n\nClaude ist ein KI-Assistent von Anthropic.",
        heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
        schemaJsonLd: [EXISTING_ARTICLE_SCHEMA],
        status: "schema_extending",
        approvalMode: "manual",
      })
      .returning();
    const articleId = a!.id;

    try {
      const step = new LoadArticleStep();
      const out = await step.execute({ articleId }, mockCtx(projectId));

      expect(out.article.id).toBe(articleId);
      expect(out.article.title).toBe("Was ist Claude AI?");
      expect(out.article.bodyMd).toContain("Claude");
      expect(out.article.schemaJsonLd).toHaveLength(1);
      expect(out.article.schemaJsonLd[0]!["@type"]).toBe("Article");
      expect(out.project.slug).toContain("schema-ext-test");
      expect(out.project.domain).toBe("ki-wissensraum.de");
      expect(out.cluster?.name).toBe("Claude AI");
    } finally {
      await db.delete(articles).where(eq(articles.id, articleId));
    }
  });

  it("loads without cluster when article has no clusterId", async () => {
    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId: null,
        slug: `load-nocluster-${Date.now()}`,
        cornerstoneKeyword: "claude-ai",
        title: "Claude ohne Cluster",
        bodyMd: "Kein Cluster.",
        heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
        schemaJsonLd: [],
        status: "schema_extending",
        approvalMode: "manual",
      })
      .returning();
    const articleId = a!.id;

    try {
      const step = new LoadArticleStep();
      const out = await step.execute({ articleId }, mockCtx(projectId));
      expect(out.cluster).toBeNull();
    } finally {
      await db.delete(articles).where(eq(articles.id, articleId));
    }
  });

  it("throws SchemaExtensionError when article is in wrong status", async () => {
    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `load-wrong-status-${Date.now()}`,
        cornerstoneKeyword: "claude-ai",
        status: "generating",
        approvalMode: "manual",
      })
      .returning();
    const articleId = a!.id;

    try {
      const step = new LoadArticleStep();
      await expect(step.execute({ articleId }, mockCtx(projectId))).rejects.toThrow(
        SchemaExtensionError
      );
    } finally {
      await db.delete(articles).where(eq(articles.id, articleId));
    }
  });

  it("accepts article in final_review status (manual re-run path)", async () => {
    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `load-final-review-${Date.now()}`,
        cornerstoneKeyword: "claude-ai",
        title: "Final Review Article",
        bodyMd: "Body.",
        heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
        schemaJsonLd: [],
        status: "final_review",
        approvalMode: "manual",
      })
      .returning();
    const articleId = a!.id;

    try {
      const step = new LoadArticleStep();
      const out = await step.execute({ articleId }, mockCtx(projectId));
      expect(out.article.id).toBe(articleId);
    } finally {
      await db.delete(articles).where(eq(articles.id, articleId));
    }
  });
});

describe("PersistSchemaStep (DB)", () => {
  it("updates article schemaJsonLd and status, inserts schema_extension_runs row", async () => {
    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `persist-test-${Date.now()}`,
        cornerstoneKeyword: "claude-ai",
        status: "schema_extending",
        approvalMode: "manual",
      })
      .returning();
    const articleId = a!.id;

    const ctx = mockCtx(projectId);
    const newSchema = [
      EXISTING_ARTICLE_SCHEMA,
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] },
    ];

    try {
      const step = new PersistSchemaStep();
      const out = await step.execute(
        {
          articleId,
          projectId,
          schemaJsonLd: newSchema,
          detection: {
            hasFaq: true,
            hasHowTo: false,
            faqQuestions: [{ q: 1 }, { q: 2 }, { q: 3 }],
            howToSteps: [],
          },
          addedTypes: ["BreadcrumbList", "FAQPage"],
        },
        ctx
      );

      expect(out.articleId).toBe(articleId);
      expect(out.schemaCount).toBe(3);
      expect(out.schemaExtensionRunId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      const [saved] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
      expect(saved!.status).toBe("final_review");
      expect(saved!.schemaJsonLd).toHaveLength(3);

      const [run] = await db
        .select()
        .from(schemaExtensionRuns)
        .where(eq(schemaExtensionRuns.id, out.schemaExtensionRunId))
        .limit(1);
      expect(run!.status).toBe("succeeded");
      expect(run!.detectedTypes!.faq).toBe(true);
      expect(run!.detectedTypes!.breadcrumb).toBe(true);
      expect(run!.faqQuestionCount).toBe(3);
      expect(run!.howtoStepCount).toBe(0);
    } finally {
      await db.delete(articles).where(eq(articles.id, articleId));
    }
  });
});

describe("SchemaExtensionPipeline — graceful degradation (DB)", () => {
  it("reverts article to final_review when pipeline fails (afterError hook)", async () => {
    // Article with schema_extending status but no bodyMd or heroImagePublicUrl —
    // LoadArticleStep's Zod output validation will fail (z.string() rejects null).
    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `degrade-test-${Date.now()}`,
        cornerstoneKeyword: "claude-ai",
        title: "Degradation Test Article",
        // bodyMd intentionally null to trigger step output validation failure
        // heroImagePublicUrl intentionally null — z.string().url() rejects null
        status: "schema_extending",
        approvalMode: "manual",
      })
      .returning();
    const articleId = a!.id;

    try {
      const result = await runPipeline(
        new SchemaExtensionPipeline(),
        { articleId, projectId },
        { projectId }
      );

      expect(result.ok).toBe(false);

      // afterError must have reverted article status to final_review
      const [saved] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
      expect(saved!.status).toBe("final_review");
    } finally {
      await db.delete(articles).where(eq(articles.id, articleId));
    }
  });
});

// ───── Section B: Live tests (LLM) ───────────────────────────────────────────

const FAQ_BODY = `
# Was ist Claude AI? Der vollständige Leitfaden

Claude AI ist ein KI-Assistent von Anthropic. In diesem Artikel beantworten wir die
häufigsten Fragen rund um Claude.

## Häufige Fragen

### Was ist Claude AI?

Claude ist ein großes Sprachmodell (LLM), das von Anthropic entwickelt wurde. Es kann
Texte verfassen, Code schreiben, Fragen beantworten und komplexe Aufgaben analysieren.

### Wer hat Claude entwickelt?

Claude wurde von Anthropic entwickelt, einem KI-Sicherheitsunternehmen mit Sitz in
San Francisco. Anthropic wurde 2021 von ehemaligen OpenAI-Mitarbeitern gegründet.

### Wie unterscheidet sich Claude von ChatGPT?

Claude legt besonderen Wert auf Sicherheit und hilfreiche, harmlose und ehrliche Antworten.
ChatGPT ist von OpenAI und hat eine andere Trainingsphilosophie. Beide sind leistungsstarke
Assistenten, aber Claude gilt als besonders verlässlich bei langen Texten.

### Ist Claude kostenlos nutzbar?

Ja, Claude ist über claude.ai in einer kostenlosen Version verfügbar. Claude Pro bietet
unbegrenzten Zugang zu den leistungsstärksten Modellen für einen monatlichen Beitrag.

### Welche Sprachen unterstützt Claude?

Claude unterstützt viele Sprachen, darunter Deutsch, Englisch, Französisch, Spanisch,
Japanisch und viele weitere. Die Qualität ist in Englisch am höchsten.
`.trim();

describe.skipIf(!LIVE)("SchemaExtensionPipeline — full pipeline (live, ~€0.05)", () => {
  let liveArticleId: string;

  beforeAll(async () => {
    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `live-schema-ext-${Date.now()}`,
        cornerstoneKeyword: "claude-ai",
        title: "Was ist Claude AI? Der vollständige Leitfaden",
        metaDescription:
          "Claude AI erklärt: Was ist es, wer hat es entwickelt und wie nutzt man es?",
        bodyMd: FAQ_BODY,
        heroImagePublicUrl: "https://cdn.example.com/claude-hero.jpg",
        schemaJsonLd: [EXISTING_ARTICLE_SCHEMA],
        status: "schema_extending",
        approvalMode: "manual",
      })
      .returning();
    liveArticleId = a!.id;
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.id, liveArticleId));
  });

  it("pipeline runs to completion and persists enhanced schema", async () => {
    const result = await runPipeline(
      new SchemaExtensionPipeline(),
      { articleId: liveArticleId, projectId },
      { projectId }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Pipeline failed at ${result.failedAtStep}: ${result.error}`);

    expect(result.output.articleId).toBe(liveArticleId);
    expect(result.output.schemaCount).toBeGreaterThanOrEqual(2); // Article + BreadcrumbList minimum
    expect(result.output.schemaExtensionRunId).toBeTruthy();
  }, 60_000);

  it("article status is final_review after pipeline completes", async () => {
    const [saved] = await db.select().from(articles).where(eq(articles.id, liveArticleId)).limit(1);
    expect(saved!.status).toBe("final_review");
  });

  it("schemaJsonLd array contains Article and BreadcrumbList", async () => {
    const [saved] = await db.select().from(articles).where(eq(articles.id, liveArticleId)).limit(1);
    const schemas = saved!.schemaJsonLd as Array<Record<string, unknown>>;

    const types = schemas.map((s) => s["@type"] as string);
    expect(types).toContain("Article");
    expect(types).toContain("BreadcrumbList");
  });

  it("detects FAQPage (article has 5 explicit Q&A pairs)", async () => {
    const [saved] = await db.select().from(articles).where(eq(articles.id, liveArticleId)).limit(1);
    const schemas = saved!.schemaJsonLd as Array<Record<string, unknown>>;

    const faq = schemas.find((s) => s["@type"] === "FAQPage");
    expect(faq).toBeDefined();

    const questions = faq!["mainEntity"] as Array<Record<string, unknown>>;
    expect(questions.length).toBeGreaterThanOrEqual(3);
    for (const q of questions) {
      expect(q["@type"]).toBe("Question");
      expect((q["acceptedAnswer"] as Record<string, unknown>)["@type"]).toBe("Answer");
    }
  });

  it("schema_extension_runs row has succeeded status", async () => {
    const runs = await db
      .select()
      .from(schemaExtensionRuns)
      .where(eq(schemaExtensionRuns.articleId, liveArticleId));

    expect(runs.length).toBeGreaterThanOrEqual(1);
    const latest = runs[runs.length - 1]!;
    expect(latest.status).toBe("succeeded");
    expect(latest.detectedTypes!.breadcrumb).toBe(true);
    expect(latest.detectedTypes!.faq).toBe(true);
    expect(latest.faqQuestionCount).toBeGreaterThanOrEqual(3);
  });

  it("BreadcrumbList includes cluster path since article has a cluster", async () => {
    const [saved] = await db.select().from(articles).where(eq(articles.id, liveArticleId)).limit(1);
    const schemas = saved!.schemaJsonLd as Array<Record<string, unknown>>;

    const bc = schemas.find((s) => s["@type"] === "BreadcrumbList")!;
    expect(bc).toBeDefined();

    const items = bc["itemListElement"] as Array<Record<string, unknown>>;
    // With cluster: Home → Blog → Cluster → Article = 4 items
    expect(items.length).toBe(4);
    const clusterItem = items[2]!;
    expect(clusterItem["name"]).toBe("Claude AI");
  });

  it("re-running pipeline replaces BreadcrumbList without creating duplicates", async () => {
    // Run a second time on the same article (now in final_review, which is also accepted)
    const result = await runPipeline(
      new SchemaExtensionPipeline(),
      { articleId: liveArticleId, projectId },
      { projectId }
    );
    expect(result.ok).toBe(true);

    const [saved] = await db.select().from(articles).where(eq(articles.id, liveArticleId)).limit(1);
    const schemas = saved!.schemaJsonLd as Array<Record<string, unknown>>;

    const breadcrumbs = schemas.filter((s) => s["@type"] === "BreadcrumbList");
    const faqs = schemas.filter((s) => s["@type"] === "FAQPage");
    const articleSchemas = schemas.filter((s) => s["@type"] === "Article");

    expect(breadcrumbs).toHaveLength(1);
    expect(faqs).toHaveLength(1);
    expect(articleSchemas).toHaveLength(1);
  }, 60_000);
});
