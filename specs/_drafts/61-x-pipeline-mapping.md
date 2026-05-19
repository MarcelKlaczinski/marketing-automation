# Discovery: Article Generator Pipeline & Collection Mapping

**Date:** 2026-05-19  
**Status:** Draft / Research output — not yet a spec  
**Purpose:** Map the current blog article pipeline step-by-step; identify extension points for additional Astro content collections (`comparison`, `ki-wissen`). Input for Spec 61.x design.

---

## Q1 — Pipeline Entry Point: File Listing

```
packages/pipelines/src/article/
```

| File | Role |
|------|------|
| `index.ts` | Barrel export |
| `pipeline.ts` | Lightweight outline/draft pipeline factory (not BlogPipeline) |
| `types.ts` | Shared Zod schemas: `ArticleOutline`, `ResearchResult`, `SelfReviewIssue` |
| `trigger.ts` | Enqueue wrappers for all article pipelines |
| `blog/pipeline.ts` | **13-step BlogPipeline** — primary production pipeline |
| `blog/persist.ts` | `createBlogArticleFromBrief()`, `updateArticleAuthor()` helpers |
| `blog/trigger.ts` | HTTP route bindings for blog triggers |
| `steps/topic-intake.ts` | Load article/cluster/project from DB; resolve satellite keywords |
| `steps/research.ts` | SERP research via DataForSEO |
| `steps/outline.ts` | LLM outline generation (Sonnet 4.6) |
| `steps/persist-outline.ts` | Checkpoint: save outline to DB; gate on approval mode |
| `steps/draft.ts` | LLM draft generation (Sonnet 4.6); extracts `FRONTMATTER_EXTRAS` block |
| `steps/persist-body.ts` | Checkpoint: save `bodyMd` immediately after draft |
| `steps/self-review.ts` | Quality classification (Haiku 4.5) |
| `steps/hero-image.ts` | Image generation via Replicate SDXL |
| `steps/assembly.ts` | JSON-LD `Article` schema.org generation |
| `steps/persist-article.ts` | **Final persist**: write all fields to `articles` table |
| `author-picker/step.ts` | Step 1 of BlogPipeline: author selection |
| `author-picker/index.ts` | 3-strategy cascade (historic SQL → embedding → default) |
| `author-picker/historic.ts` | SQL scoring against imported blog articles |
| `author-picker/embedding.ts` | Voyage embedding similarity fallback |
| `tool-linker/step.ts` | Step 9: linkify tool mentions in body |
| `tool-linker/resolve-step.ts` | Step 2: resolve source + tools context for prompt injection |
| `tool-linker/pre-generation.ts` | Build tools context markdown for outline/draft prompts |
| `tool-linker/post-generation.ts` | Linkify first-mention-per-section of tool names |
| `source-context/index.ts` | Gap/trend framing injected into user message |
| `discovery/` (6 files) | Post-generation gap detection (future feature, not yet active) |
| `voice-reference/loader.ts` | Load peer articles for voice continuity in refresh/translation |
| `localize/pipeline.ts` | Title/slug/meta translation (Spec 54.8) |
| `translation/` (5 files) | Full bidirectional article translation (Spec 59.2) |
| `refresh/` (4 files) | Re-generation of existing articles (Spec 54.10) |
| `hero-generation/pipeline.ts` | Standalone pipeline: hero image only |
| `social-image/pipeline.ts` | Standalone pipeline: social carousel generation |

---

## Q2 — Step Sequence (BlogPipeline, 13 steps)

Source: `packages/pipelines/src/article/blog/pipeline.ts:117–131`

| # | Step | File | Key Input | Key Output | LLM? |
|---|------|------|-----------|------------|------|
| 1 | AuthorPickStep | `author-picker/step.ts` | `articleId`, `projectId`, `briefId` | `authorSlug`, `matchStrategy`, `expertiseEmbedding` | No (SQL + Voyage) |
| 2 | ToolRelevanceStep | `tool-linker/resolve-step.ts` | `articleId`, `projectId`, `briefId` | `sourceContext`, `toolsContext` (markdown) | No (SQL) |
| 3 | TopicIntakeStep | `steps/topic-intake.ts` | `articleId`, `projectId` | `cornerstoneKeyword`, `clusterName`, `locale`, `translationKey`, `frontmatterSchema` | No (DB read) |
| 4 | ResearchStep | `steps/research.ts` | `cornerstoneKeyword`, `satelliteKeywords`, `projectSlug` | `serp` (organic + PAA + related), `competitorSynthesis` | No (DataForSEO) |
| 5 | OutlineStep | `steps/outline.ts` | Research + cluster metadata + sourceContext + toolsContext + frontmatterSchema | `title`, `slug`, `sections[]`, `heroImagePrompt`, `estimatedTotalWords` | **Yes** — Sonnet 4.6 |
| 6 | PersistOutlineStep | `steps/persist-outline.ts` | `articleId`, `projectId`, `outline`, `approvalMode` | (none — DB write; returns `articleId`) | No |
| 7 | DraftStep | `steps/draft.ts` | `articleId`, `projectId`, `projectSlug`, `locale`, `frontmatterSchema`, `sourceContext`, `toolsContext` | `bodyMd`, `wordCount`, `frontmatterExtras` | **Yes** — Sonnet 4.6 |
| 8 | PersistBodyStep | `steps/persist-body.ts` | `articleId`, `bodyMd`, `wordCount` | (none — DB write; passes through) | No |
| 9 | ToolLinkerStep | `tool-linker/step.ts` | `articleId`, `projectId`, `locale`, `bodyMd` | `bodyMd` (with links), `linksAdded`, `linkedTools[]` | No (text match) |
| 10 | SelfReviewStep | `steps/self-review.ts` | `articleId`, `bodyMd`, `wordCount`, `cornerstoneKeyword`, `projectSlug` | `score`, `issues[]`, `shouldBlock`, `summary` | **Yes** — Haiku 4.5 |
| 11 | HeroImageStep | `steps/hero-image.ts` | `articleId`, `projectId`, `projectSlug` | `r2Key`, `publicUrl`, `altText` | No (Replicate) |
| 12 | AssemblyStep | `steps/assembly.ts` | `articleId`, `projectId` | `schemaJsonLd` (JSON-LD object) | No |
| 13 | PersistArticleStep | `steps/persist-article.ts` | All accumulated outputs | `articleId`, `wordCount`, `selfReviewScore` | No (final DB write) |

### LLM prompt locations

| Step | Prompt resolution |
|------|-------------------|
| OutlineStep | `resolveMasterPrompt({ projectKey: "article.outline", fallback: OUTLINE_DEFAULT_PROMPT })` — system = skill + project context (cacheable); user = keyword + sourceContext + toolsContext |
| DraftStep | `resolveMasterPrompt({ projectKey: "article.draft", fallback: DRAFT_DEFAULT_PROMPT })` — includes author list, category taxonomy, intentType enum, frontmatterExtras format; LLM embeds `FRONTMATTER_EXTRAS` block in HTML comment at end of body |
| SelfReviewStep | `resolveMasterPrompt({ projectKey: "article.self_review", fallback: SELF_REVIEW_DEFAULT_PROMPT })` — Haiku, no caching |

---

## Q3 — `intentType` Usage

### Where it is read

| Location | How used |
|----------|----------|
| `blog/persist.ts:49` | `createBlogArticleFromBrief()` reads `brief.intentType` → writes to `articles.intent_type` |
| `author-picker/step.ts:51` | `brief.intentType === "comparison"` → special author-scoring weighting |
| `steps/draft.ts:124–160` | Prompts LLM to select from enum; extracts chosen intentType from `FRONTMATTER_EXTRAS`; activates tool-spotlight fields conditionally |
| `translation/body-step.ts:219–279` | Reads `intentType` to select adaptive vs. literal translation path |
| `social-image/steps.ts:85,873–883` | Derives `contentType` from `intentType` → hashtag + hook prompt selection |

### Does it branch the pipeline?

- **No** — intentType does **not** branch BlogPipeline. All 13 steps run identically.
- **Yes, in prompts** — DraftStep conditionally emits tool-spotlight fields (`pros`, `cons`, `features`, `useCases`, `pricingTier`) only when `intentType ∈ { overview, features, review, pricing, use-cases }` AND `primaryTool` is set.
- **Yes, in translation** — `translation/decision.ts` branches literal vs. adaptive path based on intentType.

### Enum values currently handled

```typescript
// packages/pipelines/src/article/steps/draft.ts:125–129
"general" | "tutorial" | "comparison" | "review" |
"overview" | "features" | "pricing" | "use-cases"
```

**Storage:** `articles.intent_type TEXT` (no DB enum — validated only by LLM prompt and Zod schema at read sites).

---

## Q4 — DB Writes: `articles` Table

Fields written by **PersistArticleStep** (`steps/persist-article.ts:69–96`):

| Column | Source Step | Astro Frontmatter? | Collection scope |
|--------|------------|-------------------|-----------------|
| `body_md` | DraftStep → ToolLinkerStep | ✅ Body content | All |
| `word_count` | DraftStep | Dashboard only | All |
| `hero_image_r2_key` | HeroImageStep | ✅ `image` field | All (blog only generates) |
| `hero_image_public_url` | HeroImageStep | ✅ `image` + JSON-LD | All |
| `hero_image_alt_text` | HeroImageStep | ✅ `image.alt` | All |
| `schema_json_ld` | AssemblyStep | `<script type="application/ld+json">` | Schema-heavy collections |
| `self_review_score` | SelfReviewStep | `selfReviewScore` | All |
| `self_review_issues` | SelfReviewStep | Internal audit only | All |
| `status` | Hardcoded `"final_review"` | State machine | All |
| `frontmatter_extras` | DraftStep (parsed FRONTMATTER_EXTRAS) | All extras (faq, bottomLinksVariant, etc.) | All |
| `category` | frontmatterExtras or default | ✅ | All |
| `subcategory` | frontmatterExtras | ✅ | All |
| `tags` | frontmatterExtras | ✅ | All |

**Set earlier (not by PersistArticleStep):**

| Column | Set by |
|--------|--------|
| `author` | AuthorPickStep via `updateArticleAuthor()` |
| `cluster_id`, `cluster_key`, `cluster_role` | Article creation |
| `collection`, `locale`, `translation_key` | Routing layer / article creation |
| `intent_type` | `createBlogArticleFromBrief()` |
| `collection_type` | Always `"blog"` (hardcoded in persist.ts) |
| `title`, `slug`, `meta_description` | Outline → written at PersistOutlineStep |
| `embedding` | Internal-linking pipeline (lazy) |

**Internal-only (not in frontmatter):**

| Column | Purpose |
|--------|---------|
| `draftPipelineRunId` | Audit correlation |
| `updatedAt`, `lastRefreshedAt` | Timestamps |

---

## Q5 — Frontmatter Serialization

Serialization is **not part of article generation** — it is deferred to the **AstroSyncPipeline**.

### AstroSyncPipeline steps

```
packages/adapters/astro-sync/src/steps/render-mdx.ts
```

**`buildFrontmatter()`** (line 136–160) merges three layers (highest priority first):

1. `articles.frontmatterExtras` — FRONTMATTER_EXTRAS from DraftStep (LLM-authored fields)
2. `articles.*` columns — `category`, `subcategory`, `tags`, `author`
3. `projects.astroFrontmatterDefaults` (JSONB) — project-level defaults

### Collection name: HARDCODED

```typescript
// packages/adapters/astro-sync/src/steps/render-mdx.ts:34
collectionName: z.literal("blog")  // ← hardcoded
```

Path construction: `${astroRepoRoot}/blog/${article.slug}.mdx` — always `blog/`.

### Astro schema injection (Spec 50)

- **TopicIntakeStep** reads `projects.astroCollectionSchemas?.["blog"]` → returns `frontmatterSchema: FrontmatterFieldDescriptor[]`
- **OutlineStep + DraftStep** receive `frontmatterSchema` and pass it to `buildSystemPrompt()` which appends `# Frontmatter Requirements` to the system prompt
- LLM knows required fields at generation time (not just at sync time)

---

## Q6 — Extension Points for New Collections

### To add `collectionType: "comparison"` or `"ki-wissen"`

#### 1. DB Schema changes

New columns on `articles` (only if comparison-specific structured data needed):
- `comparison_verdict TEXT` — winner summary
- `comparison_matrix JSONB` — `{ tool_a, tool_b, winner, reason, metric }[]`
- `comparison_type TEXT` — `"head_to_head" | "multi_way" | "feature_matrix"`

No changes needed for `ki-wissen` unless it has unique structured fields.

#### 2. Routing / trigger layer (`blog/persist.ts`)

Create `createComparisonArticleFromBrief(brief)`:
- Identical to blog version except `collection: "comparison"`, `collection_type: "comparison"`
- Wire into `decideRoute()` in `packages/pipelines/src/article/_lib/route.ts`

#### 3. Pipeline steps — reusability matrix

| Step | Reusable as-is? | Notes |
|------|----------------|-------|
| AuthorPickStep | ✅ | Generic |
| ToolRelevanceStep | ✅ | Generic |
| TopicIntakeStep | ⚠️ | Must read `astroCollectionSchemas["comparison"]` instead of `["blog"]` — pass `collectionType` as input |
| ResearchStep | ✅ | Generic |
| OutlineStep | ⚠️ | Prompt unchanged; frontmatterSchema injection drives collection-specific fields |
| PersistOutlineStep | ✅ | Generic |
| DraftStep | ⚠️ | For comparison: add matrix extraction to `FRONTMATTER_EXTRAS` parsing; update tool-spotlight condition |
| PersistBodyStep | ✅ | Generic |
| ToolLinkerStep | ✅ | Generic |
| SelfReviewStep | ✅ | Generic |
| HeroImageStep | ✅ | Generic (comparison may use different visual style via prompt override) |
| AssemblyStep | ⚠️ | May need `ComparisonPage` JSON-LD schema instead of `Article` |
| PersistArticleStep | ✅ | Generic (writes whatever fields are available) |

**Net: no new step classes needed for comparison.** Schema injection + DraftStep parsing changes are sufficient.

#### 4. Astro sync adapter changes (required)

- Remove `z.literal("blog")` from RenderMdxStep `InputSchema` → `collectionName: z.enum(["blog", "comparison", "ki-wissen"])`
- Dynamic path: `${astroRepoRoot}/${collectionName}/${article.slug}.mdx`
- TopicIntakeStep must pass `collectionName` from `articles.collection` field through pipeline chain

#### 5. Astro repo changes (required)

- Add `src/content/comparison/` collection directory
- Define schema in `src/content/config.ts` with comparison-specific fields
- `ExtractCollectionSchemasStep` auto-discovers the schema on next import (Spec 50)

---

## Q7 — Batch API Readiness

**Current state:** Zero usage of Anthropic MessageBatch API. All LLM calls are synchronous `anthropic.messages()` calls.

```bash
# grep result: no MessageBatch references found outside test/node_modules
```

### Where batch would fit

| Call site | Batch benefit | Latency trade-off |
|-----------|--------------|-------------------|
| OutlineStep (Sonnet 4.6) | 50% cost reduction | 30s → up to 24h |
| DraftStep (Sonnet 4.6) | 50% cost reduction | 30s → up to 24h |
| SelfReviewStep (Haiku 4.5) | 50% cost reduction | Haiku already cheap |

### Implementation sketch (not specced yet)

1. `packages/pipelines/src/engine/batch-queue.ts` — `enqueueBatch()`, `processBatch()`
2. OutlineStep and DraftStep build a batch request instead of sync call → return `batch_pending` status
3. `apps/api/src/workers/batch-processor.worker.ts` — cron every 6h, polls `/v1/messages/batches/:batch_id`, routes results back
4. PersistOutlineStep handles async outline (gate on batch status)
5. CostTracker: new `batch_api` service key; record actual usage retrospectively after batch completes

**Migration path:** Non-urgent. Current sync approach is stable. Batch API is best suited for bulk, non-time-critical generation (e.g., gap-filled article backfills). Existing pipeline architecture supports it but requires new worker and polling infrastructure.

---

## Architecture Summary

```
BlogPipeline (13 steps)
├─ Pre-LLM (Steps 1–2)
│  ├─ AuthorPickStep       → SQL scoring + Voyage embedding
│  └─ ToolRelevanceStep    → SQL query for tools context
├─ Outline Phase (Steps 3–6)
│  ├─ TopicIntakeStep      → DB load + schema discovery
│  ├─ ResearchStep         → DataForSEO SERP
│  ├─ OutlineStep          → Sonnet 4.6 LLM ★
│  └─ PersistOutlineStep   → DB checkpoint
├─ Draft Phase (Steps 7–8)
│  ├─ DraftStep            → Sonnet 4.6 LLM ★ + FRONTMATTER_EXTRAS parsing
│  └─ PersistBodyStep      → DB checkpoint
├─ Post-generation (Steps 9–10)
│  ├─ ToolLinkerStep       → text processing
│  └─ SelfReviewStep       → Haiku 4.5 LLM ★
└─ Asset + Persist (Steps 11–13)
   ├─ HeroImageStep        → Replicate SDXL
   ├─ AssemblyStep         → JSON-LD schema generation
   └─ PersistArticleStep   → final DB write

AstroSyncPipeline (separate — runs after article reaches final_review)
├─ LoadArticleStep
├─ ResolveSchemaStep       → parse Astro content/config.ts
├─ RenderMdxStep           → buildFrontmatter() + YAML serialization  ← HARDCODES "blog"
├─ DownloadHeroStep
├─ CommitToGitHubStep
└─ UpdateDbStatusStep
```

### Key invariants

| Invariant | Notes |
|-----------|-------|
| `intentType` flows: brief → article creation → DraftStep prompt → frontmatterExtras → Astro frontmatter | No intermediate transformations |
| `collection` hardcoded `"blog"` throughout pipelines | Extensible (column exists) but no branching yet |
| `collection_type` DB column exists | `blog/persist.ts` always writes `"blog"`; unused in step logic |
| Frontmatter serialization deferred to AstroSyncPipeline | Allows live Astro schema discovery |
| All 3 LLM calls support master-prompt overrides | Via `resolveMasterPrompt({ projectKey, fallback })` |
| Steps are stateless value-transformers | No step has side effects except `Persist*Step` and `HeroImageStep` |
