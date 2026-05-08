# Spec 45+46: Multi-Language Article Generation

**Phase:** Marketing-Tool feature add — multi-language content pipeline
**Estimated Effort:** 8-10 hours (1 session, structured into 5 sections)
**Dependencies:**
- Spec 14 (cold-start pipeline)
- Spec 15 (article generation pipeline)
- Spec 21 (astro-sync — DE+EN both push via same adapter)
- Spec 44+45 (imported articles + translationKey schema foundation)
  **Status:** Ready for implementation
  **Recommended Model:** Opus 4.7 (cross-system: DB schema + pipeline refactor + API + Vue UI)
  **Repos affected:** marketing-tool (DB + pipelines + api + web)

---

## Context

The Marketing-Tool currently generates articles in DE only. Cornerstone-Specs come out of `cold-start/04-cornerstone-list/` as plain objects (not persisted), then `articles` rows are inserted directly in DE.

For toolwiki and future projects, articles need to be generated in **both DE and EN as first-class citizens** — not as translations of one another, but as **locale-native content** sharing a `translationKey` and cluster identity.

The toolwiki repo already shows the desired pattern:
- Each Cluster (e.g. "AI Image Generation") has 2 cornerstone articles: one DE, one EN
- They share a `translationKey` (e.g. `cluster-{uuid}-anyword-test`)
- They have **different slugs**, **different bodies**, **different titles** — locale-native
- They cross-link via `translationKey` (sitemap hreflang, language switcher)

The DB foundation for `translationKey` was added in Spec 44+45 (imported articles), but **generated articles** don't yet use it. This spec wires it in for the generation flow.

## Goal

After this spec:
- **Cornerstone-Specs are persisted** in their own `cornerstone_specs` table (currently they're inline objects in pipeline output).
- **Each Cluster has 1+ Cornerstone-Spec per locale** (DE + EN are required for toolwiki, optional in future projects).
- **Cornerstone-list-Pipeline generates DE+EN parallel** via 2 LLM-calls per cluster, sharing a `translationKey`.
- **Article-Generation triggers parallel DE+EN runs** when a cornerstone-pair is approved.
- **All article-pipeline-steps are locale-aware** (prompts, research-queries, slug-generation, etc.).
- **Frontend cornerstone approval UI shows DE+EN side-by-side**.

## Non-Goals

- **No translation between locales** — DE and EN are independently generated; LLM doesn't translate one into the other.
- **No cross-locale internal-linking** — internal links stay within locale (Spec 24 stays unchanged for now).
- **No removal of existing single-locale article generation** — the API endpoint for `enqueueArticleGeneration` stays, but is deprecated. New flows use `enqueueClusterArticleGeneration` (creates pair).
- **No locale-aware schema-extension or pagespeed validation** — those run per-article, locale doesn't matter.
- **No retroactive multi-language conversion** — existing single-locale generated articles stay as they are. New cornerstones use the new flow.
- **No cluster-level locale config** — if a project supports both DE and EN, all clusters in that project produce both. Per-cluster opt-out is future spec.

## Pre-flight

```bash
cd <marketing-tool-repo>
git status --porcelain   # clean

# Confirm Spec 44+45 is merged
git log --oneline | head -5
# Should show "feat: astro repo import (spec 44+45)" or similar

bun test 2>&1 | tail -5  # green

git checkout -b feature/45-46-multi-language
```

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Cluster (locale-neutral)                                        │
│   - name, pillar                                                 │
│   - cornerstoneKeyword (the canonical concept-keyword)           │
└────────┬─────────────────────────────────────────────────────────┘
         │ has 1 or 2
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  CornerstoneSpec (locale-specific)                              │
│   - clusterId, locale, translationKey                            │
│   - proposedTitle, proposedSlug, metaDescription                 │
│   - h2Outline, estimatedWordCount                                │
│   - status: proposed → approved → in_generation → article_done   │
│   UNIQUE (clusterId, locale)                                     │
└────────┬─────────────────────────────────────────────────────────┘
         │ produces 1
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Article (locale-specific, links via cornerstoneSpecId)         │
│   - cornerstoneSpecId, locale, translationKey                    │
│   - existing fields: title, slug, bodyMd, ...                    │
└──────────────────────────────────────────────────────────────────┘
```

**Pair-validation invariant**: For a project that supports DE+EN, every cluster must have **exactly 2 cornerstone-specs** (one per locale) before it's "complete". This is enforced application-side, not via DB constraint.

## Splitting Plan

5 sections, each with its own acceptance criteria. Designed for `/start-task /review-task` workflow (one section per task).

```
Section A — DB schema foundation        ~1.5h    [task: 45-46.1-schema]
Section B — Cornerstone-list pipeline   ~2h      [task: 45-46.2-cornerstone]
Section C — Article-generation pipeline ~2.5h    [task: 45-46.3-article]
Section D — API endpoints                ~1h      [task: 45-46.4-api]
Section E — Frontend approval UI         ~2h      [task: 45-46.5-frontend]
```

Each section commits separately on `feature/45-46-multi-language` branch and can be reviewed independently.

---

## Section A — DB Schema Foundation

**Goal**: Persist cornerstone-specs as a proper table, link clusters and articles to them, enforce locale-pair invariants.

### A.1 Files modified

- `packages/db/src/schema/_enums.ts` — add `cornerstoneSpecStatusEnum`, optionally extend `articleStatusEnum`
- `packages/db/src/schema/content.ts` — new `cornerstoneSpecs` table; updates to `articles` and `clusters`
- `packages/db/migrations/####_*.sql` — manual migration (drizzle-kit-generate is non-TTY incompatible per Spec 44 finding)
- `packages/db/migrations/meta/_journal.json` — manual entry for new migration

### A.2 New table: `cornerstone_specs`

```typescript
// packages/db/src/schema/_enums.ts
export const cornerstoneSpecStatusEnum = pgEnum("cornerstone_spec_status", [
  "proposed",        // generated, awaiting marcel approval
  "approved",        // marcel approved, ready for article generation
  "in_generation",   // article-pipeline running
  "article_done",    // article was generated, this spec is consumed
  "rejected",        // marcel rejected — won't be regenerated
]);

// packages/db/src/schema/content.ts
export const cornerstoneSpecs = pgTable(
  "cornerstone_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),

    // Locale + pair identity
    locale: text("locale").notNull(),  // 'de' | 'en'
    translationKey: text("translation_key").notNull(),  // shared with pendant

    // Content (from LLM generation)
    cornerstoneKeyword: text("cornerstone_keyword").notNull(),
    proposedTitle: text("proposed_title").notNull(),
    proposedSlug: text("proposed_slug").notNull(),
    metaDescription: text("meta_description").notNull(),
    estimatedWordCount: integer("estimated_word_count").notNull(),
    h2Outline: jsonb("h2_outline").$type<string[]>().notNull(),

    // Lifecycle
    status: cornerstoneSpecStatusEnum("status").notNull().default("proposed"),
    rejectedReason: text("rejected_reason"),

    // Article correlation (set when article is created)
    articleId: uuid("article_id"),  // no FK to avoid circular dep with articles

    // Pipeline correlation
    cornerstoneListPipelineRunId: uuid("cornerstone_list_pipeline_run_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Each cluster has at most 1 cornerstone per locale
    clusterLocaleUnique: uniqueIndex("cornerstone_specs_cluster_locale_unique").on(
      t.clusterId,
      t.locale
    ),
    // Translation pair lookup
    translationKeyIdx: index("cornerstone_specs_translation_key_idx").on(
      t.projectId,
      t.translationKey
    ),
    // Status filtering for approval UI
    projectStatusIdx: index("cornerstone_specs_project_status_idx").on(
      t.projectId,
      t.status
    ),
    clusterIdIdx: index("cornerstone_specs_cluster_id_idx").on(t.clusterId),
  })
);
```

### A.3 Articles updates

`articles.cornerstoneSpecId` exists already (as orphan UUID). Add an index for cornerstone-spec → article lookup:

```typescript
// In articles table definition, add to index callback:
cornerstoneSpecIdx: index("articles_cornerstone_spec_id_idx").on(t.cornerstoneSpecId),
```

**Important**: After this spec, `articles.cornerstoneSpecId` is the canonical link. It remains a plain UUID without FK (avoids circular deps with `cornerstoneSpecs.articleId`).

### A.4 Clusters updates

No schema changes — `clusters` stays locale-neutral.

But `clusters` will have **derived** locale-pair completion status — a SQL view or app-level computation:

```typescript
// In clusters CRUD utilities (existing or new file):
export async function getClusterPairCompleteness(clusterId: string) {
  const specs = await db
    .select({ locale: cornerstoneSpecs.locale })
    .from(cornerstoneSpecs)
    .where(eq(cornerstoneSpecs.clusterId, clusterId));
  return {
    hasDe: specs.some((s) => s.locale === "de"),
    hasEn: specs.some((s) => s.locale === "en"),
    isComplete: specs.length === 2,
  };
}
```

### A.5 Manual migration SQL

`packages/db/migrations/0XXX_multilang_cornerstone_specs.sql`:

```sql
-- Create enum first
CREATE TYPE "public"."cornerstone_spec_status" AS ENUM (
  'proposed', 'approved', 'in_generation', 'article_done', 'rejected'
);

-- Create cornerstone_specs table
CREATE TABLE IF NOT EXISTS "cornerstone_specs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "cluster_id" uuid NOT NULL REFERENCES "clusters"("id") ON DELETE CASCADE,
  "locale" text NOT NULL,
  "translation_key" text NOT NULL,
  "cornerstone_keyword" text NOT NULL,
  "proposed_title" text NOT NULL,
  "proposed_slug" text NOT NULL,
  "meta_description" text NOT NULL,
  "estimated_word_count" integer NOT NULL,
  "h2_outline" jsonb NOT NULL,
  "status" "cornerstone_spec_status" NOT NULL DEFAULT 'proposed',
  "rejected_reason" text,
  "article_id" uuid,
  "cornerstone_list_pipeline_run_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "cornerstone_specs_cluster_locale_unique"
  ON "cornerstone_specs" ("cluster_id", "locale");
CREATE INDEX "cornerstone_specs_translation_key_idx"
  ON "cornerstone_specs" ("project_id", "translation_key");
CREATE INDEX "cornerstone_specs_project_status_idx"
  ON "cornerstone_specs" ("project_id", "status");
CREATE INDEX "cornerstone_specs_cluster_id_idx"
  ON "cornerstone_specs" ("cluster_id");

-- Articles: add index for cornerstone_spec_id lookup
CREATE INDEX IF NOT EXISTS "articles_cornerstone_spec_id_idx"
  ON "articles" ("cornerstone_spec_id");
```

Update `_journal.json` manually (add new migration entry, increment idx).

### A.6 Section A Acceptance Criteria

- [ ] `cornerstoneSpecStatusEnum` exists with 5 values
- [ ] `cornerstone_specs` table created with all columns
- [ ] Unique index `(cluster_id, locale)` enforced
- [ ] 3 lookup indexes created
- [ ] `articles_cornerstone_spec_id_idx` added
- [ ] Migration SQL applies cleanly
- [ ] `bun test` green (no existing test broken)
- [ ] No code changes to pipelines yet — those come in Section B+C
- [ ] Commit: `feat(db): add cornerstone_specs table for multi-language pairs (45-46.1)`

---

## Section B — Cornerstone-List Pipeline (Multi-Language)

**Goal**: Generate DE+EN cornerstone-specs in parallel, persist them with shared `translationKey`, replace the inline articles-insert.

### B.1 Files modified

- `packages/pipelines/src/cold-start/04-cornerstone-list/steps.ts` — extend `GenerateCornerstoneSpecsStep` to do 2 LLM-calls per cluster (DE+EN); update zod schemas
- `packages/pipelines/src/cold-start/04-cornerstone-list/pipeline.ts` — replace `afterComplete` to insert into `cornerstoneSpecs` (not `articles` directly)
- `packages/pipelines/src/cold-start/shared/translation-key.ts` — new helper for `translationKey` generation

### B.2 TranslationKey generator

```typescript
// packages/pipelines/src/cold-start/shared/translation-key.ts

/**
 * Generates a stable, system-controlled translation key for a cornerstone-pair.
 * Format: cluster-{shortClusterId}-{slugifiedKeyword}
 *
 * The shortClusterId is the first 8 chars of the cluster UUID. This is
 * sufficient for project-scoped uniqueness (collision probability << 1e-6
 * for projects with <100k clusters). The keyword-slug provides readability.
 *
 * Example:
 *   clusterId: "a1b2c3d4-..."
 *   keyword: "Anyword Test"
 *   → "cluster-a1b2c3d4-anyword-test"
 */
export function generateTranslationKey(input: {
  clusterId: string;
  cornerstoneKeyword: string;
}): string {
  const shortId = input.clusterId.split("-")[0]!;  // first 8 hex chars
  const slug = slugifyKeyword(input.cornerstoneKeyword);
  return `cluster-${shortId}-${slug}`;
}

function slugifyKeyword(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);  // cap length
}
```

### B.3 Cornerstone-Spec generation: parallel DE+EN

Update `GenerateCornerstoneSpecsStep` to produce locale-specific specs:

```typescript
// packages/pipelines/src/cold-start/04-cornerstone-list/steps.ts

export const LocaleAwareCornerstoneSpecSchema = CornerstoneSpecSchema.extend({
  locale: z.enum(["de", "en"]),
  cluster_id: z.string().uuid(),
  translation_key: z.string(),
});

export type LocaleAwareCornerstoneSpec = z.infer<typeof LocaleAwareCornerstoneSpecSchema>;

const GenerateCornerstoneSpecsOutputSchemaV2 = z.object({
  specs: z.array(LocaleAwareCornerstoneSpecSchema).min(2),  // at minimum 1 cluster × 2 locales
});

export class GenerateCornerstoneSpecsStep extends BaseStep<
  { projectSlug: string; approvedClusters: ApprovedCluster[]; locales: ("de" | "en")[] },
  z.infer<typeof GenerateCornerstoneSpecsOutputSchemaV2>
> {
  readonly name = "generate-cornerstone-specs";
  readonly inputSchema = z.object({
    projectSlug: z.string(),
    approvedClusters: z.array(ApprovedClusterSchema).min(1),
    locales: z.array(z.enum(["de", "en"])).min(1),  // typically ["de", "en"]
  });
  readonly outputSchema = GenerateCornerstoneSpecsOutputSchemaV2;

  override estimatedCostEur(input: {
    approvedClusters: ApprovedCluster[];
    locales: ("de" | "en")[];
  }): number {
    return input.approvedClusters.length * input.locales.length * 0.08;
  }

  async execute(
    input: {
      projectSlug: string;
      approvedClusters: ApprovedCluster[];
      locales: ("de" | "en")[];
    },
    ctx: StepContext
  ): Promise<z.infer<typeof GenerateCornerstoneSpecsOutputSchemaV2>> {
    // For each cluster × each locale, generate a cornerstone-spec.
    // Parallel execution to minimize wall-clock time.

    const allSpecs: LocaleAwareCornerstoneSpec[] = [];

    for (const cluster of input.approvedClusters) {
      const localePromises = input.locales.map((locale) =>
        this.generateForLocale(input.projectSlug, cluster, locale, ctx)
      );
      const localeResults = await Promise.all(localePromises);

      // Generate ONE translation_key shared by all locales of this cluster
      const translationKey = generateTranslationKey({
        clusterId: cluster.id ?? "tmp",  // cluster.id may not exist yet, fallback handled in afterComplete
        cornerstoneKeyword: cluster.cornerstone_keyword,
      });

      for (const r of localeResults) {
        allSpecs.push({
          ...r.spec,
          locale: r.locale,
          cluster_id: cluster.id ?? "tmp",
          translation_key: translationKey,
        });
      }
    }

    return { specs: allSpecs };
  }

  private async generateForLocale(
    projectSlug: string,
    cluster: ApprovedCluster,
    locale: "de" | "en",
    ctx: StepContext
  ): Promise<{ locale: "de" | "en"; spec: CornerstoneSpec }> {
    const localeInstructions = locale === "de"
      ? "Output is for the **German market** (de-DE). Title, meta, slug, and outline must be in German. Use German SEO keyword conventions (often longer, compound nouns)."
      : "Output is for the **English/global market** (en-US). Title, meta, slug, and outline must be in English. Use English SEO keyword conventions (often shorter, more direct)."

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "content-strategy", "ai-seo"],
      projectIdOrSlug: projectSlug,
      stepInstructions: `
You are producing a cornerstone article specification for ONE cluster, in ONE locale.

${localeInstructions}

Cluster:
- Name: ${cluster.name}
- Pillar: ${cluster.pillar}
- Cornerstone keyword: ${cluster.cornerstone_keyword}

Produce ONE locale-native spec — not a translation, but a from-scratch piece written for the target market.

Output JSON matching: { cornerstone_keyword, proposed_title, proposed_slug, meta_description (max 160), estimated_word_count (>=500), h2_outline (3-12 items), status: "proposed" }

The cornerstone_keyword field should reflect the locale-native keyword (e.g. DE: "KI-Bildgenerierung", EN: "AI image generation").
The slug should be locale-native (e.g. DE: "ki-bildgenerierung", EN: "ai-image-generation").
The outline should reflect locale-native SEO patterns (DE often has longer h2s, EN more direct).
`,
    });

    // ... existing Anthropic call structure, response-parse with CornerstoneSpecSchema ...
    const spec = await callAnthropicJson({
      systemPrompt: prompt,
      schema: CornerstoneSpecSchema,
      pipelineRunId: ctx.pipelineRunId,
      costOp: COST_OPS.cornerstone_spec_generation,
    });

    return { locale, spec };
  }
}
```

### B.4 Persist cornerstone-specs (replace afterComplete)

```typescript
// packages/pipelines/src/cold-start/04-cornerstone-list/pipeline.ts
import { cornerstoneSpecs, db, projects, clusters } from "@marketing-auto/db";
import { generateTranslationKey } from "../shared/translation-key.ts";

// ... existing imports ...

export class CornerstoneListPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "cold-start:cornerstone-list";

  // Update InputSchema to include locales
  readonly inputSchema = z.object({
    projectSlug: z.string(),
    approvedClusters: z.array(ApprovedClusterSchema).min(1),
    projectId: z.string().optional(),
    locales: z.array(z.enum(["de", "en"])).default(["de", "en"]),
  });

  readonly outputSchema = z.object({
    specs: z.array(LocaleAwareCornerstoneSpecSchema).min(1),
  });

  readonly steps = [new GenerateCornerstoneSpecsStep()] as const;

  override async afterComplete(
    output: z.infer<typeof OutputSchema>,
    input: z.infer<typeof InputSchema>
  ): Promise<void> {
    const projectId =
      input.projectId ??
      (
        await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.slug, input.projectSlug))
          .limit(1)
      )[0]?.id;
    if (!projectId) {
      log.warn({ projectSlug: input.projectSlug }, "Project not found");
      return;
    }

    // Group specs by cluster (so we can resolve cluster_id once and use the
    // same translationKey for both locales of the same cluster)
    const specsByCornerstoneKw = new Map<string, LocaleAwareCornerstoneSpec[]>();
    for (const s of output.specs) {
      const key = s.cornerstone_keyword;
      const arr = specsByCornerstoneKw.get(key) ?? [];
      arr.push(s);
      specsByCornerstoneKw.set(key, arr);
    }

    for (const [keyword, specsForKeyword] of specsByCornerstoneKw) {
      // Look up cluster by cornerstone_keyword + projectId
      const [cluster] = await db
        .select({ id: clusters.id })
        .from(clusters)
        .where(
          and(eq(clusters.projectId, projectId), eq(clusters.cornerstoneKeyword, keyword))
        )
        .limit(1);

      if (!cluster) {
        log.warn({ keyword, projectId }, "Cluster not found for cornerstone_keyword");
        continue;
      }

      // Compute translationKey once for this cluster (all locales share it)
      const translationKey = generateTranslationKey({
        clusterId: cluster.id,
        cornerstoneKeyword: keyword,
      });

      for (const s of specsForKeyword) {
        try {
          await db
            .insert(cornerstoneSpecs)
            .values({
              projectId,
              clusterId: cluster.id,
              locale: s.locale,
              translationKey,
              cornerstoneKeyword: s.cornerstone_keyword,
              proposedTitle: s.proposed_title,
              proposedSlug: s.proposed_slug,
              metaDescription: s.meta_description,
              estimatedWordCount: s.estimated_word_count,
              h2Outline: s.h2_outline,
              status: "proposed",
            })
            .onConflictDoNothing();  // (clusterId, locale) unique → idempotent
        } catch (err) {
          log.warn(
            { err, slug: s.proposed_slug, locale: s.locale },
            "Failed to insert cornerstone spec"
          );
        }
      }
    }
  }
}
```

### B.5 Section B Acceptance Criteria

- [ ] `generateTranslationKey()` helper exists and produces stable keys
- [ ] `GenerateCornerstoneSpecsStep` accepts `locales` input
- [ ] Step generates 1 spec per (cluster × locale) — for default `["de", "en"]`, that's 2 specs per cluster
- [ ] Each spec is independently generated via locale-aware prompt (not a translation)
- [ ] `afterComplete` persists into `cornerstone_specs` table (NOT `articles`)
- [ ] Pair-locale-specs share the same `translationKey`
- [ ] `(clusterId, locale)` unique constraint prevents duplicates on retry
- [ ] Existing tests still pass; new test: full cluster-list pipeline run produces N×2 cornerstone-specs in DB
- [ ] Commit: `feat(pipelines): cold-start cornerstone-list generates DE+EN pairs (45-46.2)`

---

## Section C — Article-Generation Pipeline (Multi-Language)

**Goal**: Article generation accepts a `cornerstoneSpecId` (locale-specific) and is fully locale-aware. Approving a cornerstone-pair triggers 2 parallel article-pipeline-runs.

### C.1 Files modified

- `packages/pipelines/src/article/trigger.ts` — replace `enqueueArticleGeneration` cornerstone-slug input with `cornerstoneSpecId`; add `enqueueClusterArticleGeneration` for pair-trigger
- `packages/pipelines/src/article/steps/topic-intake.ts` — read locale + translationKey from cornerstoneSpec, set on article
- `packages/pipelines/src/article/steps/research.ts` — pass locale to research-prompt
- `packages/pipelines/src/article/steps/outline.ts` — pass locale to outline-prompt
- `packages/pipelines/src/article/steps/draft.ts` — pass locale to draft-prompt
- `packages/pipelines/src/article/steps/hero-image.ts` — locale-aware alt-text
- `packages/pipelines/src/article/steps/persist-article.ts` — set `locale`, `translationKey`, `cornerstoneSpecId` on article row
- `packages/pipelines/src/prompts/builder.ts` — accept `locale` param, inject `(de-DE)` or `(en-US)` market context
- `packages/db/src/schema/content.ts` — `articles.cornerstoneSpecId` becomes the canonical link (no schema change, just usage)

### C.2 Trigger refactor

```typescript
// packages/pipelines/src/article/trigger.ts

export type EnqueueArticleGenerationInput = {
  /** Cornerstone-spec UUID — already locale-specific. */
  cornerstoneSpecId: string;
  projectId: string;
  approvalMode?: "manual" | "auto";
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
};

/**
 * Enqueue article generation for ONE cornerstone-spec (one locale).
 * Caller is responsible for triggering both DE and EN if the cluster has both.
 *
 * Use `enqueueClusterArticleGeneration` to enqueue the full DE+EN pair at once.
 */
export async function enqueueArticleGeneration(
  input: EnqueueArticleGenerationInput
): Promise<EnqueueArticleGenerationResult> {
  const [spec] = await db
    .select()
    .from(cornerstoneSpecs)
    .where(
      and(
        eq(cornerstoneSpecs.id, input.cornerstoneSpecId),
        eq(cornerstoneSpecs.projectId, input.projectId)
      )
    )
    .limit(1);

  if (!spec) {
    throw new Error(`Cornerstone-spec ${input.cornerstoneSpecId} not found`);
  }
  if (spec.status === "in_generation" || spec.status === "article_done") {
    throw new Error(
      `Cornerstone-spec ${input.cornerstoneSpecId} already in/past generation (status: ${spec.status})`
    );
  }
  if (spec.status === "rejected") {
    throw new Error(`Cornerstone-spec ${input.cornerstoneSpecId} is rejected`);
  }

  // Existing or new article row for this spec
  let articleId: string;
  const existing = spec.articleId
    ? await db.select().from(articles).where(eq(articles.id, spec.articleId)).limit(1)
    : [];

  if (existing.length > 0) {
    const e = existing[0]!;
    if (e.status === "generating" || e.status === "drafting") {
      throw new Error(
        `Article ${e.id} for spec ${input.cornerstoneSpecId} already in progress`
      );
    }
    articleId = e.id;
    await db
      .update(articles)
      .set({
        status: "generating",
        approvalMode: input.approvalMode ?? "manual",
        updatedAt: new Date(),
      })
      .where(eq(articles.id, articleId));
  } else {
    const [created] = await db
      .insert(articles)
      .values({
        projectId: input.projectId,
        clusterId: spec.clusterId,
        cornerstoneSpecId: spec.id,
        slug: spec.proposedSlug,
        cornerstoneKeyword: spec.cornerstoneKeyword,
        title: spec.proposedTitle,
        metaDescription: spec.metaDescription,
        locale: spec.locale,
        translationKey: spec.translationKey,
        source: "generated",
        collection: "blog",  // Spec 47 will make this dynamic
        status: "generating",
        approvalMode: input.approvalMode ?? "manual",
      })
      .returning({ id: articles.id });
    articleId = created!.id;
    await db
      .update(cornerstoneSpecs)
      .set({ articleId, status: "in_generation", updatedAt: new Date() })
      .where(eq(cornerstoneSpecs.id, spec.id));
  }

  const { jobId } = await enqueueArticleOutlinePipeline({
    articleId,
    projectId: input.projectId,
    modelOverride: input.modelOverride,
  });

  return { articleId, outlineJobId: jobId, status: "outline_enqueued" };
}

/**
 * Enqueue article generation for the FULL DE+EN pair of a cluster.
 * Looks up both cornerstone-specs (must be approved), then enqueues
 * 2 parallel article-pipelines.
 */
export async function enqueueClusterArticleGeneration(input: {
  clusterId: string;
  projectId: string;
  approvalMode?: "manual" | "auto";
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
}): Promise<{
  results: Array<EnqueueArticleGenerationResult & { locale: string }>;
}> {
  const specs = await db
    .select()
    .from(cornerstoneSpecs)
    .where(
      and(
        eq(cornerstoneSpecs.clusterId, input.clusterId),
        eq(cornerstoneSpecs.projectId, input.projectId),
        eq(cornerstoneSpecs.status, "approved")
      )
    );

  if (specs.length === 0) {
    throw new Error(
      `No approved cornerstone-specs for cluster ${input.clusterId}. Approve specs first.`
    );
  }

  // Enqueue all in parallel
  const results = await Promise.all(
    specs.map(async (spec) => {
      const r = await enqueueArticleGeneration({
        cornerstoneSpecId: spec.id,
        projectId: input.projectId,
        approvalMode: input.approvalMode,
        modelOverride: input.modelOverride,
      });
      return { ...r, locale: spec.locale };
    })
  );

  return { results };
}
```

### C.3 Locale propagation through pipeline steps

Every article-pipeline step that calls Anthropic needs to know the locale. The key change: the article row already has `locale` set at insert-time (Section C.2), so each step just reads it.

```typescript
// packages/pipelines/src/article/steps/topic-intake.ts
// Output now includes locale (was previously implicit DE):
export const TopicIntakeOutputSchema = z.object({
  cornerstoneKeyword: z.string(),
  clusterName: z.string(),
  clusterPillar: z.string(),
  satelliteKeywords: z.array(z.string()),
  projectSlug: z.string(),
  approvalMode: z.enum(["manual", "auto"]),
  locale: z.enum(["de", "en"]),               // NEW
  translationKey: z.string(),                 // NEW
});

// Inside execute(): load article including locale + translationKey
const [article] = await db
  .select({
    cornerstoneKeyword: articles.cornerstoneKeyword,
    clusterId: articles.clusterId,
    locale: articles.locale,
    translationKey: articles.translationKey,
    // ... existing fields
  })
  .from(articles)
  .where(eq(articles.id, input.articleId));

// Return locale + translationKey in output for downstream steps
```

The `bridge()` function in `ArticleOutlinePipeline` and `ArticleDraftPipeline` already passes outputs between steps; just add `locale` and `translationKey` to the bridged shape.

### C.4 Locale-aware prompts

```typescript
// packages/pipelines/src/prompts/builder.ts

export interface BuildSystemPromptInput {
  skills: string[];
  projectIdOrSlug: string;
  stepInstructions: string;
  locale?: "de" | "en";   // NEW
}

export async function buildSystemPrompt(input: BuildSystemPromptInput): Promise<string> {
  const localeContext = input.locale === "de"
    ? `\n\nMARKET CONTEXT: This output is for the **German market (de-DE)**. Use German language, German SEO conventions, German cultural references, German legal/business norms (DSGVO, UWG, etc). Avoid English loanwords unless they're industry-standard.`
    : input.locale === "en"
    ? `\n\nMARKET CONTEXT: This output is for the **global English market (en-US)**. Use clear, direct English. Refer to US/global cultural and business context. Avoid German-specific references.`
    : "";

  // ... existing logic to load skills, project context, etc.
  const base = await loadSkillsAndContext(input.skills, input.projectIdOrSlug);
  return base + localeContext + "\n\n" + input.stepInstructions;
}
```

Every step that calls `buildSystemPrompt(...)` adds `locale` to the call:

```typescript
// In research.ts, outline.ts, draft.ts:
const prompt = await buildSystemPrompt({
  skills: [...],
  projectIdOrSlug: input.projectSlug,
  stepInstructions: `...`,
  locale: input.locale,  // NEW — passed via bridge
});
```

### C.5 Persist-article + persist-outline

```typescript
// packages/pipelines/src/article/steps/persist-outline.ts
// No major changes — existing logic writes outline to articles.outline jsonb.

// packages/pipelines/src/article/steps/persist-article.ts
// On final draft persist, also update the cornerstoneSpec status to "article_done":
await db.transaction(async (tx) => {
  await tx
    .update(articles)
    .set({ bodyMd: input.bodyMd, status: "approved", updatedAt: new Date() })
    .where(eq(articles.id, input.articleId));

  // If article has a cornerstoneSpecId, mark spec as done
  const [art] = await tx
    .select({ specId: articles.cornerstoneSpecId })
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);
  if (art?.specId) {
    await tx
      .update(cornerstoneSpecs)
      .set({ status: "article_done", updatedAt: new Date() })
      .where(eq(cornerstoneSpecs.id, art.specId));
  }
});
```

### C.6 Section C Acceptance Criteria

- [ ] `enqueueArticleGeneration` accepts `cornerstoneSpecId` (no longer `cornerstoneSlug`)
- [ ] `enqueueClusterArticleGeneration` enqueues all approved specs of a cluster in parallel
- [ ] Article row is created with `locale`, `translationKey`, `cornerstoneSpecId` set
- [ ] CornerstoneSpec status transitions: `approved` → `in_generation` → `article_done`
- [ ] All article-pipeline steps (topic-intake, research, outline, draft, hero-image) receive and use `locale`
- [ ] `buildSystemPrompt` injects market-context based on locale
- [ ] Generated articles are locale-native (DE article in German, EN in English) — verify via test smoke
- [ ] Existing tests pass; new test: enqueueClusterArticleGeneration with 1 cluster having DE+EN approved specs creates 2 article rows + 2 outline jobs
- [ ] Commit: `feat(pipelines): article generation locale-aware via cornerstoneSpecId (45-46.3)`

---

## Section D — API Endpoints

**Goal**: Expose cornerstone-spec CRUD + approval + generation triggers via Hono routes. Match existing route conventions (auth middleware, response envelope, triggerWithPreRunId helper).

### D.1 Files modified

- `apps/api/src/routes/cornerstone-specs.ts` (new) — CRUD + approval + reject + bulk-approve
- `apps/api/src/routes/clusters.ts` — extend with cluster-level "trigger generation" endpoint that calls `enqueueClusterArticleGeneration`
- `apps/api/src/routes/articles.ts` — backwards-compat: keep old endpoint with deprecation warning, but new endpoint accepts cornerstoneSpecId
- `apps/api/src/server.ts` — register new route file

### D.2 Cornerstone-Specs route

```typescript
// apps/api/src/routes/cornerstone-specs.ts
import { cornerstoneSpecs, db, projects } from "@marketing-auto/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";

export const cornerstoneSpecsRoutes = new Hono().basePath("/projects/:projectSlug/cornerstone-specs");

cornerstoneSpecsRoutes.use("*", requireAuth);

// List specs for a project (filter by cluster, status, locale)
cornerstoneSpecsRoutes.get("/", async (c) => {
  const projectSlug = c.req.param("projectSlug");
  const clusterId = c.req.query("clusterId");
  const status = c.req.query("status");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const conditions = [eq(cornerstoneSpecs.projectId, project.id)];
  if (clusterId) conditions.push(eq(cornerstoneSpecs.clusterId, clusterId));
  if (status) conditions.push(eq(cornerstoneSpecs.status, status as any));

  const specs = await db
    .select()
    .from(cornerstoneSpecs)
    .where(and(...conditions))
    .orderBy(desc(cornerstoneSpecs.updatedAt));

  // Group by translationKey to emit pairs
  const grouped = new Map<string, typeof specs>();
  for (const s of specs) {
    const arr = grouped.get(s.translationKey) ?? [];
    arr.push(s);
    grouped.set(s.translationKey, arr);
  }

  const pairs = Array.from(grouped.entries()).map(([key, members]) => ({
    translationKey: key,
    clusterId: members[0]!.clusterId,
    de: members.find((m) => m.locale === "de") ?? null,
    en: members.find((m) => m.locale === "en") ?? null,
  }));

  return c.json({ ok: true, data: { pairs, totalSpecs: specs.length } });
});

// Approve a single spec
cornerstoneSpecsRoutes.post("/:specId/approve", async (c) => {
  const specId = c.req.param("specId");
  const projectSlug = c.req.param("projectSlug");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [updated] = await db
    .update(cornerstoneSpecs)
    .set({ status: "approved", updatedAt: new Date() })
    .where(
      and(
        eq(cornerstoneSpecs.id, specId),
        eq(cornerstoneSpecs.projectId, project.id),
        eq(cornerstoneSpecs.status, "proposed")
      )
    )
    .returning();
  if (!updated) {
    return c.json({ ok: false, error: "Spec not found or not in 'proposed' status" }, 400);
  }

  return c.json({ ok: true, data: updated });
});

// Approve a pair (both DE+EN of a cluster) at once
cornerstoneSpecsRoutes.post("/pair/:translationKey/approve", async (c) => {
  const translationKey = c.req.param("translationKey");
  const projectSlug = c.req.param("projectSlug");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const updated = await db
    .update(cornerstoneSpecs)
    .set({ status: "approved", updatedAt: new Date() })
    .where(
      and(
        eq(cornerstoneSpecs.translationKey, translationKey),
        eq(cornerstoneSpecs.projectId, project.id),
        eq(cornerstoneSpecs.status, "proposed")
      )
    )
    .returning();

  return c.json({ ok: true, data: { approvedCount: updated.length, specs: updated } });
});

// Reject (with optional reason)
cornerstoneSpecsRoutes.post("/:specId/reject", async (c) => {
  const specId = c.req.param("specId");
  const projectSlug = c.req.param("projectSlug");
  const body = await c.req.json().catch(() => ({}));
  const reason = (body.reason as string) ?? null;

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [updated] = await db
    .update(cornerstoneSpecs)
    .set({ status: "rejected", rejectedReason: reason, updatedAt: new Date() })
    .where(
      and(eq(cornerstoneSpecs.id, specId), eq(cornerstoneSpecs.projectId, project.id))
    )
    .returning();
  if (!updated) return c.json({ ok: false, error: "Spec not found" }, 404);

  return c.json({ ok: true, data: updated });
});
```

### D.3 Cluster trigger endpoint

```typescript
// apps/api/src/routes/clusters.ts (extend existing)
import { enqueueClusterArticleGeneration } from "@marketing-auto/pipelines";

clustersRoutes.post("/:clusterId/generate-articles", async (c) => {
  const clusterId = c.req.param("clusterId");
  const projectSlug = c.req.param("projectSlug");
  const body = await c.req.json().catch(() => ({}));

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  try {
    const result = await enqueueClusterArticleGeneration({
      clusterId,
      projectId: project.id,
      approvalMode: body.approvalMode ?? "manual",
      modelOverride: body.modelOverride,
    });
    return c.json({ ok: true, data: result }, 202);
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
});
```

### D.4 Backwards compat for existing article-trigger

Keep `POST /projects/:slug/articles` as before for now, but log a deprecation warning if called with `cornerstoneSlug` (instead of `cornerstoneSpecId`). The endpoint internally looks up the cornerstone-spec by `(projectId, slug, locale='de')` for backwards-compat.

### D.5 Section D Acceptance Criteria

- [ ] `cornerstone-specs.ts` route file created and registered in server.ts
- [ ] `GET /projects/:slug/cornerstone-specs` returns translation-pair-grouped specs
- [ ] `POST /projects/:slug/cornerstone-specs/:specId/approve` works (and rejects already-approved)
- [ ] `POST /projects/:slug/cornerstone-specs/pair/:translationKey/approve` approves both DE+EN
- [ ] `POST /projects/:slug/cornerstone-specs/:specId/reject` works with optional reason
- [ ] `POST /projects/:slug/clusters/:clusterId/generate-articles` enqueues parallel pair-generation
- [ ] Auth middleware applied to all new routes
- [ ] Response envelope `{ok, data}` consistent with existing routes
- [ ] Old article-generation endpoint still works (backwards compat)
- [ ] Commit: `feat(api): cornerstone-spec approval + cluster article generation (45-46.4)`

---

## Section E — Frontend Approval UI

**Goal**: Marcel can review DE+EN cornerstone-pairs side-by-side, approve individually or as pairs, and trigger article-generation per cluster.

### E.1 Files modified

- `apps/web/src/pages/CornerstoneApprovalPage.vue` (new) — top-level page
- `apps/web/src/components/cornerstones/CornerstonePairCard.vue` (new) — DE+EN side-by-side preview
- `apps/web/src/components/cornerstones/CornerstoneRejectDialog.vue` (new) — reject with reason
- `apps/web/src/router/index.ts` — add route
- `apps/web/src/i18n/de/cornerstones.ts`, `apps/web/src/i18n/en/cornerstones.ts` — translation strings
- Side-effect: link from existing cluster-overview UI to this page

### E.2 CornerstoneApprovalPage

```vue
<!-- apps/web/src/pages/CornerstoneApprovalPage.vue -->
<template>
  <q-page padding>
    <div class="row items-center justify-between q-mb-md">
      <h4 class="q-my-none">{{ $t("cornerstones.approval.title") }}</h4>
      <q-btn-toggle
        v-model="statusFilter"
        :options="statusOptions"
        spread
        no-caps
        rounded
        unelevated
        toggle-color="primary"
      />
    </div>

    <div v-if="loading" class="text-center q-pa-xl">
      <q-spinner-dots size="2em" />
    </div>

    <div v-else-if="filteredPairs.length === 0" class="text-center text-grey-6 q-pa-xl">
      {{ $t("cornerstones.approval.empty") }}
    </div>

    <div v-else class="q-gutter-md">
      <CornerstonePairCard
        v-for="pair in filteredPairs"
        :key="pair.translationKey"
        :pair="pair"
        :slug="slug"
        @approved="onPairUpdated"
        @rejected="onPairUpdated"
      />
    </div>

    <div v-if="approvedClustersCount > 0" class="row q-mt-lg">
      <q-btn
        color="primary"
        size="lg"
        :label="$t('cornerstones.approval.generateAllApproved', { count: approvedClustersCount })"
        :loading="generating"
        @click="generateAllApproved"
      />
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Notify } from "quasar";
import { api } from "src/lib/api-client";
import CornerstonePairCard from "src/components/cornerstones/CornerstonePairCard.vue";

type CornerstoneSpec = {
  id: string;
  clusterId: string;
  locale: string;
  translationKey: string;
  cornerstoneKeyword: string;
  proposedTitle: string;
  proposedSlug: string;
  metaDescription: string;
  estimatedWordCount: number;
  h2Outline: string[];
  status: "proposed" | "approved" | "in_generation" | "article_done" | "rejected";
};

type Pair = {
  translationKey: string;
  clusterId: string;
  de: CornerstoneSpec | null;
  en: CornerstoneSpec | null;
};

export default defineComponent({
  name: "CornerstoneApprovalPage",
  components: { CornerstonePairCard },
  props: {
    slug: { type: String, required: true },
  },

  data: () => ({
    loading: false,
    generating: false,
    statusFilter: "proposed" as "proposed" | "approved" | "all",
    pairs: [] as Pair[],
  }),

  computed: {
    statusOptions(): Array<{ label: string; value: string }> {
      return [
        { label: this.$t("cornerstones.status.proposed"), value: "proposed" },
        { label: this.$t("cornerstones.status.approved"), value: "approved" },
        { label: this.$t("cornerstones.status.all"), value: "all" },
      ];
    },
    filteredPairs(): Pair[] {
      if (this.statusFilter === "all") return this.pairs;
      return this.pairs.filter(
        (p) =>
          (p.de && p.de.status === this.statusFilter) ||
          (p.en && p.en.status === this.statusFilter)
      );
    },
    approvedClustersCount(): number {
      const clusters = new Set<string>();
      for (const p of this.pairs) {
        if (
          (p.de?.status === "approved" || p.en?.status === "approved") &&
          p.clusterId
        ) {
          clusters.add(p.clusterId);
        }
      }
      return clusters.size;
    },
  },

  watch: {
    statusFilter() {
      void this.fetchPairs();
    },
  },

  async mounted() {
    await this.fetchPairs();
  },

  methods: {
    async fetchPairs(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get(`/projects/${this.slug}/cornerstone-specs`);
        this.pairs = res.data.data.pairs;
      } finally {
        this.loading = false;
      }
    },

    onPairUpdated(): void {
      void this.fetchPairs();
    },

    async generateAllApproved(): Promise<void> {
      this.generating = true;
      try {
        const clusters = new Set<string>();
        for (const p of this.pairs) {
          if (
            (p.de?.status === "approved" || p.en?.status === "approved") &&
            p.clusterId
          ) {
            clusters.add(p.clusterId);
          }
        }

        let total = 0;
        for (const clusterId of clusters) {
          const res = await api.post(
            `/projects/${this.slug}/clusters/${clusterId}/generate-articles`
          );
          total += res.data.data.results.length;
        }

        Notify.create({
          type: "positive",
          message: this.$t("cornerstones.approval.generationStarted", { total }),
          timeout: 4000,
        });

        await this.fetchPairs();
      } catch (e) {
        Notify.create({ type: "negative", message: (e as Error).message });
      } finally {
        this.generating = false;
      }
    },
  },
});
</script>
```

### E.3 CornerstonePairCard

```vue
<!-- apps/web/src/components/cornerstones/CornerstonePairCard.vue -->
<template>
  <q-card class="cornerstone-pair-card">
    <q-card-section class="row q-col-gutter-md">
      <!-- DE side -->
      <div class="col-12 col-md-6">
        <div class="row items-center q-mb-sm">
          <q-badge color="primary">DE</q-badge>
          <q-space />
          <q-badge :color="statusColor(pair.de?.status)" outline>
            {{ pair.de?.status ?? "missing" }}
          </q-badge>
        </div>
        <SpecPreview v-if="pair.de" :spec="pair.de" />
        <div v-else class="text-grey-5">{{ $t("cornerstones.pair.missingDe") }}</div>
      </div>

      <!-- EN side -->
      <div class="col-12 col-md-6">
        <div class="row items-center q-mb-sm">
          <q-badge color="primary">EN</q-badge>
          <q-space />
          <q-badge :color="statusColor(pair.en?.status)" outline>
            {{ pair.en?.status ?? "missing" }}
          </q-badge>
        </div>
        <SpecPreview v-if="pair.en" :spec="pair.en" />
        <div v-else class="text-grey-5">{{ $t("cornerstones.pair.missingEn") }}</div>
      </div>
    </q-card-section>

    <q-card-actions align="right">
      <q-btn
        v-if="canApprovePair"
        flat
        color="positive"
        :label="$t('cornerstones.pair.approveBoth')"
        @click="approvePair"
      />
      <q-btn
        v-if="pair.de && pair.de.status === 'proposed'"
        flat
        :label="$t('cornerstones.pair.approveDeOnly')"
        @click="approveSpec(pair.de)"
      />
      <q-btn
        v-if="pair.en && pair.en.status === 'proposed'"
        flat
        :label="$t('cornerstones.pair.approveEnOnly')"
        @click="approveSpec(pair.en)"
      />
      <q-btn
        flat
        color="negative"
        icon="close"
        @click="openRejectDialog"
      />
    </q-card-actions>

    <CornerstoneRejectDialog
      v-model="rejectDialogOpen"
      :pair="pair"
      :slug="slug"
      @rejected="onRejected"
    />
  </q-card>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { Notify } from "quasar";
import { api } from "src/lib/api-client";
import SpecPreview from "./SpecPreview.vue";
import CornerstoneRejectDialog from "./CornerstoneRejectDialog.vue";

export default defineComponent({
  name: "CornerstonePairCard",
  components: { SpecPreview, CornerstoneRejectDialog },
  emits: ["approved", "rejected"],
  props: {
    pair: { type: Object as PropType<any>, required: true },
    slug: { type: String, required: true },
  },

  data: () => ({
    rejectDialogOpen: false,
  }),

  computed: {
    canApprovePair(): boolean {
      return (
        this.pair.de?.status === "proposed" && this.pair.en?.status === "proposed"
      );
    },
  },

  methods: {
    statusColor(status?: string): string {
      switch (status) {
        case "proposed": return "blue-5";
        case "approved": return "green-6";
        case "in_generation": return "orange-6";
        case "article_done": return "teal-6";
        case "rejected": return "red-6";
        default: return "grey-5";
      }
    },

    async approvePair(): Promise<void> {
      await api.post(
        `/projects/${this.slug}/cornerstone-specs/pair/${this.pair.translationKey}/approve`
      );
      Notify.create({ type: "positive", message: this.$t("cornerstones.notify.pairApproved") });
      this.$emit("approved");
    },

    async approveSpec(spec: any): Promise<void> {
      await api.post(`/projects/${this.slug}/cornerstone-specs/${spec.id}/approve`);
      this.$emit("approved");
    },

    openRejectDialog(): void {
      this.rejectDialogOpen = true;
    },

    onRejected(): void {
      this.$emit("rejected");
    },
  },
});
</script>
```

A `SpecPreview.vue` sub-component renders title, slug, meta, estimated word count, and the H2 outline as a bullet list.

### E.4 i18n keys

```typescript
// apps/web/src/i18n/de/cornerstones.ts
export const cornerstonesDe = {
  approval: {
    title: "Cornerstone-Vorschläge",
    empty: "Keine Cornerstones in diesem Status.",
    generateAllApproved: "{count} Cluster generieren",
    generationStarted: "{total} Article-Generationen gestartet",
  },
  status: {
    proposed: "Vorgeschlagen",
    approved: "Genehmigt",
    all: "Alle",
  },
  pair: {
    approveBoth: "Beide genehmigen",
    approveDeOnly: "Nur DE genehmigen",
    approveEnOnly: "Nur EN genehmigen",
    missingDe: "Kein DE-Pendant generiert",
    missingEn: "Kein EN-Pendant generiert",
  },
  notify: {
    pairApproved: "Pärchen genehmigt",
  },
};

// EN analog
```

### E.5 Section E Acceptance Criteria

- [ ] `CornerstoneApprovalPage.vue` renders pairs with status filter
- [ ] `CornerstonePairCard.vue` shows DE+EN side-by-side
- [ ] Approve-Pair, Approve-Single (DE/EN), and Reject actions work
- [ ] After approval, "Generate Articles" button appears, triggers cluster-level generation
- [ ] Empty state shown when no specs match filter
- [ ] i18n strings for DE+EN
- [ ] Route registered in router
- [ ] Smoke flow in dev: open page, see pairs, approve a pair, click generate, observe article-pipeline jobs in worker logs
- [ ] Commit: `feat(web): cornerstone approval UI for DE+EN pairs (45-46.5)`

---

## Final Verification

After all 5 sections committed:

```bash
# Type check
bun --filter @marketing-auto/db tsc --noEmit
bun --filter @marketing-auto/pipelines tsc --noEmit
bun --filter @marketing-auto/api tsc --noEmit
bun --filter @marketing-auto/web vue-tsc --noEmit

# Tests
bun test

# Manual end-to-end smoke (toolwiki project):
# 1. Run cluster-plan + cluster-expand pipelines (should still work, no schema break)
# 2. Run cornerstone-list pipeline → verify cornerstone_specs has 2 rows per cluster (DE+EN)
# 3. Open Web UI cornerstone approval page → see pairs side-by-side
# 4. Approve a pair → cornerstone_specs.status='approved'
# 5. Trigger cluster generation → 2 article rows created with locale='de' and 'en', shared translationKey
# 6. Wait for outline pipelines → verify articles.outline has DE/EN content respectively
```

## Acceptance Criteria (combined)

- [ ] Section A: schema migration applied, types green
- [ ] Section B: cornerstone-list generates DE+EN pairs persisted in DB
- [ ] Section C: enqueueClusterArticleGeneration triggers 2 parallel article-pipelines
- [ ] Section D: API endpoints work end-to-end for approval + generation
- [ ] Section E: Frontend approval UI renders + actions work
- [ ] All 5 commits on `feature/45-46-multi-language` branch

## Reporting Back

After implementation:

1. **Schema diff** — `git diff packages/db/src/schema/`
2. **Migration SQL** — paste content of new migration file
3. **Pipeline-flow trace** — output from running cornerstone-list + cluster-generation end-to-end (e.g. for toolwiki: how many specs created, how many articles enqueued)
4. **Smoke flow result** — did 1 cluster's cornerstone-pair generate 2 articles in the right locales?
5. **Locale-aware sample** — paste the title + first H2 of one DE-article and its EN-pendant. Verify they're independently written, not translations.
6. **API endpoint smoke** — curl examples for: list pairs, approve pair, trigger generation
7. **UI screenshots** (or describe) — approval page with pairs visible
8. **Test results** — `bun test` output
9. **Commit hashes** — 5 commits, one per section
10. **Deviations** — any spec gaps Claude Code had to fill or workarounds

After this, the marketing-tool can plan and generate a full DE+EN content cluster end-to-end, ready for Spec 47 (per-collection pipelines) and toolwiki cold-start.

## Discovered During Implementation

(empty)

## Deviations

(empty)
