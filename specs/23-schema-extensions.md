# Spec 23: Schema.org Extensions

**Phase:** 3 (Volume Production for KI-Wissensraum)
**Estimated Effort:** 1 day (1-2 sessions)
**Dependencies:** Spec 20 (article pipeline — `AssemblyStep` already produces basic `Article` JSON-LD), Spec 21 (astro-sync — picks up the JSON-LD via `articles.schemaJsonLd`)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (template-y JSON-LD generation, no architectural complexity)

---

## Goal

Extend the basic `Article` Schema.org JSON-LD that Spec 20 generates with three additional rich-result types:

1. **`BreadcrumbList`** — for every article (always emitted)
2. **`FAQPage`** — when the article has a Q&A section (auto-detected)
3. **`HowTo`** — when the article describes a step-by-step procedure (auto-detected)

These are **separate JSON-LD scripts** in the rendered HTML. Astro's `<Schema>` slot pattern handles multiple `<script type="application/ld+json">` blocks naturally.

The output goes into the existing `articles.schemaJsonLd` JSONB column (we change its shape from a single object to an array of objects). Spec 21's RenderMdxStep already picks this up — the rendered MDX includes whatever JSON-LD is in there.

**Why this matters**: Google rewards rich-snippet eligibility with bigger SERP real estate. An article with valid `FAQPage` markup gets an expanded SERP entry showing FAQ questions inline. `HowTo` markup gets step-by-step listings. `BreadcrumbList` shows the parent path instead of the URL. All three are zero-effort wins for organic traffic.

## What "auto-detection" means

For FAQ and HowTo, we need to decide whether the rendered article qualifies. Three approaches:

**A) LLM-based** — Anthropic call: "Does this article have a FAQ section? A HowTo section? Extract them as structured data." High accuracy, ~€0.05/article.

**B) Pattern-based** — Regex on the bodyMd: heading pattern `## FAQ` or `## Häufige Fragen` for FAQ; ordered lists with imperative starts for HowTo. Free, but brittle.

**C) Outline-aware** — Spec 20's `OutlineStep` already produces structured H2 sections with `intent` fields. We add a step in Spec 20's outline that explicitly tags sections as `intent: "faq"` or `intent: "howto"`. Then Spec 23 reads those tags. Free, but requires Spec 20 changes.

**Decision: A (LLM-based)**.

Reasoning: pattern matching breaks on German-language variations (`FAQ`, `Häufige Fragen`, `Antworten auf häufige Fragen`, etc.) and HowTo detection is genuinely a semantic task (an ordered list isn't necessarily a HowTo — it could be ranking steps, history, etc.). €0.05 per article is irrelevant when each article costs €1.30 total. Spec 20 changes (option C) couple Spec 23 too tightly to outline structure.

## Where this runs

Spec 23 is a **post-processor** that runs:
- AFTER Spec 20's `PersistArticleStep` (article body is finalized)
- BEFORE Spec 21's `enqueueArticleSync` (so the sync picks up the enhanced schema)

Two trigger options:
- **Auto** (chosen): Spec 20's `PersistArticleStep` enqueues Spec 23 at the end. Marcel doesn't need to remember.
- **Manual**: separate CLI command. Rejected because forgetting it = articles published without rich snippets, which silently degrades SEO.

The auto-trigger is added in Spec 20 via a small modification (one line in `afterComplete`).

## Non-Goals

- **No `Product` markup** — we don't have product data on articles
- **No `Recipe` markup** — KI-Wissensraum has no recipes; Bellemann/Balkonkraftwerk maybe later
- **No `VideoObject` markup** — no embedded videos at this stage
- **No `Review` markup** — separate concern
- **No `Course` markup** — even though some articles teach, "Course" implies enrollment/completion which we don't model
- **No automatic `Author` extraction** — Author profile is its own thing (deferred to backlog), not handled here
- **No regeneration of articles** to better fit schemas — we work with what Spec 20 produced

## Lifecycle (with Spec 23 inserted)

```
final_review                       (Spec 20 finished)
   ↓ Spec 20's PersistArticleStep auto-enqueues Spec 23
schema_extending                   ← NEW intermediate state
   ↓ Spec 23 finishes
final_review                       ← back to original; ready for sync
   ↓ Marcel runs article:sync
ready_to_publish                   (Spec 21 commits)
   ...
```

The `schema_extending` state is brief (~10s) and added to the enum. If Spec 23 fails, the article reverts to `final_review` with whatever basic schema Spec 20 set — so Marcel can still sync (graceful degradation).

## Detailed Implementation

### Schema additions

**Add to `articleStatusEnum`**:
```typescript
"schema_extending",  // NEW: Spec 23 in progress
```

**Change shape of `articles.schemaJsonLd`** from `Record<string, unknown>` (single object) to **array of JSON-LD objects**. Migration: existing rows wrap their object in an array.

```typescript
schemaJsonLd: jsonb("schema_json_ld").$type<Array<Record<string, unknown>>>().default([]),
```

Manual migration SQL needed (per Spec 14/20/21 lessons on Drizzle limitations):

```sql
-- Wrap existing objects in arrays
UPDATE articles
SET schema_json_ld = jsonb_build_array(schema_json_ld)
WHERE schema_json_ld IS NOT NULL AND jsonb_typeof(schema_json_ld) = 'object';
```

**New table** `schema_extension_runs` for audit:

```typescript
export const schemaExtensionRuns = pgTable("schema_extension_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  articleId: uuid("article_id").notNull(),
  pipelineRunId: uuid("pipeline_run_id"),

  status: text("status").$type<"pending" | "succeeded" | "failed">().notNull(),
  detectedTypes: jsonb("detected_types").$type<{
    breadcrumb: boolean;
    faq: boolean;
    howto: boolean;
  } | null>().default(null),

  faqQuestionCount: integer("faq_question_count").default(0),
  howtoStepCount: integer("howto_step_count").default(0),

  errorMessage: text("error_message"),
  errorStage: text("error_stage").$type<"detect" | "build" | "persist" | null>(),

  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (table) => ({
  articleIdx: index("schema_extension_runs_article_idx").on(table.articleId),
}));
```

### Package Setup

We add this to the existing `pipelines` package rather than creating a new adapter, because:
- It depends on `adapter-anthropic` (LLM detection)
- It writes to DB via `adapter-db` only (no external service)
- It's a pipeline transformation, not an external integration

`packages/pipelines/src/schema-extension/`:
```
├── index.ts
├── pipeline.ts
├── trigger.ts
├── types.ts
└── steps/
    ├── load-article.ts
    ├── detect-rich-types.ts
    ├── build-jsonld.ts
    └── persist-schema.ts
```

### Types

`packages/pipelines/src/schema-extension/types.ts`:

```typescript
import { z } from "zod";

// ───── FAQ ───────────────────────────────────────────────────────────────────

export const FaqQuestionSchema = z.object({
  question: z.string().min(5).max(300),
  answer: z.string().min(10).max(2000),
});
export type FaqQuestion = z.infer<typeof FaqQuestionSchema>;

// ───── HowTo ─────────────────────────────────────────────────────────────────

export const HowToStepSchema = z.object({
  name: z.string().min(3).max(200),
  text: z.string().min(10).max(1000),
});
export type HowToStep = z.infer<typeof HowToStepSchema>;

// ───── Detection result ──────────────────────────────────────────────────────

export const DetectionResultSchema = z.object({
  hasFaq: z.boolean(),
  hasHowTo: z.boolean(),
  faqQuestions: z.array(FaqQuestionSchema).default([]),
  howToSteps: z.array(HowToStepSchema).default([]),
  /** "name" of the howto sequence, e.g. "Claude API einrichten" */
  howToName: z.string().nullable().default(null),
  /** Estimated total time, ISO 8601 duration like "PT15M" */
  howToTotalTime: z.string().nullable().default(null),
});
export type DetectionResult = z.infer<typeof DetectionResultSchema>;

// ───── Errors ────────────────────────────────────────────────────────────────

export class SchemaExtensionError extends Error {
  constructor(
    message: string,
    public readonly stage: "load" | "detect" | "build" | "persist",
    public readonly originalCause?: unknown,
  ) {
    super(message);
    this.name = "SchemaExtensionError";
  }
}
```

### Pipeline Step: LoadArticle

`packages/pipelines/src/schema-extension/steps/load-article.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles, projects, clusters } from "@marketing-auto/db";
import { SchemaExtensionError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
});

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    metaDescription: z.string(),
    bodyMd: z.string(),
    schemaJsonLd: z.array(z.record(z.unknown())),  // existing array, may have just Article
    heroImagePublicUrl: z.string().url(),
  }),
  project: z.object({
    slug: z.string(),
    name: z.string(),
    domain: z.string(),  // e.g. "kiwissenraum.de" — used for breadcrumb URLs
  }),
  cluster: z.object({
    name: z.string(),
    pillar: z.string(),
  }).nullable(),
});

export class LoadArticleStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "load-article";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new SchemaExtensionError(`Article ${input.articleId} not found`, "load");

    if (article.status !== "schema_extending" && article.status !== "final_review") {
      throw new SchemaExtensionError(
        `Article status "${article.status}", expected "schema_extending" or "final_review"`,
        "load",
      );
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, article.projectId)).limit(1);
    if (!project) throw new SchemaExtensionError(`Project not found`, "load");

    let cluster: { name: string; pillar: string } | null = null;
    if (article.clusterId) {
      const [c] = await db.select().from(clusters).where(eq(clusters.id, article.clusterId)).limit(1);
      if (c) cluster = { name: c.name, pillar: c.pillar ?? "general" };
    }

    return {
      article: {
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        title: article.title!,
        metaDescription: article.metaDescription ?? "",
        bodyMd: article.bodyMd!,
        schemaJsonLd: (article.schemaJsonLd as Array<Record<string, unknown>>) ?? [],
        heroImagePublicUrl: article.heroImagePublicUrl!,
      },
      project: {
        slug: project.slug,
        name: project.name,
        domain: project.publishDomain ?? `${project.slug}.example.com`,
      },
      cluster,
    };
  }
}
```

Note: `project.publishDomain` is a column we should ensure exists. If not, add it as part of this spec's migration. Default to `<slug>.example.com` for projects without domains set.

### Pipeline Step: DetectRichTypes (LLM)

`packages/pipelines/src/schema-extension/steps/detect-rich-types.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { DetectionResultSchema } from "../types.ts";

const InputSchema = z.object({
  bodyMd: z.string(),
  title: z.string(),
  projectSlug: z.string(),
});

export class DetectRichTypesStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof DetectionResultSchema>
> {
  readonly name = "detect-rich-types";
  readonly inputSchema = InputSchema;
  readonly outputSchema = DetectionResultSchema as z.ZodType<z.infer<typeof DetectionResultSchema>>;
  // ZodType cast per Spec 21 lesson #6 — DetectionResultSchema has .default([]) on arrays

  override estimatedCostEur(): number { return 0.05; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const prompt = await buildSystemPrompt({
      skills: ["schema-markup", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are analyzing an article to determine which Schema.org rich-result types it qualifies for.

Two types to evaluate:

1. **FAQPage**: Article qualifies if it has a clear Q&A section with at least 3 distinct
   questions. Each question must:
   - Be phrased as a question (or as a heading clearly answering an implicit question)
   - Have a complete, self-contained answer below it
   - Cover something the reader might genuinely search for
   Common section names: "FAQ", "Häufige Fragen", "Antworten auf...", explicit H2/H3
   questions like "Wie installiere ich X?" with answer paragraphs.

2. **HowTo**: Article qualifies if it describes a SEQUENTIAL, ACTIONABLE procedure
   that achieves a specific outcome. Must have:
   - A clear goal (the "name" of the howto)
   - Numbered or clearly ordered steps (3+)
   - Imperative or actionable language ("Click X", "Run command Y", "Klicken Sie auf...")
   - NOT just a list of considerations or alternatives
   - NOT a comparison ranking ("Top 5 X")
   - NOT historical chronology

Output STRICT JSON matching:
{
  "hasFaq": boolean,
  "hasHowTo": boolean,
  "faqQuestions": [{ "question": string, "answer": string }, ...],
  "howToSteps": [{ "name": string, "text": string }, ...],
  "howToName": string | null,
  "howToTotalTime": string | null  // ISO 8601 like "PT15M" if estimable, else null
}

Rules:
- If hasFaq is false, faqQuestions MUST be []
- If hasHowTo is false, howToSteps MUST be [], howToName MUST be null, howToTotalTime MUST be null
- Question text: 5-300 chars, use the original wording from the article when possible
- Answer text: 10-2000 chars, condensed prose (markdown stripped). For long answers, summarize
  the key answer in 2-3 sentences — do NOT include the full article body.
- howToSteps "name": short imperative (e.g. "Install dependencies"), max 200 chars
- howToSteps "text": detailed instruction, 10-1000 chars
- Be CONSERVATIVE. False positives hurt: a non-FAQ article wrongly tagged as FAQ gets
  rejected by Google's Rich Results Test. Better to return false than guess.
      `,
    });

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "schema-rich-detection",
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: [
        `# Article title`,
        input.title,
        ``,
        `# Article body`,
        input.bodyMd,
        ``,
        `Detect rich-result types per the rules above.`,
      ].join("\n"),
      maxTokens: 4000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return DetectionResultSchema.parse(result.json);
  }
}
```

### Pipeline Step: BuildJsonLd

`packages/pipelines/src/schema-extension/steps/build-jsonld.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { type DetectionResult } from "../types.ts";

const InputSchema = z.object({
  article: z.object({
    title: z.string(),
    slug: z.string(),
    metaDescription: z.string(),
    schemaJsonLd: z.array(z.record(z.unknown())),  // existing schemas (Spec 20's Article)
    heroImagePublicUrl: z.string().url(),
  }),
  project: z.object({
    slug: z.string(),
    name: z.string(),
    domain: z.string(),
  }),
  cluster: z.object({
    name: z.string(),
    pillar: z.string(),
  }).nullable(),
  detection: z.object({
    hasFaq: z.boolean(),
    hasHowTo: z.boolean(),
    faqQuestions: z.array(z.object({ question: z.string(), answer: z.string() })),
    howToSteps: z.array(z.object({ name: z.string(), text: z.string() })),
    howToName: z.string().nullable(),
    howToTotalTime: z.string().nullable(),
  }),
});

const OutputSchema = z.object({
  schemaJsonLd: z.array(z.record(z.unknown())),
  addedTypes: z.array(z.enum(["BreadcrumbList", "FAQPage", "HowTo"])),
});

export class BuildJsonLdStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "build-jsonld";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const baseUrl = `https://${input.project.domain}`;
    const articleUrl = `${baseUrl}/blog/${input.article.slug}`;

    const additions: Array<Record<string, unknown>> = [];
    const addedTypes: Array<"BreadcrumbList" | "FAQPage" | "HowTo"> = [];

    // 1. BreadcrumbList — always
    additions.push(buildBreadcrumb({
      baseUrl,
      articleTitle: input.article.title,
      articleUrl,
      cluster: input.cluster,
    }));
    addedTypes.push("BreadcrumbList");

    // 2. FAQPage — if detected
    if (input.detection.hasFaq && input.detection.faqQuestions.length >= 3) {
      additions.push(buildFaqPage(input.detection.faqQuestions));
      addedTypes.push("FAQPage");
    }

    // 3. HowTo — if detected
    if (input.detection.hasHowTo && input.detection.howToSteps.length >= 3 && input.detection.howToName) {
      additions.push(buildHowTo({
        name: input.detection.howToName,
        steps: input.detection.howToSteps,
        totalTime: input.detection.howToTotalTime,
        heroImageUrl: input.article.heroImagePublicUrl,
      }));
      addedTypes.push("HowTo");
    }

    // Replace any existing entries of the SAME @type in the schemaJsonLd
    // (re-running this step shouldn't duplicate Breadcrumbs)
    const existingMinusOurs = input.article.schemaJsonLd.filter((s) => {
      const t = (s["@type"] as string) ?? "";
      return !addedTypes.includes(t as "BreadcrumbList" | "FAQPage" | "HowTo");
    });

    return {
      schemaJsonLd: [...existingMinusOurs, ...additions],
      addedTypes,
    };
  }
}

// ───── Builders ───────────────────────────────────────────────────────────────

function buildBreadcrumb(input: {
  baseUrl: string;
  articleTitle: string;
  articleUrl: string;
  cluster: { name: string; pillar: string } | null;
}): Record<string, unknown> {
  const items: Array<Record<string, unknown>> = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: input.baseUrl,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Blog",
      item: `${input.baseUrl}/blog`,
    },
  ];

  let position = 3;
  if (input.cluster) {
    items.push({
      "@type": "ListItem",
      position,
      name: input.cluster.name,
      item: `${input.baseUrl}/cluster/${slugify(input.cluster.name)}`,
    });
    position++;
  }

  items.push({
    "@type": "ListItem",
    position,
    name: input.articleTitle,
    item: input.articleUrl,
  });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

function buildFaqPage(questions: Array<{ question: string; answer: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answer,
      },
    })),
  };
}

function buildHowTo(input: {
  name: string;
  steps: Array<{ name: string; text: string }>;
  totalTime: string | null;
  heroImageUrl: string;
}): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: input.name,
    image: input.heroImageUrl,
    step: input.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
  if (input.totalTime) obj.totalTime = input.totalTime;
  return obj;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
```

Note: per Spec 20 lesson #7 (Slugify-Order), umlauts before NFD.

### Pipeline Step: PersistSchema

`packages/pipelines/src/schema-extension/steps/persist-schema.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles, schemaExtensionRuns } from "@marketing-auto/db";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  schemaJsonLd: z.array(z.record(z.unknown())),
  detection: z.object({
    hasFaq: z.boolean(),
    hasHowTo: z.boolean(),
    faqQuestions: z.array(z.unknown()),
    howToSteps: z.array(z.unknown()),
  }),
  addedTypes: z.array(z.string()),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  schemaCount: z.number(),
  schemaExtensionRunId: z.string().uuid(),
});

export class PersistSchemaStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-schema";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const now = new Date();

    await db.update(articles).set({
      schemaJsonLd: input.schemaJsonLd,
      status: "final_review",  // back to where we came from
      updatedAt: now,
    }).where(eq(articles.id, input.articleId));

    const [run] = await db.insert(schemaExtensionRuns).values({
      projectId: input.projectId,
      articleId: input.articleId,
      pipelineRunId: ctx.pipelineRunId ?? null,
      status: "succeeded",
      detectedTypes: {
        breadcrumb: true,
        faq: input.detection.hasFaq,
        howto: input.detection.hasHowTo,
      },
      faqQuestionCount: input.detection.faqQuestions.length,
      howtoStepCount: input.detection.howToSteps.length,
      finishedAt: now,
    }).returning();

    return {
      articleId: input.articleId,
      schemaCount: input.schemaJsonLd.length,
      schemaExtensionRunId: run!.id,
    };
  }
}
```

### Pipeline Definition

`packages/pipelines/src/schema-extension/pipeline.ts`:

```typescript
import { z } from "zod";
import { Pipeline } from "../engine/pipeline.ts";
import { LoadArticleStep } from "./steps/load-article.ts";
import { DetectRichTypesStep } from "./steps/detect-rich-types.ts";
import { BuildJsonLdStep } from "./steps/build-jsonld.ts";
import { PersistSchemaStep } from "./steps/persist-schema.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  schemaCount: z.number(),
  schemaExtensionRunId: z.string().uuid(),
});

export class SchemaExtensionPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "article:schema-extension";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new LoadArticleStep(),
    new DetectRichTypesStep(),
    new BuildJsonLdStep(),
    new PersistSchemaStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof InputSchema>,
    getStepOutput: <T = unknown>(name: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "load-article" && toStep.name === "detect-rich-types") {
      const out = output as { article: { bodyMd: string; title: string }; project: { slug: string } };
      return {
        bodyMd: out.article.bodyMd,
        title: out.article.title,
        projectSlug: out.project.slug,
      };
    }
    if (fromStep.name === "detect-rich-types" && toStep.name === "build-jsonld") {
      const load = getStepOutput<{ article: unknown; project: unknown; cluster: unknown }>("load-article")!;
      return {
        article: load.article,
        project: load.project,
        cluster: load.cluster,
        detection: output,
      };
    }
    if (fromStep.name === "build-jsonld" && toStep.name === "persist-schema") {
      const load = getStepOutput<{ article: { id: string } }>("load-article")!;
      const detection = getStepOutput<{ hasFaq: boolean; hasHowTo: boolean; faqQuestions: unknown[]; howToSteps: unknown[] }>("detect-rich-types")!;
      const built = output as { schemaJsonLd: Array<Record<string, unknown>>; addedTypes: string[] };
      return {
        articleId: load.article.id,
        projectId: pipelineInput.projectId,
        schemaJsonLd: built.schemaJsonLd,
        addedTypes: built.addedTypes,
        detection: {
          hasFaq: detection.hasFaq,
          hasHowTo: detection.hasHowTo,
          faqQuestions: detection.faqQuestions,
          howToSteps: detection.howToSteps,
        },
      };
    }
    return output;
  }

  /**
   * If anything failed, revert article status from `schema_extending` back to `final_review`
   * so Marcel can still sync (graceful degradation).
   */
  override async afterError(error: unknown, pipelineInput: z.infer<typeof InputSchema>): Promise<void> {
    try {
      const { db, articles } = await import("@marketing-auto/db");
      const { eq } = await import("drizzle-orm");
      await db.update(articles).set({
        status: "final_review",
        updatedAt: new Date(),
      }).where(eq(articles.id, pipelineInput.articleId));
    } catch (e) {
      // Cleanup failure shouldn't retry the pipeline (Spec 20 lesson #6)
    }
  }
}
```

### Service Layer

`packages/pipelines/src/schema-extension/trigger.ts`:

```typescript
import { eq } from "drizzle-orm";
import { db, articles } from "@marketing-auto/db";
import { enqueuePipeline } from "../engine/runner.ts";

export async function enqueueSchemaExtension(input: {
  articleId: string;
  projectId: string;
}): Promise<{ jobId: string }> {
  const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
  if (!article) throw new Error(`Article ${input.articleId} not found`);

  if (article.status !== "final_review" && article.status !== "schema_extending") {
    throw new Error(
      `Article status "${article.status}", expected "final_review" or "schema_extending"`,
    );
  }

  // Transition to schema_extending
  await db.update(articles).set({
    status: "schema_extending",
    updatedAt: new Date(),
  }).where(eq(articles.id, input.articleId));

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:schema-extension",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    jobOptions: { jobId: `schema-extension-${input.articleId}` },
  });

  return { jobId };
}
```

### Integration with Spec 20

Modify Spec 20's `ArticleDraftPipeline` to auto-enqueue Schema Extension after `PersistArticleStep`:

```typescript
// packages/pipelines/src/article/pipeline.ts (modify existing)

import { enqueueSchemaExtension } from "../schema-extension/trigger.ts";

export class ArticleDraftPipeline extends Pipeline<...> {
  // ... existing code ...

  override async afterComplete(
    output: z.infer<typeof DraftOutputSchema>,
    pipelineInput: z.infer<typeof DraftInputSchema>,
  ): Promise<void> {
    // Existing afterComplete logic stays here, then:
    try {
      await enqueueSchemaExtension({
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      });
    } catch (e) {
      // Schema extension failure shouldn't retry the whole article pipeline (Spec 20 lesson #6)
      console.error(`Schema extension enqueue failed for ${pipelineInput.articleId}:`, e);
    }
  }
}
```

### CLI Script (for manual re-runs)

`apps/api/src/scripts/article/extend-schema.ts`:

```typescript
#!/usr/bin/env bun
import { eq } from "drizzle-orm";
import { db, articles } from "@marketing-auto/db";
import { enqueueSchemaExtension } from "@marketing-auto/pipelines/schema-extension";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: bun ... article:extend-schema <article-slug>");
  process.exit(1);
}

const all = await db.select({
  id: articles.id,
  projectId: articles.projectId,
  status: articles.status,
}).from(articles).where(eq(articles.slug, slug));

if (all.length === 0) {
  console.error(`No article found with slug "${slug}"`);
  process.exit(1);
}
const article = all[0]!;

const result = await enqueueSchemaExtension({
  articleId: article.id,
  projectId: article.projectId,
});

console.log(`✅ Schema extension enqueued
   Article ID: ${article.id}
   Job ID: ${result.jobId}

Pipeline will detect FAQ/HowTo content and add Schema.org rich types.
Cost: ~€0.05 (Anthropic detection call).`);
process.exit(0);
```

Add to `apps/api/package.json`:
```json
"article:extend-schema": "bun --env-file ../../.env src/scripts/article/extend-schema.ts"
```

## Acceptance Criteria

### Schema
- [ ] `article_status` includes `schema_extending`
- [ ] `articles.schemaJsonLd` is now `Array<Record<string, unknown>>`
- [ ] Migration wraps existing `schemaJsonLd` objects in single-element arrays
- [ ] `schema_extension_runs` table exists with FK cascade

### Detection accuracy
- [ ] Article with explicit "## FAQ" section + 5 questions → `hasFaq: true`, 5 questions extracted
- [ ] Article with "## Häufige Fragen" → same
- [ ] Article that's just an explainer (no Q&A) → `hasFaq: false, faqQuestions: []`
- [ ] Article with "Schritt 1, Schritt 2, Schritt 3" tutorial → `hasHowTo: true`, steps extracted
- [ ] Article with "Top 5 Tools" list → `hasHowTo: false` (not actionable, just ranking)

### JSON-LD output
- [ ] BreadcrumbList always present, with cluster path if cluster exists
- [ ] FAQPage present iff `hasFaq && faqQuestions.length >= 3`
- [ ] HowTo present iff `hasHowTo && howToSteps.length >= 3 && howToName != null`
- [ ] Re-running the pipeline doesn't duplicate types (existing entries replaced)
- [ ] All JSON-LD validates as Schema.org (Marcel: paste output into Google's Rich Results Test)

### Integration
- [ ] Spec 20's `ArticleDraftPipeline` auto-triggers Spec 23 after persist
- [ ] Article transitions: final_review → schema_extending → final_review (after success)
- [ ] On Spec 23 failure: article reverts to `final_review` (graceful degradation)
- [ ] Spec 21 (`article:sync`) picks up the array of JSON-LD objects
- [ ] CLI `article:extend-schema <slug>` works for manual re-runs

### Errors
- [ ] Article in wrong status → clear error
- [ ] Anthropic detection fails → afterError reverts status, BullMQ retries

## Testing Strategy

**Unit tests**:
- `BuildJsonLdStep` with mocked detection inputs (test BreadcrumbList, FAQPage, HowTo builders)
- Slugify with German characters

**Integration test** (gated by `RUN_LIVE_SCHEMA_EXTENSION=1`):
1. Create test article with known FAQ section
2. Run pipeline
3. Assert: schemaJsonLd has 2 entries (Article from Spec 20 + BreadcrumbList + FAQPage = 3)
4. Verify FAQ questions match input
   Cost: €0.05 per run.

**Validation test** (manual):
- After running on a real article, paste the article URL into Google's Rich Results Test
  (https://search.google.com/test/rich-results)
- Verify all detected types are recognized

## Open Questions / Decisions Made

**Decision 1: LLM-based detection, not pattern-based.**
Per discussion above. Cost is €0.05/article — irrelevant.

**Decision 2: Auto-trigger from Spec 20, not manual.**
Forgetting to extend schema = silent SEO degradation. Auto-trigger ensures every article gets it.

**Decision 3: Convert `schemaJsonLd` from object to array.**
Multiple JSON-LD scripts per page is the standard Google-recommended pattern. Migration is one-time.

**Decision 4: Replace, don't append.**
Re-running the pipeline replaces our types (BreadcrumbList, FAQPage, HowTo) but keeps existing
`Article` from Spec 20 untouched. This makes re-runs idempotent.

**Decision 5: Conservative detection thresholds.**
- FAQ requires ≥3 questions (Google guidance: at least 3 for FAQPage to be eligible)
- HowTo requires ≥3 steps and a name
- Below thresholds → don't emit. Better silent than invalid markup.

**Decision 6: BreadcrumbList always emitted, even without cluster.**
Falls back to Home → Blog → Article. No cluster = 3 levels instead of 4.

**Decision 7: HowTo without `image` field would be incomplete.**
Schema.org HowTo benefits significantly from a top-level image. We use the article's hero image.

**Decision 8: HowTo `totalTime` is optional.**
LLM may return null if it can't estimate. We don't force it.

**Decision 9: Graceful degradation on failure.**
If LLM detection fails or any step throws, article reverts to `final_review` with whatever
schemas existed before. The article can still be synced; it just won't have rich types this round.
Marcel can re-run via CLI.

**Decision 10: No special handling for very short articles.**
Articles under 500 words won't realistically have 3+ FAQ questions OR 3+ HowTo steps —
detection will return false naturally. No need for length-based bypass.

**Decision 11: One LLM call covers both FAQ + HowTo detection.**
Could split into two calls for clarity, but one call is cheaper and the prompt handles both
clearly. Output schema enforces the constraint that hasFaq=false → empty faqQuestions, etc.

**Decision 12: `project.publishDomain` may need adding.**
If not present, this spec adds it. Default = `<slug>.example.com` (placeholder). Marcel can
edit to real domain via Drizzle Studio. Spec 21 already needs this for the `mainEntityOfPage`
schema field; if it's missing there too, this spec fixes it for both.

## Implementation Order

**Recommend 2 sessions.**

**Session 1: Schema migration + standalone pipeline (~3-4h)**
1. Migration: enum + schemaJsonLd shape + new table + projects.publishDomain (if missing)
2. `types.ts`, all step files, pipeline definition
3. Trigger function
4. CLI script
5. Manual test: pick an article in `final_review`, run CLI, verify schema array
6. Commit: `feat(schema-extension): pipeline + cli (spec 23)`

**Session 2: Spec 20 integration + tests (~2-3h)**
1. Modify Spec 20's `ArticleDraftPipeline.afterComplete` to enqueue Spec 23
2. Test end-to-end: generate new article via Spec 20, verify Spec 23 auto-runs
3. Verify graceful degradation: artificially fail Spec 23, verify article reverts to final_review
4. Run validation test: actual article through Google's Rich Results Test
5. Commit: `feat(schema-extension): auto-trigger + integration test (spec 23)`

Total: 5-7 hours. Cost per article: €0.05.

## Splitting Plan

See "Implementation Order" — 2 sessions with `/clear` between.

## Discovered During Implementation

- **Adapter ripple when column type changes**: Changing `articles.schemaJsonLd` from `Record<string,unknown>` to `Array<Record<string,unknown>>` required updating `inputSchema`/`outputSchema` in two astro-sync adapter steps (`load-article.ts`, `render-mdx.ts`) and one integration test fixture. When changing a JSONB column's TypeScript type, grep for every step that declares the column in its own local Zod schema — they're invisible to the DB package typecheck until the adapter is type-checked too.

- **`afterComplete` has no `StepContext`**: Unlike step `execute()`, the `afterComplete` hook receives only `(output, pipelineInput)` — no logger from context. A module-level `createLogger()` is required in `pipeline.ts` to get structured logging in that hook.

- **`PersistArticleStep` wraps Assembly output in array**: `AssemblyStep` still produces a single `Record<string,unknown>` Article JSON-LD. `PersistArticleStep` wraps it as `[input.schemaJsonLd]` when writing to the now-array column. `SchemaExtensionPipeline` then reads the array and appends BreadcrumbList/FAQPage/HowTo entries. This is the intended handoff pattern.

## Deviations

- **`project.publishDomain` → `project.domain`**: The spec described adding a `publishDomain` column to projects, but `projects.domain` already existed from the foundation schema. `LoadArticleStep` uses `project.domain` directly with a `<slug>.example.com` fallback. No new column was added.
