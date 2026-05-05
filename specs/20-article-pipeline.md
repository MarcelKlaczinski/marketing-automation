# Spec 20: Article Pipeline

**Phase:** 3 (Volume Production for KI-Wissensraum)
**Estimated Effort:** 3 days (split into 4-5 sessions)
**Dependencies:** Spec 05 (pipeline engine + BullMQ), Spec 10 (project context), Spec 11 (anthropic), Spec 12 (replicate + R2), Spec 13 (dataforseo), Spec 14 (cold-start — produces the cornerstones this pipeline consumes)
**Status:** Ready for implementation
**Recommended Model:** Opus 4.7 (multi-step orchestration with BullMQ — high architectural leverage)

---

## Goal

Build the **Article Pipeline**: the workflow that takes a Cornerstone-Spec from `04-cornerstone-list.md` (or any approved cornerstone in the DB) and produces a complete, publish-ready article in the `articles` table.

The pipeline runs in **two BullMQ jobs** with an optional pause point in the middle:

```
─── Job 1: Research + Outline ──────────────────────────────────────
1. TopicIntakeStep         — Load cornerstone + cluster + project context
2. ResearchStep            — DataForSEO SERP + PAA + competitor URLs
3. OutlineStep             — Anthropic generates H2 structure + intro angle
4. PersistOutlineStep      — Save outline JSON to articles row, status="outline_review"
                              ↓
                        [if approvalMode=manual] → STOP, wait for `article:continue <slug>`
                        [if approvalMode=auto]   → enqueue Job 2 immediately
                              ↓
─── Job 2: Draft + Image + Assembly ────────────────────────────────
5. DraftStep               — Anthropic writes ~2-3k word article
6. SelfReviewStep          — Anthropic checks against quality floors
7. HeroImageStep           — Replicate Flux 1.1 Pro → R2 upload
8. AssemblyStep            — Slug, frontmatter fields, schema.org JSON-LD
9. PersistArticleStep      — Save complete article to DB, status="final_review"
```

Each step can be re-run individually via the underlying Pipeline framework (Spec 05).
Cost is tracked per step. Failures retry with backoff via BullMQ's built-in retry.

After this spec, the workflow is:
1. Cornerstone exists in DB (from Spec 14 cold-start, status `proposed`)
2. Marcel sets cornerstone status to `approved` (manually in Drizzle Studio or via cluster-plan re-edit)
3. Marcel runs `bun --filter @marketing-auto/api article:generate <cornerstone-slug>`
4. ~2 min later: Job 1 done, Marcel reviews outline in Drizzle Studio (or in Web App later)
5. Marcel runs `bun --filter @marketing-auto/api article:continue <article-slug>`
6. ~5-8 min later: Job 2 done, complete article in DB
7. Marcel reviews via Drizzle Studio (until Spec 21 brings the Astro adapter)

## Triggering Strategy

Spec 20 implements **all three trigger paths from day one** because the pipeline logic itself is identical — only the entry point differs. This avoids a future refactor when the Web App arrives in Phase 4.

| Trigger | Status | How |
|---------|--------|-----|
| **CLI single** (A) | Active | `article:generate <slug>` |
| **CLI batch** (B) | Active | `article:generate --all-approved [--limit N]` |
| **Scheduled cron** (C) | Implemented but disabled by default | BullMQ Repeatable Job, picks N approved/day; toggle via `ARTICLE_SCHEDULER_ENABLED=true` env flag |
| **HTTP endpoint** (Web App, Phase 4) | Stub-only | `POST /api/projects/:slug/articles/generate` returns 501 with "use CLI for now"; Phase 4 fills in |

All four paths call the same `enqueueArticleGeneration()` service function. **No code-doubling between CLI and Web App.**

## Non-Goals

- **No Internal Linking** — handled by Spec 24 (separate pipeline that runs after each new article, rebuilds links cluster-wide)
- **No Markdown export** — Marcel reads articles in Drizzle Studio until Spec 21 (Astro CMS Adapter) ships
- **No Astro-repo commit** — Spec 21
- **No PageSpeed validation** — Spec 22
- **No social repurpose** — Spec 43 (Phase 4)
- **No backlink outreach** — out of scope entirely
- **No multi-language** — German only for KI-Wissensraum; Spec 25+ if Bellemann ever wants English
- **No automatic publishing** — articles never go to `published` status from the pipeline. Marcel approves manually (or via Web App in Phase 4)

## Lifecycle States

The `articles.status` column transitions through these states (defined in Spec 01's enum, possibly needs widening — verify before implementation):

```
proposed         ← created by Spec 14 cornerstone-list (or manually)
   ↓ Marcel approves cornerstone
approved
   ↓ Marcel runs article:generate
generating       ← Job 1 enqueued
   ↓ Job 1 completes
outline_review   ← Marcel reviews outline (manual mode)
   ↓ Marcel runs article:continue
drafting         ← Job 2 enqueued
   ↓ Job 2 completes
final_review     ← Marcel reviews complete article
   ↓ Marcel approves (manual, future Web App)
ready_to_publish ← Spec 21 picks this up
   ↓ Spec 21 commits to Astro repo
published        ← Astro publishes
```

**Important**: Verify `articles.status` enum in Spec 01 includes all states above. Likely needs adding `outline_review`, `drafting`, `final_review`, `ready_to_publish`. Migration in Implementation Order step 1.

## Detailed Implementation

### Schema additions

If the existing `articles` schema (from Spec 01) is missing fields, extend it. Check what's there first; this is the **expected** shape:

```typescript
// packages/db/src/schema/articles.ts (verify, extend if needed)
export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  clusterId: uuid("cluster_id").references(() => clusters.id),  // FK to cluster
  cornerstoneSpecId: uuid("cornerstone_spec_id"),               // FK back to cornerstone source
  
  // Identity
  slug: text("slug").notNull(),
  cornerstoneKeyword: text("cornerstone_keyword").notNull(),    // primary target keyword
  
  // Content fields (all populated incrementally by pipeline steps)
  title: text("title"),
  metaDescription: text("meta_description"),
  outline: jsonb("outline").$type<ArticleOutline>(),            // see types below
  bodyMd: text("body_md"),
  
  // Generated assets
  heroImageR2Key: text("hero_image_r2_key"),
  heroImagePublicUrl: text("hero_image_public_url"),
  heroImageAltText: text("hero_image_alt_text"),
  
  // Schema.org / SEO metadata
  schemaJsonLd: jsonb("schema_json_ld").$type<Record<string, unknown>>(),
  
  // Pipeline state
  status: articleStatusEnum("status").notNull().default("proposed"),
  approvalMode: text("approval_mode").$type<"manual" | "auto">().notNull().default("manual"),
  
  // Pipeline-run tracking
  outlinePipelineRunId: uuid("outline_pipeline_run_id").references(() => pipelineRuns.id),
  draftPipelineRunId: uuid("draft_pipeline_run_id").references(() => pipelineRuns.id),
  
  // Self-review output
  selfReviewIssues: jsonb("self_review_issues").$type<SelfReviewIssue[]>(),
  selfReviewScore: integer("self_review_score"),                // 0-100
  
  // Word count (cached for queries)
  wordCount: integer("word_count"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueSlugPerProject: uniqueIndex("articles_project_slug_unique").on(table.projectId, table.slug),
  statusIdx: index("articles_status_idx").on(table.status),
  cornerstoneKeywordIdx: index("articles_cornerstone_keyword_idx").on(table.cornerstoneKeyword),
}));
```

The `articleStatusEnum` may need expanding. Check `packages/db/src/schema/_enums.ts`:

```typescript
export const articleStatusEnum = pgEnum("article_status", [
  "proposed",
  "approved",
  "generating",
  "outline_review",
  "drafting",
  "final_review",
  "ready_to_publish",
  "published",
  "failed",       // for pipeline failures
  "rejected",     // for Marcel-rejected drafts
]);
```

Migration: `bun --filter @marketing-auto/db generate` then `migrate`.

### Types

`packages/pipelines/src/article/types.ts`:

```typescript
import { z } from "zod";

// ───── Outline (the artifact reviewed at the pause point) ──────────────────────

export const ArticleOutlineSchema = z.object({
  title: z.string().min(20).max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(100),
  metaDescription: z.string().min(80).max(180),
  
  /** The "hook" — opening angle. ~150 words of intro guidance for the draft step. */
  introAngle: z.string().min(100).max(2000),
  
  /** H2 sections in writing order. */
  sections: z.array(z.object({
    h2: z.string().min(5).max(150),
    intent: z.string().min(20).max(500),  // what this section achieves
    keyPoints: z.array(z.string().min(10)).min(2).max(10),
    estimatedWords: z.number().int().min(100).max(800),
    /** Optional satellite keywords this section should naturally include. */
    targetKeywords: z.array(z.string()).default([]),
  })).min(4).max(12),
  
  /** Hero image direction for Flux 1.1 Pro. */
  heroImagePrompt: z.string().min(30).max(500),
  heroImageStyle: z.enum(["photorealistic", "illustrated", "3d_render", "minimalist"]),
  
  /** Estimated total word count (sum of section estimates + intro/outro buffer). */
  estimatedTotalWords: z.number().int().min(800).max(5000),
});

export type ArticleOutline = z.infer<typeof ArticleOutlineSchema>;

// ───── Self-Review issues ─────────────────────────────────────────────────────

export const SelfReviewIssueSchema = z.object({
  severity: z.enum(["critical", "warning", "suggestion"]),
  category: z.enum([
    "voice_drift",       // doesn't sound like the brand
    "factual_concern",   // unsupported claim
    "weak_intro",
    "weak_conclusion",
    "section_imbalance", // sections wildly different lengths
    "keyword_stuffing",
    "missing_examples",
    "verbose",
    "other",
  ]),
  location: z.string(),                 // section header or "intro" / "conclusion" / "global"
  description: z.string(),
  suggestion: z.string().optional(),
});

export type SelfReviewIssue = z.infer<typeof SelfReviewIssueSchema>;

// ───── Research output ────────────────────────────────────────────────────────

export const ResearchResultSchema = z.object({
  serp: z.object({
    keyword: z.string(),
    organicResults: z.array(z.object({
      position: z.number(),
      url: z.string(),
      title: z.string(),
      snippet: z.string(),
      domain: z.string(),
    })),
    peopleAlsoAsk: z.array(z.string()),
    relatedSearches: z.array(z.string()),
    serpFeatures: z.array(z.string()),
  }),
  /**
   * Brief synthesis of what the top 3-5 ranking pages cover.
   * Fed into outline generation.
   */
  competitorSynthesis: z.string().min(200).max(3000),
});

export type ResearchResult = z.infer<typeof ResearchResultSchema>;

// ───── Errors ─────────────────────────────────────────────────────────────────

export class ArticlePipelineError extends Error {
  constructor(
    message: string,
    public readonly stage: "topic_intake" | "research" | "outline" | "draft" | "review" | "image" | "assembly",
    public readonly originalCause?: unknown,
  ) {
    super(message);
    this.name = "ArticlePipelineError";
  }
}
```

### The Service Layer (Web-App-Ready Trigger)

`packages/pipelines/src/article/trigger.ts`:

```typescript
import { eq, and } from "drizzle-orm";
import { db, articles, clusters } from "@marketing-auto/db";
import { enqueuePipeline } from "../engine/runner.ts";
import { ArticleOutlinePipeline, ArticleDraftPipeline } from "./pipeline.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("article-trigger");

export type EnqueueArticleGenerationInput = {
  /** The cornerstone keyword OR an existing article slug if continuing. */
  cornerstoneSlug: string;
  projectId: string;
  /** "manual" pauses after outline; "auto" runs Job 2 immediately on Job 1 completion. */
  approvalMode?: "manual" | "auto";
  /** Optional override for which model to use. Default: project's pipeline-template default. */
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
};

export type EnqueueArticleGenerationResult = {
  articleId: string;
  outlineJobId: string;
  /** Only set if approvalMode = "auto"; the draft job is enqueued at the end of outline job. */
  status: "outline_enqueued";
};

/**
 * Single entry point used by ALL triggers (CLI single, CLI batch, scheduler, HTTP endpoint).
 * Creates an `articles` row in `generating` state, enqueues Job 1 (outline pipeline).
 */
export async function enqueueArticleGeneration(
  input: EnqueueArticleGenerationInput,
): Promise<EnqueueArticleGenerationResult> {
  // 1. Find or create the article row
  const existing = await db
    .select()
    .from(articles)
    .where(and(
      eq(articles.projectId, input.projectId),
      eq(articles.cornerstoneKeyword, input.cornerstoneSlug),
    ))
    .limit(1);

  let articleId: string;
  if (existing.length > 0) {
    const e = existing[0]!;
    if (e.status === "generating" || e.status === "drafting") {
      throw new Error(
        `Article for "${input.cornerstoneSlug}" is already in progress (status: ${e.status}). ` +
        `Wait for it to complete or fail.`,
      );
    }
    if (e.status === "published") {
      throw new Error(
        `Article for "${input.cornerstoneSlug}" is already published. ` +
        `To regenerate, set its status to "approved" first.`,
      );
    }
    // Reset for regeneration
    articleId = e.id;
    await db.update(articles).set({
      status: "generating",
      approvalMode: input.approvalMode ?? "manual",
      updatedAt: new Date(),
    }).where(eq(articles.id, articleId));
  } else {
    // Brand new article. Need to find the cluster from the cornerstone keyword.
    const cluster = await findClusterByCornerstone(input.projectId, input.cornerstoneSlug);
    if (!cluster) {
      throw new Error(
        `No cluster found containing cornerstone keyword "${input.cornerstoneSlug}" for project. ` +
        `Run cold-start cluster-plan first.`,
      );
    }
    const [created] = await db.insert(articles).values({
      projectId: input.projectId,
      clusterId: cluster.id,
      slug: slugify(input.cornerstoneSlug),       // initial guess; outline step may refine
      cornerstoneKeyword: input.cornerstoneSlug,
      status: "generating",
      approvalMode: input.approvalMode ?? "manual",
    }).returning();
    articleId = created!.id;
  }

  // 2. Enqueue Job 1 (outline pipeline)
  const outlineJobId = await enqueuePipeline(
    ArticleOutlinePipeline,
    { articleId, projectId: input.projectId, modelOverride: input.modelOverride },
    {
      projectId: input.projectId,
      jobName: `article-outline-${articleId}`,
    },
  );

  log.info({
    articleId,
    cornerstoneSlug: input.cornerstoneSlug,
    approvalMode: input.approvalMode ?? "manual",
    outlineJobId,
  }, "Article generation enqueued (Job 1)");

  return { articleId, outlineJobId, status: "outline_enqueued" };
}

/**
 * Continues a paused article — runs Job 2 (draft + image + assembly).
 * Called manually via `article:continue <slug>` in manual mode.
 * In auto mode, this is called automatically at the end of Job 1's PersistOutlineStep.
 */
export async function continueArticleGeneration(input: {
  articleId: string;
  projectId: string;
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
}): Promise<{ draftJobId: string }> {
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);
  
  if (!article) throw new Error(`Article ${input.articleId} not found`);
  if (article.status !== "outline_review") {
    throw new Error(
      `Article status is "${article.status}", expected "outline_review". ` +
      `Cannot continue.`,
    );
  }
  if (!article.outline) {
    throw new Error(`Article has no outline persisted; Job 1 incomplete.`);
  }

  await db.update(articles).set({
    status: "drafting",
    updatedAt: new Date(),
  }).where(eq(articles.id, input.articleId));

  const draftJobId = await enqueuePipeline(
    ArticleDraftPipeline,
    { articleId: input.articleId, projectId: input.projectId, modelOverride: input.modelOverride },
    {
      projectId: input.projectId,
      jobName: `article-draft-${input.articleId}`,
    },
  );

  log.info({
    articleId: input.articleId,
    draftJobId,
  }, "Article generation continued (Job 2)");

  return { draftJobId };
}

// ───── Helpers ────────────────────────────────────────────────────────────────

async function findClusterByCornerstone(projectId: string, cornerstoneKeyword: string) {
  // Implementation depends on how Spec 14 stored cornerstone-keyword → cluster mapping.
  // Likely: clusters table has a `cornerstone_keywords` jsonb column, OR a separate
  // `cluster_cornerstones` join table. Check Spec 14 implementation; this stub assumes
  // a cornerstone_keywords array on clusters.
  const allClusters = await db
    .select()
    .from(clusters)
    .where(eq(clusters.projectId, projectId));
  
  return allClusters.find((c) => {
    const keywords = (c.cornerstoneKeywords as string[]) ?? [];
    return keywords.includes(cornerstoneKeyword);
  });
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
```

### Pipeline Step: TopicIntake

`packages/pipelines/src/article/steps/topic-intake.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles, clusters, projects } from "@marketing-auto/db";
import { ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  cornerstoneKeyword: z.string(),
  clusterName: z.string(),
  clusterPillar: z.string(),
  satelliteKeywords: z.array(z.string()),
  projectSlug: z.string(),
});

export class TopicIntakeStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "topic-intake";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }  // pure DB read

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new ArticlePipelineError(`Article ${input.articleId} not found`, "topic_intake");

    if (!article.clusterId) {
      throw new ArticlePipelineError(
        `Article has no clusterId — cannot proceed without cluster context`,
        "topic_intake",
      );
    }
    const [cluster] = await db.select().from(clusters).where(eq(clusters.id, article.clusterId)).limit(1);
    if (!cluster) throw new ArticlePipelineError(`Cluster ${article.clusterId} not found`, "topic_intake");

    const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new ArticlePipelineError(`Project ${input.projectId} not found`, "topic_intake");

    // Extract satellite keywords for THIS cornerstone from the cluster
    const clusterData = cluster.satelliteKeywords as Array<{
      cornerstoneKeyword: string;
      keywords: Array<{ keyword: string }>;
    }> ?? [];
    const matchingEntry = clusterData.find((e) => e.cornerstoneKeyword === article.cornerstoneKeyword);
    const satelliteKeywords = matchingEntry?.keywords.map((k) => k.keyword) ?? [];

    return {
      cornerstoneKeyword: article.cornerstoneKeyword,
      clusterName: cluster.name,
      clusterPillar: cluster.pillar ?? "general",
      satelliteKeywords,
      projectSlug: project.slug,
    };
  }
}
```

### Pipeline Step: Research

`packages/pipelines/src/article/steps/research.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { dataforseo } from "@marketing-auto/adapter-dataforseo";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { ResearchResultSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  cornerstoneKeyword: z.string(),
  satelliteKeywords: z.array(z.string()),
  projectSlug: z.string(),
});

export class ResearchStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof ResearchResultSchema>
> {
  readonly name = "research";
  readonly inputSchema = InputSchema;
  readonly outputSchema = ResearchResultSchema;

  override estimatedCostEur(): number {
    return 0.005 + 0.10;  // DataForSEO SERP + Anthropic competitor synthesis
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    // 1. Get top-10 SERP for the cornerstone keyword
    const serp = await dataforseo.serp({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: `article-research-serp-${sanitize(input.cornerstoneKeyword)}`,
      keyword: input.cornerstoneKeyword,
      depth: 10,
      estimatedCostEur: 0.0018,
    });

    // 2. Synthesize competitor coverage via Anthropic
    //    We DO NOT fetch competitor pages — that's expensive and slow.
    //    Instead we feed the SERP titles + snippets to Anthropic, which is enough
    //    signal for "what topics does the SERP currently emphasize?"
    const prompt = await buildSystemPrompt({
      skills: ["ai-seo", "content-strategy"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are analyzing a Google SERP to identify what topics, angles, and patterns
the currently-ranking pages are covering for a target keyword.

Your output: a 200-500 word synthesis covering:
1. **Common patterns**: What 80%+ of top results cover
2. **Coverage gaps**: What's notably missing or only weakly covered
3. **Differentiation opportunities**: What angles could let us stand out
4. **Reader intent**: What is someone searching this actually trying to accomplish?

Use the People Also Ask questions and Related Searches as additional intent signals.

Be specific. "Most pages cover X" is good. "There are some patterns" is bad.
      `,
    });

    const userMsg = [
      `# Target keyword: ${input.cornerstoneKeyword}`,
      ``,
      `## Top 10 organic results`,
      serp.organicResults.map((r, i) =>
        `${i + 1}. **${r.title}** — ${r.domain}\n   ${r.snippet}`
      ).join("\n\n"),
      ``,
      serp.peopleAlsoAsk.length > 0
        ? `## People Also Ask\n${serp.peopleAlsoAsk.map((q) => `- ${q}`).join("\n")}`
        : "",
      serp.relatedSearches.length > 0
        ? `## Related Searches\n${serp.relatedSearches.map((q) => `- ${q}`).join("\n")}`
        : "",
      `## Satellite keywords this article should also cover\n${input.satelliteKeywords.map((k) => `- ${k}`).join("\n")}`,
    ].filter(Boolean).join("\n\n");

    const synth = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "research-competitor-synthesis",
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 2000,
      estimatedCostEur: 0.10,
    });

    return ResearchResultSchema.parse({
      serp: {
        keyword: serp.keyword,
        organicResults: serp.organicResults.map((r) => ({
          position: r.position,
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          domain: r.domain,
        })),
        peopleAlsoAsk: serp.peopleAlsoAsk,
        relatedSearches: serp.relatedSearches,
        serpFeatures: serp.serpFeatures,
      },
      competitorSynthesis: synth.raw,
    });
  }
}

function sanitize(s: string): string {
  return s.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 50);
}
```

### Pipeline Step: Outline

`packages/pipelines/src/article/steps/outline.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { ArticleOutlineSchema, type ResearchResult } from "../types.ts";

const InputSchema = z.object({
  cornerstoneKeyword: z.string(),
  satelliteKeywords: z.array(z.string()),
  clusterName: z.string(),
  clusterPillar: z.string(),
  projectSlug: z.string(),
  research: z.unknown(),  // typed via ResearchResult below
});

export class OutlineStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof ArticleOutlineSchema>
> {
  readonly name = "outline";
  readonly inputSchema = InputSchema;
  readonly outputSchema = ArticleOutlineSchema;

  override estimatedCostEur(): number { return 0.30; }  // Opus call, ~3-5k tokens out

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const research = input.research as ResearchResult;

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "content-strategy", "ai-seo", "schema-markup"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are producing the OUTLINE for an article. Marcel will review this outline
before any draft is written. The outline must be specific enough that:
- A different writer could pick it up and produce a draft that matches the intent
- Marcel can spot strategic mistakes (wrong angle, wrong sections) in 2 minutes of reading
- The draft step has all the structural decisions made

Rules:
1. **Title**: Specific, intent-matching, ~60 chars (fits in SERP). Include the cornerstone
   keyword naturally. NO clickbait, NO ALL-CAPS, NO "[YEAR]" placeholders.
2. **Slug**: kebab-case, lowercase, max 60 chars, German-friendly (umlauts → ae/oe/ue/ss).
3. **Meta description**: 150-160 chars, includes cornerstone keyword, action-oriented.
4. **Intro angle**: 100-200 words explaining HOW we open this article.
   What's the hook? What stake does the reader have?
5. **Sections** (4-12 H2s, ordered for narrative flow):
   - Each H2 is specific (not "Introduction", "Conclusion" — those are the surrounding intro/outro)
   - Each section lists 2-10 key points the draft must hit
   - Each section has an estimated word count summing to 800-3500 total
   - Sections naturally weave in satellite keywords where relevant
6. **Hero image**: A specific prompt for Flux 1.1 Pro. NOT generic ("a person at a desk").
   Specific composition + style + mood. Include style enum.
7. **Estimated total words**: Realistic; do not pad.

You have access to:
- The marketing-context.md (voice, audience, pillars)
- Competitor synthesis (what the SERP covers — you should DIFFER strategically)
- Cluster context (this article is part of "${input.clusterName}", pillar "${input.clusterPillar}")
- Satellite keywords (must appear naturally; do not stuff)

Output JSON matching the ArticleOutlineSchema schema EXACTLY.
      `,
    });

    const userMsg = [
      `# Article brief`,
      `**Cornerstone keyword**: ${input.cornerstoneKeyword}`,
      `**Cluster**: ${input.clusterName} (pillar: ${input.clusterPillar})`,
      `**Satellite keywords to weave in**: ${input.satelliteKeywords.join(", ")}`,
      ``,
      `# SERP analysis`,
      research.competitorSynthesis,
      ``,
      `# Top organic competitors (for reference)`,
      research.serp.organicResults.slice(0, 5).map((r) => 
        `- ${r.title} (${r.domain})`
      ).join("\n"),
      ``,
      `# People Also Ask (use these to inform reader intent)`,
      research.serp.peopleAlsoAsk.slice(0, 8).map((q) => `- ${q}`).join("\n") || "(none)",
      ``,
      `Now produce the outline.`,
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "article-outline",
      model: "claude-opus-4-7",  // Outline quality is leverage — every later step depends on it
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 4000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return ArticleOutlineSchema.parse(result.json);
  }
}
```

### Pipeline Step: PersistOutline (Pause Point)

`packages/pipelines/src/article/steps/persist-outline.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles } from "@marketing-auto/db";
import { ArticleOutlineSchema } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  outline: ArticleOutlineSchema,
  approvalMode: z.enum(["manual", "auto"]),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  nextAction: z.enum(["wait_for_review", "auto_continue"]),
});

export class PersistOutlineStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-outline";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    await db.update(articles).set({
      title: input.outline.title,
      slug: input.outline.slug,
      metaDescription: input.outline.metaDescription,
      outline: input.outline,
      status: "outline_review",
      outlinePipelineRunId: ctx.pipelineRunId,
      updatedAt: new Date(),
    }).where(eq(articles.id, input.articleId));

    const nextAction = input.approvalMode === "auto" ? "auto_continue" : "wait_for_review";

    return { articleId: input.articleId, nextAction };
  }
}
```

### Auto-continue logic in the Outline Pipeline

The OUTLINE pipeline's last step persists. If `approvalMode = "auto"`, the pipeline runner enqueues the DRAFT pipeline. This happens in the pipeline definition, not in PersistOutlineStep itself, to keep the step pure.

`packages/pipelines/src/article/pipeline.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, articles } from "@marketing-auto/db";
import { Pipeline } from "../engine/pipeline.ts";
import { TopicIntakeStep } from "./steps/topic-intake.ts";
import { ResearchStep } from "./steps/research.ts";
import { OutlineStep } from "./steps/outline.ts";
import { PersistOutlineStep } from "./steps/persist-outline.ts";
import { DraftStep } from "./steps/draft.ts";
import { SelfReviewStep } from "./steps/self-review.ts";
import { HeroImageStep } from "./steps/hero-image.ts";
import { AssemblyStep } from "./steps/assembly.ts";
import { PersistArticleStep } from "./steps/persist-article.ts";
import { continueArticleGeneration } from "./trigger.ts";
import { ArticleOutlineSchema } from "./types.ts";

// ───── Job 1: Outline Pipeline ────────────────────────────────────────────────

const OutlineInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  modelOverride: z.string().optional(),
});

const OutlineOutputSchema = z.object({
  articleId: z.string().uuid(),
  outline: ArticleOutlineSchema,
  nextAction: z.enum(["wait_for_review", "auto_continue"]),
});

export class ArticleOutlinePipeline extends Pipeline<
  z.infer<typeof OutlineInputSchema>,
  z.infer<typeof OutlineOutputSchema>
> {
  readonly name = "article:outline";
  readonly inputSchema = OutlineInputSchema;
  readonly outputSchema = OutlineOutputSchema;
  readonly steps = [
    new TopicIntakeStep(),
    new ResearchStep(),
    new OutlineStep(),
    new PersistOutlineStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof OutlineInputSchema>,
    getStepOutput: <T = unknown>(name: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "topic-intake" && toStep.name === "research") {
      const t = output as { cornerstoneKeyword: string; satelliteKeywords: string[]; projectSlug: string };
      return {
        cornerstoneKeyword: t.cornerstoneKeyword,
        satelliteKeywords: t.satelliteKeywords,
        projectSlug: t.projectSlug,
      };
    }
    if (fromStep.name === "research" && toStep.name === "outline") {
      const t = getStepOutput<{ cornerstoneKeyword: string; satelliteKeywords: string[]; projectSlug: string; clusterName: string; clusterPillar: string }>("topic-intake")!;
      return {
        cornerstoneKeyword: t.cornerstoneKeyword,
        satelliteKeywords: t.satelliteKeywords,
        clusterName: t.clusterName,
        clusterPillar: t.clusterPillar,
        projectSlug: t.projectSlug,
        research: output,
      };
    }
    if (fromStep.name === "outline" && toStep.name === "persist-outline") {
      const article = getStepOutputOrFetchArticle(pipelineInput.articleId, getStepOutput);
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        outline: output,
        approvalMode: article.approvalMode,
      };
    }
    return output;
  }

  /**
   * After all steps run successfully: if approvalMode = "auto", enqueue the draft pipeline.
   * If "manual", do nothing — Marcel must run `article:continue`.
   */
  override async afterComplete(
    output: z.infer<typeof OutlineOutputSchema>,
    pipelineInput: z.infer<typeof OutlineInputSchema>,
  ): Promise<void> {
    if (output.nextAction === "auto_continue") {
      await continueArticleGeneration({
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        modelOverride: pipelineInput.modelOverride as "claude-opus-4-7" | "claude-sonnet-4-6" | undefined,
      });
    }
  }
}

// helper
async function getStepOutputOrFetchArticle(
  articleId: string,
  _getStepOutput: <T = unknown>(name: string) => T | undefined,
): Promise<{ approvalMode: "manual" | "auto" }> {
  const [a] = await db.select({ approvalMode: articles.approvalMode })
    .from(articles).where(eq(articles.id, articleId)).limit(1);
  return a ?? { approvalMode: "manual" };
}

// ───── Job 2: Draft Pipeline ──────────────────────────────────────────────────

const DraftInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  modelOverride: z.string().optional(),
});

const DraftOutputSchema = z.object({
  articleId: z.string().uuid(),
  wordCount: z.number(),
  selfReviewScore: z.number(),
});

export class ArticleDraftPipeline extends Pipeline<
  z.infer<typeof DraftInputSchema>,
  z.infer<typeof DraftOutputSchema>
> {
  readonly name = "article:draft";
  readonly inputSchema = DraftInputSchema;
  readonly outputSchema = DraftOutputSchema;
  readonly steps = [
    // First we re-load topic intake (cluster context, project slug, etc.)
    new TopicIntakeStep(),
    new DraftStep(),
    new SelfReviewStep(),
    new HeroImageStep(),
    new AssemblyStep(),
    new PersistArticleStep(),
  ] as const;

  // Bridges between steps — each step gets the right input shape from the prior outputs.
  // Pattern matches Spec 14's CompetitorAnalysisPipeline.bridge() — implementation
  // detail. Detailed per-bridge logic shown in implementation order section.
}
```

### Pipeline Step: Draft

`packages/pipelines/src/article/steps/draft.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles } from "@marketing-auto/db";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  modelOverride: z.string().optional(),
});

const OutputSchema = z.object({
  bodyMd: z.string().min(500),
  wordCount: z.number().int().min(500),
});

export class DraftStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "draft";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0.80; }  // Sonnet, ~3-4k word output

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    // Re-load article to get the outline
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new ArticlePipelineError(`Article ${input.articleId} not found`, "draft");
    if (!article.outline) throw new ArticlePipelineError(`Article has no outline`, "draft");

    const outline = ArticleOutlineSchema.parse(article.outline);
    const model = (input.modelOverride as "claude-opus-4-7" | "claude-sonnet-4-6" | undefined) ?? "claude-sonnet-4-6";

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "copy-editing", "ai-seo", "product-marketing-context"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are writing the FULL DRAFT of an article based on the approved outline.

Hard rules:
1. Write in the project's voice (loaded from marketing-context.md). NEVER drift.
2. Match the outline EXACTLY — same H2s, same key points per section, same order.
3. Hit estimated word counts within ±20%. Do not pad.
4. Weave satellite keywords naturally (1-3 mentions per article, total). NO stuffing.
5. Write in Markdown:
   - H2 for sections (## Section Name)
   - H3 sparingly within sections
   - Use lists when the content is genuinely list-shaped, not as decoration
   - Code blocks with language tag for any code
   - Bold/italic for genuine emphasis only
6. Open with the intro angle from the outline (not a generic "In this article we will..."  intro)
7. End with a conclusion that has a clear takeaway, not a summary
8. Use concrete examples, specific numbers, real product names where applicable
9. NO em-dashes used as filler. NO "delve", "navigate", "leverage", "robust" unless context demands them.
10. NO "I" or "we" unless the project's voice explicitly uses first-person

Output: pure Markdown, ready to publish. No frontmatter, no JSON wrapping.
      `,
    });

    const userMsg = [
      `# Outline to write`,
      `**Title**: ${outline.title}`,
      `**Meta description**: ${outline.metaDescription}`,
      ``,
      `## Intro angle`,
      outline.introAngle,
      ``,
      `## Sections`,
      outline.sections.map((s, i) => [
        `### ${i + 1}. ${s.h2}`,
        `*Intent*: ${s.intent}`,
        `*Estimated words*: ${s.estimatedWords}`,
        `*Key points*:`,
        ...s.keyPoints.map((p) => `- ${p}`),
        s.targetKeywords.length > 0 ? `*Naturally include*: ${s.targetKeywords.join(", ")}` : "",
      ].filter(Boolean).join("\n")).join("\n\n"),
      ``,
      `Now write the full article in Markdown.`,
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "article-draft",
      model,
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 8000,
      estimatedCostEur: this.estimatedCostEur(),
    });

    const bodyMd = result.raw;
    const wordCount = bodyMd.trim().split(/\s+/).length;

    if (wordCount < 500) {
      throw new ArticlePipelineError(
        `Draft too short: ${wordCount} words. Outline estimated ${outline.estimatedTotalWords}.`,
        "draft",
      );
    }

    return { bodyMd, wordCount };
  }
}
```

### Pipeline Step: Self-Review

`packages/pipelines/src/article/steps/self-review.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { SelfReviewIssueSchema } from "../types.ts";

const InputSchema = z.object({
  bodyMd: z.string(),
  wordCount: z.number(),
  cornerstoneKeyword: z.string(),
  projectSlug: z.string(),
});

const OutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  issues: z.array(SelfReviewIssueSchema),
  shouldBlock: z.boolean(),  // true if any "critical" issues
  summary: z.string(),
});

export class SelfReviewStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "self-review";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0.05; }  // Haiku call — cheap reviewer

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const prompt = await buildSystemPrompt({
      skills: ["copy-editing", "product-marketing-context"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are reviewing a draft article for quality issues. You are STRICT.
You are NOT writing the article. You are critiquing it.

Categories to check:
- voice_drift: Does it sound like the project's voice (per marketing-context.md)?
- factual_concern: Any unsupported claims, made-up statistics, hallucinated product features?
- weak_intro: Does the opening hook the reader, or is it generic?
- weak_conclusion: Does the conclusion give a clear takeaway, or is it a summary?
- section_imbalance: Are sections wildly different lengths (e.g., one 800 words, one 100)?
- keyword_stuffing: Is the cornerstone keyword unnaturally repeated?
- missing_examples: Does the article make general claims without concrete examples?
- verbose: Are sentences padded with filler words ("in order to", "due to the fact that")?

Severity:
- critical: Must fix before publish (hallucination, severe voice drift, broken structure)
- warning: Should fix (weak intro, mild voice drift)
- suggestion: Could improve (better examples, tighter prose)

Score 0-100: 100 = ready to publish, 0 = unsalvageable rewrite.
Realistic scoring:
- 90+: only suggestions
- 70-89: a few warnings, no criticals
- 50-69: criticals exist, blocking
- <50: structural problems, suggest re-running with stricter outline

Output JSON: { score, issues: [...], shouldBlock, summary }
shouldBlock = true if ANY critical issues OR score < 70.
summary = 1-2 sentence overall verdict.
      `,
    });

    const userMsg = [
      `# Article under review`,
      `**Cornerstone keyword**: ${input.cornerstoneKeyword}`,
      `**Word count**: ${input.wordCount}`,
      ``,
      `---`,
      ``,
      input.bodyMd,
      ``,
      `---`,
      ``,
      `Now produce your review.`,
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "article-self-review",
      model: "claude-haiku-4-5",  // Reviews are pattern-matching; Haiku is fine and 10x cheaper
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 3000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    const parsed = OutputSchema.parse(result.json);
    return parsed;
  }
}
```

### Pipeline Step: Hero Image

`packages/pipelines/src/article/steps/hero-image.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles } from "@marketing-auto/db";
import { replicate } from "@marketing-auto/adapter-replicate";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  r2Key: z.string(),
  publicUrl: z.string().url(),
  altText: z.string(),
});

export class HeroImageStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "hero-image";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0.04; }  // Flux 1.1 Pro one image

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article?.outline) throw new ArticlePipelineError(`Article missing outline`, "image");

    const outline = ArticleOutlineSchema.parse(article.outline);

    const result = await replicate.generateImage({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: `article-hero-${article.slug}`.slice(0, 80),
      model: "flux-1.1-pro",
      prompt: outline.heroImagePrompt,
      aspectRatio: "16:9",
      r2KeyHint: `articles/${article.slug}/hero`,
      estimatedCostEur: this.estimatedCostEur(),
    });

    // Generate alt text from the prompt + title (no LLM call needed; descriptive enough)
    const altText = `${outline.title} — ${outline.heroImagePrompt.slice(0, 100)}`;

    return {
      r2Key: result.r2Key,
      publicUrl: result.publicUrl,
      altText,
    };
  }
}
```

### Pipeline Step: Assembly

`packages/pipelines/src/article/steps/assembly.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles, projects } from "@marketing-auto/db";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  schemaJsonLd: z.record(z.unknown()),
});

export class AssemblyStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "assembly";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }  // Pure synthesis, no LLM/API

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article?.outline) throw new ArticlePipelineError(`Article missing outline`, "assembly");
    
    const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new ArticlePipelineError(`Project missing`, "assembly");

    const outline = ArticleOutlineSchema.parse(article.outline);

    // Build schema.org Article JSON-LD
    // Spec 21 (Astro adapter) uses this directly in the published article's <head>.
    const schemaJsonLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": outline.title,
      "description": outline.metaDescription,
      "image": article.heroImagePublicUrl,
      "datePublished": new Date().toISOString(),  // updated when actually published
      "dateModified": new Date().toISOString(),
      "author": {
        "@type": "Organization",
        "name": project.name,
      },
      "publisher": {
        "@type": "Organization",
        "name": project.name,
      },
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": `https://${project.slug}.example.com/${outline.slug}`,  // Spec 21 substitutes real domain
      },
    };

    return { schemaJsonLd };
  }
}
```

### Pipeline Step: PersistArticle

`packages/pipelines/src/article/steps/persist-article.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles } from "@marketing-auto/db";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  bodyMd: z.string(),
  wordCount: z.number(),
  heroR2Key: z.string(),
  heroPublicUrl: z.string().url(),
  heroAltText: z.string(),
  selfReviewScore: z.number(),
  selfReviewIssues: z.array(z.unknown()),
  schemaJsonLd: z.record(z.unknown()),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  wordCount: z.number(),
  selfReviewScore: z.number(),
});

export class PersistArticleStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-article";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    await db.update(articles).set({
      bodyMd: input.bodyMd,
      wordCount: input.wordCount,
      heroImageR2Key: input.heroR2Key,
      heroImagePublicUrl: input.heroPublicUrl,
      heroImageAltText: input.heroAltText,
      selfReviewScore: input.selfReviewScore,
      selfReviewIssues: input.selfReviewIssues,
      schemaJsonLd: input.schemaJsonLd,
      status: "final_review",
      draftPipelineRunId: ctx.pipelineRunId,
      updatedAt: new Date(),
    }).where(eq(articles.id, input.articleId));

    return {
      articleId: input.articleId,
      wordCount: input.wordCount,
      selfReviewScore: input.selfReviewScore,
    };
  }
}
```

### CLI Scripts

`apps/api/src/scripts/article/generate.ts`:

```typescript
#!/usr/bin/env bun
import { eq, and, inArray } from "drizzle-orm";
import { db, projects, articles, clusters } from "@marketing-auto/db";
import { enqueueArticleGeneration } from "@marketing-auto/pipelines/article";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cli:article-generate");

// Args parsing
const args = process.argv.slice(2);
const projectSlug = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--limit"));
const allApproved = args.includes("--all-approved");
const limitArg = args[args.indexOf("--limit") + 1];
const limit = limitArg ? parseInt(limitArg, 10) : undefined;
const approvalMode = args.includes("--auto") ? "auto" : "manual";
const cornerstoneSlug = args.find((a, i) => i === 0 && !a.startsWith("--"));

if (!projectSlug && !cornerstoneSlug) {
  console.error(`Usage:
  Single:  bun ... article:generate <cornerstone-keyword> [--auto]
  Batch:   bun ... article:generate --all-approved <project-slug> [--limit N] [--auto]`);
  process.exit(1);
}

if (allApproved) {
  // Batch mode
  const targetSlug = args.find((a, i) => a === "--all-approved" ? false : !a.startsWith("--"));
  if (!targetSlug) {
    console.error("--all-approved requires a project slug");
    process.exit(1);
  }
  const [project] = await db.select().from(projects).where(eq(projects.slug, targetSlug)).limit(1);
  if (!project) {
    console.error(`Project not found: ${targetSlug}`);
    process.exit(1);
  }

  // Find approved cornerstones across all clusters of this project
  const approvedCornerstones = await findApprovedCornerstones(project.id, limit);
  if (approvedCornerstones.length === 0) {
    console.log("No approved cornerstones found. Mark some via cluster-plan or cornerstone-list.");
    process.exit(0);
  }

  console.log(`🚀 Enqueuing ${approvedCornerstones.length} article(s)...`);
  for (const c of approvedCornerstones) {
    try {
      const result = await enqueueArticleGeneration({
        cornerstoneSlug: c,
        projectId: project.id,
        approvalMode,
      });
      console.log(`   ✓ ${c} → article ${result.articleId} (job ${result.outlineJobId})`);
    } catch (e) {
      console.error(`   ✗ ${c} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nMode: ${approvalMode}. ${approvalMode === "manual"
    ? "Run `article:continue <slug>` after reviewing each outline."
    : "Pipeline will auto-progress to draft on outline completion."}`);
  process.exit(0);
}

// Single mode
const cornerstone = cornerstoneSlug!;
// Resolve project from cornerstone — find which project's cornerstones include this keyword
const project = await findProjectForCornerstone(cornerstone);
if (!project) {
  console.error(`Cornerstone "${cornerstone}" not found in any approved cluster.`);
  process.exit(1);
}

const result = await enqueueArticleGeneration({
  cornerstoneSlug: cornerstone,
  projectId: project.id,
  approvalMode,
});

console.log(`✅ Enqueued article generation:
   Article ID: ${result.articleId}
   Job ID: ${result.outlineJobId}
   Mode: ${approvalMode}

Job 1 (research + outline) running in background. Check Drizzle Studio in ~2-3 min.

Next:
${approvalMode === "manual"
    ? `  After outline review: bun ... article:continue ${cornerstone}`
    : `  Job 2 (draft + image) auto-runs after Job 1 completes.`}`);
process.exit(0);

async function findApprovedCornerstones(projectId: string, limitN?: number): Promise<string[]> {
  const clustersData = await db.select().from(clusters).where(eq(clusters.projectId, projectId));
  const cornerstones: string[] = [];
  for (const c of clustersData) {
    if ((c.status as string) === "approved") {
      const ks = (c.cornerstoneKeywords as string[]) ?? [];
      cornerstones.push(...ks);
    }
  }
  // Filter out cornerstones that already have articles
  const existing = await db.select({ kw: articles.cornerstoneKeyword })
    .from(articles)
    .where(and(eq(articles.projectId, projectId), inArray(articles.status, ["generating", "outline_review", "drafting", "final_review", "ready_to_publish", "published"] as const)));
  const existingSet = new Set(existing.map((e) => e.kw));
  const toGenerate = cornerstones.filter((c) => !existingSet.has(c));
  return limitN ? toGenerate.slice(0, limitN) : toGenerate;
}

async function findProjectForCornerstone(cornerstone: string) {
  const allClusters = await db.select().from(clusters);
  for (const c of allClusters) {
    const ks = (c.cornerstoneKeywords as string[]) ?? [];
    if (ks.includes(cornerstone)) {
      const [p] = await db.select().from(projects).where(eq(projects.id, c.projectId)).limit(1);
      return p;
    }
  }
  return null;
}
```

`apps/api/src/scripts/article/continue.ts`:

```typescript
#!/usr/bin/env bun
import { eq, and } from "drizzle-orm";
import { db, articles, clusters, projects } from "@marketing-auto/db";
import { continueArticleGeneration } from "@marketing-auto/pipelines/article";

const cornerstone = process.argv[2];
if (!cornerstone) {
  console.error("Usage: bun ... article:continue <cornerstone-keyword>");
  process.exit(1);
}

// Find article by cornerstone keyword in outline_review state
const [article] = await db
  .select({ id: articles.id, projectId: articles.projectId, status: articles.status })
  .from(articles)
  .where(and(
    eq(articles.cornerstoneKeyword, cornerstone),
    eq(articles.status, "outline_review"),
  ))
  .limit(1);

if (!article) {
  console.error(`No article in "outline_review" state for cornerstone "${cornerstone}"`);
  process.exit(1);
}

const result = await continueArticleGeneration({
  articleId: article.id,
  projectId: article.projectId,
});

console.log(`✅ Continuation enqueued. Job ID: ${result.draftJobId}
Job 2 (draft + image + assembly) running in background. Check Drizzle Studio in ~5-8 min.`);
process.exit(0);
```

`apps/api/package.json`:
```json
"scripts": {
  ...
  "article:generate": "bun --env-file ../../.env src/scripts/article/generate.ts",
  "article:continue": "bun --env-file ../../.env src/scripts/article/continue.ts"
}
```

### HTTP Endpoint Stub (for Phase 4 Web App)

`apps/api/src/routes/articles.ts`:

```typescript
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, projects } from "@marketing-auto/db";
import { enqueueArticleGeneration, continueArticleGeneration } from "@marketing-auto/pipelines/article";

export const articleRoutes = new Hono();

const GenerateBodySchema = z.object({
  cornerstoneSlug: z.string(),
  approvalMode: z.enum(["manual", "auto"]).default("manual"),
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

articleRoutes.post("/projects/:projectSlug/articles/generate", async (c) => {
  // Auth: TODO Phase 4 — for now relies on session middleware from Spec 04
  const projectSlug = c.req.param("projectSlug");
  const body = GenerateBodySchema.parse(await c.req.json());

  const [project] = await db.select().from(projects).where(eq(projects.slug, projectSlug)).limit(1);
  if (!project) return c.json({ error: "Project not found" }, 404);

  try {
    const result = await enqueueArticleGeneration({
      cornerstoneSlug: body.cornerstoneSlug,
      projectId: project.id,
      approvalMode: body.approvalMode,
      ...(body.modelOverride && { modelOverride: body.modelOverride }),
    });
    return c.json(result, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

articleRoutes.post("/articles/:articleId/continue", async (c) => {
  const articleId = c.req.param("articleId");
  // TODO: verify article belongs to authenticated project
  // For now: load and infer projectId
  const [a] = await db.select({ projectId: articles.projectId })
    .from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!a) return c.json({ error: "Article not found" }, 404);

  try {
    const result = await continueArticleGeneration({
      articleId,
      projectId: a.projectId,
    });
    return c.json(result, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

import { articles } from "@marketing-auto/db";
```

Mount in `apps/api/src/index.ts`:
```typescript
import { articleRoutes } from "./routes/articles.ts";
// ...
app.route("/api", articleRoutes);
```

### Scheduler Worker (Implemented but Disabled by Default)

`apps/api/src/workers/article-scheduler.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Repeatable BullMQ job that picks N approved cornerstones per day,
 * enqueues their generation. Disabled by default — enable via
 * ARTICLE_SCHEDULER_ENABLED=true in environment.
 *
 * Schedule: configured per project; defaults to "every day at 03:00".
 */
import { Queue } from "bullmq";
import { eq, and, notInArray, inArray } from "drizzle-orm";
import { db, projects, articles, clusters } from "@marketing-auto/db";
import { enqueueArticleGeneration } from "@marketing-auto/pipelines/article";
import { getEnv, createLogger } from "@marketing-auto/shared";

const log = createLogger("article-scheduler");
const env = getEnv();

if (!env.ARTICLE_SCHEDULER_ENABLED) {
  log.info("ARTICLE_SCHEDULER_ENABLED is false — scheduler disabled");
  process.exit(0);
}

const PER_PROJECT_DAILY_LIMIT = 2;  // safety cap; configurable per project later

// Set up the repeatable job (idempotent — won't duplicate)
const queue = new Queue("article-scheduler", {
  connection: { url: env.REDIS_URL },
});

await queue.add(
  "daily-tick",
  {},
  {
    repeat: { pattern: "0 3 * * *" },  // 03:00 daily
    jobId: "scheduler-daily-tick",
  },
);

// Worker
import { Worker } from "bullmq";
new Worker(
  "article-scheduler",
  async () => {
    log.info("Daily scheduler tick");
    const allProjects = await db.select().from(projects);
    for (const p of allProjects) {
      try {
        const cornerstones = await pickNextCornerstones(p.id, PER_PROJECT_DAILY_LIMIT);
        for (const c of cornerstones) {
          await enqueueArticleGeneration({
            cornerstoneSlug: c,
            projectId: p.id,
            approvalMode: "manual",  // scheduler always uses manual; auto-mode requires explicit opt-in
          });
          log.info({ project: p.slug, cornerstone: c }, "Auto-enqueued by scheduler");
        }
      } catch (e) {
        log.error({ err: e, project: p.slug }, "Scheduler failed for project");
      }
    }
  },
  { connection: { url: env.REDIS_URL } },
);

async function pickNextCornerstones(projectId: string, limit: number): Promise<string[]> {
  // Same logic as CLI batch mode
  const clustersData = await db.select().from(clusters)
    .where(and(eq(clusters.projectId, projectId), eq(clusters.status, "approved")));
  const all: string[] = [];
  for (const c of clustersData) {
    all.push(...((c.cornerstoneKeywords as string[]) ?? []));
  }
  const existing = await db.select({ kw: articles.cornerstoneKeyword })
    .from(articles)
    .where(and(
      eq(articles.projectId, projectId),
      inArray(articles.status, ["generating", "outline_review", "drafting", "final_review", "ready_to_publish", "published"] as const),
    ));
  const existingSet = new Set(existing.map((e) => e.kw));
  return all.filter((c) => !existingSet.has(c)).slice(0, limit);
}
```

`packages/shared/src/config.ts` — add to envSchema:
```typescript
ARTICLE_SCHEDULER_ENABLED: z.coerce.boolean().default(false),
```

## Acceptance Criteria

### Schema
- [ ] `articles` table has all fields described above
- [ ] `articleStatusEnum` includes all 11 states
- [ ] Migration runs cleanly, no FK errors
- [ ] `cluster_id` and `cornerstone_spec_id` FKs work

### Service Layer
- [ ] `enqueueArticleGeneration()` creates article row, enqueues outline job, returns IDs
- [ ] `continueArticleGeneration()` requires `outline_review` state, transitions to `drafting`
- [ ] Both functions handle "already in progress" gracefully (don't double-enqueue)

### Outline Pipeline (Job 1)
- [ ] Runs end-to-end: TopicIntake → Research → Outline → PersistOutline
- [ ] Writes outline JSON to `articles.outline`, sets status `outline_review`
- [ ] Cost-logs written for: 1 DataForSEO SERP, 1 Anthropic synthesis, 1 Anthropic outline
- [ ] If `approvalMode = "auto"`: ArticleDraftPipeline auto-enqueued at end
- [ ] If `approvalMode = "manual"`: pipeline ends, no further enqueue

### Draft Pipeline (Job 2)
- [ ] Runs end-to-end: TopicIntake → Draft → SelfReview → HeroImage → Assembly → PersistArticle
- [ ] Writes complete article to DB, sets status `final_review`
- [ ] Cost-logs written for: 1 Anthropic draft, 1 Haiku self-review, 1 Replicate image
- [ ] Hero image lands in R2 with public URL accessible
- [ ] Self-review score and issues persisted

### CLI
- [ ] `article:generate <slug>` enqueues single, prints article+job IDs
- [ ] `article:generate --all-approved <project-slug> --limit 3` enqueues up to 3
- [ ] `article:continue <slug>` finds article in outline_review and enqueues Job 2
- [ ] `--auto` flag passes through correctly
- [ ] All commands exit 0 on success, non-zero on error

### HTTP Endpoint
- [ ] `POST /api/projects/:slug/articles/generate` returns 202 with article+job IDs
- [ ] `POST /api/articles/:id/continue` returns 202
- [ ] Both endpoints validate input via Zod
- [ ] Both endpoints handle errors (404 for missing project/article, 400 for state errors)

### Scheduler
- [ ] Disabled by default (no env flag = no scheduler)
- [ ] When enabled: registers repeatable job
- [ ] Picks up to PER_PROJECT_DAILY_LIMIT cornerstones per project
- [ ] Skips cornerstones with in-progress or published articles

### Cost & Resilience
- [ ] Cost limit exceeded throws CostLimitExceeded before LLM call
- [ ] BullMQ retries failed jobs up to 3× with exponential backoff
- [ ] DraftStep with word_count < 500 throws ArticlePipelineError
- [ ] All errors include `stage` field for debugging

## Testing Strategy

For Spec 20, **integration tests are gated** — Marcel runs them locally when ready, not in CI:
- `RUN_LIVE_ARTICLE_PIPELINE=1` enables live tests against real APIs
- Total cost: ~€1.30 for one full pipeline (Anthropic outline + draft + review + image + DataForSEO)

Unit tests (run always):
- `topic-intake.test.ts`: DB-only, mock article+cluster, verify shape
- `assembly.test.ts`: pure synthesis, verify schema.org structure
- `persist-outline.test.ts`: DB writes, verify status transition
- `self-review.test.ts`: skip without live (requires Anthropic call)

Live integration test (gated):
```bash
RUN_LIVE_ARTICLE_PIPELINE=1 bun --filter @marketing-auto/pipelines test article
```
Tests:
1. Create test project + cluster + cornerstone
2. Run full pipeline manually (Job 1, then Job 2)
3. Verify all DB fields populated
4. Verify hero image accessible at public URL
5. Verify cost_logs match expected pattern
6. Cleanup

## Open Questions / Decisions Made

**Decision 1: Two BullMQ jobs (not one with internal pause).**
Cleaner semantics — Job 1 ends, possibly enqueues Job 2. No long-lived pause states inside BullMQ. Fits BullMQ's worker model better.

**Decision 2: `approvalMode` is a per-article column, not a per-project setting.**
Marcel might want auto-mode for batch-generated low-stakes articles, manual for cornerstones. Per-article allows granular control.

**Decision 3: Self-review uses Haiku, not Sonnet.**
Reviewing is pattern-matching. Haiku catches voice drift and structural issues at 1/10 the cost. Saves €0.30/article × 30 articles/month = €9/month. Adds up.

**Decision 4: Outline uses Opus 4.7, draft uses Sonnet 4.6.**
Outline mistakes propagate; Opus is worth the €0.20 premium. Drafting from a good outline is template-following; Sonnet is sufficient and 5× cheaper.

**Decision 5: No autonomous self-correction loop.**
If self-review finds critical issues, the article is persisted with status `final_review` and `selfReviewScore < 70`. Marcel decides whether to regenerate (re-run Job 2) or fix manually. We do NOT auto-trigger a "rewrite" pipeline — that's a Spec 23+ enhancement.

**Decision 6: TopicIntakeStep runs in BOTH Job 1 and Job 2.**
Job 2 is a fresh BullMQ job — it has no in-memory context from Job 1. Re-loading project + cluster is cheap (DB queries). Cleaner than passing 5KB of context through the queue.

**Decision 7: Scheduler always uses manual approvalMode.**
Auto-mode is opt-in per command/HTTP-call. The scheduler should not silently auto-publish — too risky.

**Decision 8: Schema.org JSON-LD generated in Spec 20.**
Even though Spec 21 (Astro adapter) is what actually injects it into HTML, the JSON-LD object is content metadata, belongs with the article. Spec 21 just renders it.

**Decision 9: Hero image uses Flux 1.1 Pro (highest quality).**
Cornerstone articles deserve the better model. €0.04 vs €0.01 (Schnell) is irrelevant when each article costs €1+ total.

**Decision 10: Internal links explicitly skipped.**
Outline and draft prompts mention "do not generate internal links" so the LLM doesn't invent placeholder anchors. Spec 24 will add them properly cluster-wide.

**Decision 11: Slug generated by Outline step, not by intake.**
The LLM produces a better slug given the title than a naive slugification of the cornerstone keyword. Initial DB row uses cornerstone-as-slug; outline step UPDATEs to the LLM-chosen slug.

**Decision 12: HTTP endpoints stub-implemented (not 501).**
Even though we won't test them until Phase 4, having functional endpoints means Phase 4 Web App work is purely UI; no backend changes needed. The endpoints already work via `curl` if someone wants to test.

## Implementation Order

This spec is large. **Recommend 4-5 sessions.**

**Session 1: Schema + service layer + types (~3-4h)**
1. Verify `articles` schema (Spec 01) and extend with missing fields
2. Update `articleStatusEnum`
3. Generate + apply migration
4. Create `packages/pipelines/src/article/types.ts`
5. Create `packages/pipelines/src/article/trigger.ts` with both functions
6. Add deps to package.json (already-present adapter packages, plus any missing)
7. Typecheck passes
8. Commit: `feat(article): schema + service layer (spec 20)`

**Session 2: Job 1 (Outline Pipeline) (~4-5h)**
1. Implement TopicIntakeStep
2. Implement ResearchStep
3. Implement OutlineStep
4. Implement PersistOutlineStep
5. Wire ArticleOutlinePipeline with bridges
6. Implement `article:generate` CLI for single mode
7. Manual smoke test: create test article, run pipeline, verify outline in DB
8. Commit: `feat(article): outline pipeline (job 1) (spec 20)`

**Session 3: Job 2 (Draft Pipeline) (~5-6h)**
1. Implement DraftStep
2. Implement SelfReviewStep
3. Implement HeroImageStep
4. Implement AssemblyStep
5. Implement PersistArticleStep
6. Wire ArticleDraftPipeline with bridges
7. Implement `article:continue` CLI
8. Manual smoke test: continue the test article from Session 2, verify full output
9. Commit: `feat(article): draft pipeline (job 2) (spec 20)`

**Session 4: Batch + scheduler + HTTP endpoints (~3-4h)**
1. Extend `article:generate` for batch mode
2. Implement scheduler worker (disabled by default)
3. Implement HTTP endpoints
4. Mount routes in apps/api
5. Manual test of batch mode (with --limit 1 to keep costs low)
6. Verify scheduler does NOT run when env flag absent
7. Commit: `feat(article): batch + scheduler + http endpoints (spec 20)`

**Session 5: Tests + Acceptance Criteria pass (~3-4h)**
1. Write unit tests for non-LLM steps
2. Write live integration test (gated by env flag)
3. Run full live integration test once (cost ~€1.30)
4. Verify all acceptance criteria pass
5. Commit: `test(article): unit + live integration tests (spec 20)`

**Total**: 18-23 hours of compute time. Live test cost: ~€1.30.

## Splitting Plan

See "Implementation Order" — five sessions with `/clear` between each.

## Discovered During Implementation

**Session 1:**

1. **`clusters` table required new columns.** Cold-start pipelines write `cornerstone_keyword` and `satellite_keywords` to markdown files only — they were never synced to the DB clusters table. Added `pillar` (text, denormalized name for TopicIntakeStep), `cornerstoneKeywords` (jsonb `string[]`), and `satelliteKeywords` (jsonb `SatelliteKeywordEntry[]`) to clusters in the same migration. Session 2 should include a cold-start sync helper that populates these from markdown DATA blocks.

2. **`drizzle-kit generate`/`push` are interactive.** Column rename detection requires a real TTY. In any non-interactive context they stall. When the schema has many rename candidates, write migration SQL manually and append to `_journal.json` — the `migrate` script only needs those two things.

3. **PostgreSQL enum drop requires dropping the column DEFAULT first.** `DROP TYPE article_status` fails with "other objects depend on it" even after `ALTER COLUMN SET DATA TYPE text` because the column default still holds a type reference. Order: `DROP DEFAULT` → `SET DATA TYPE text` → `DROP TYPE` → `CREATE TYPE` → `SET DATA TYPE new_enum` → restore default.

4. **`content.ts` ↔ `operations.ts` circular dependency.** `operations.ts` already imports `articles` from `content.ts`. Adding `.references(() => pipelineRuns.id)` on `outlinePipelineRunId`/`draftPipelineRunId` from `content.ts` would create a cycle. Stored as plain UUIDs instead (no DB-level FK).

5. **`afterComplete` errors must not re-trigger BullMQ retries.** If `afterComplete` throws inside the runner's main try-catch, BullMQ retries the whole job and re-runs expensive LLM steps. The runner wraps `afterComplete` in its own try-catch that logs a warning without failing the job.

## Deviations

**Session 1:**

1. **`enqueuePipeline` signature.** Spec shows `enqueuePipeline(PipelineClass, input, opts)`. Actual engine API is `enqueuePipeline({ pipelineName, projectId, input, jobOptions? })`. `trigger.ts` uses the actual API with literal pipeline names `"article:outline"` / `"article:draft"`.

2. **`slugify` umlaut order.** Spec calls NFD normalize before umlaut expansion — this silently collapses `ä→a` instead of `ä→ae`. Correct order in implementation: umlaut expansion first, then NFD strip.

3. **`outlinePipelineRunId`/`draftPipelineRunId` are plain UUIDs, not FK columns.** See discovery #4 above.

4. **`afterComplete` wrapped in separate try-catch.** Spec doesn't address failure handling for the auto-continue hook. Implementation wraps it so failures are logged without re-triggering pipeline retries.
