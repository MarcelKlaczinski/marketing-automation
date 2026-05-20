# Theme 62 — Discovery Findings

_Generated 2026-05-20 against local dev DB (`postgresql://marketing_auto@localhost:5432/marketing_auto`, PostgreSQL 18.3) and HEAD of `master`._

---

## Executive Summary

Theme 62 sits on top of an unexpectedly mature foundation: **pipeline_runs**, **batch_checkpoint**, **shouldRun/skipOutput**, **afterComplete/afterError**, **dual-mode sync/batch LLM client**, **cron_state DB-driven cron toggle**, and a **Cmd+K palette** already exist in code (some only just landed in Spec 61.4 and are completely unexercised). What is genuinely missing is the **planning layer**: no `weekly_plans`, no `planned_items`, no `project_goals` or `cadence` table; no prompt-version history or golden-set; no calendar UI; no step-pause beyond the batch-API mechanism; no ComparisonDiscovery module. Three risks dominate: (1) batch resume code path has zero production rows (`batch_requests = 0`, `pipeline_runs.batch_pending = 0`), so the suspend/resume mechanic is theoretically working but field-untested; (2) `BaseStep.idempotencyKey()` is documented as a contract but the runner comment at `runner.ts:176` says "caching not yet implemented" — re-runs after an edit-input action will re-charge every step; (3) sibling auto-translation skip at `blog/pipeline.ts:407` is silent (info-log only) — Marcel never sees that EN was not created. Recommendation: **merge 62.0 and 62.1** because step-pause persistence and prompt-version storage are both written into `pipeline_runs.batchCheckpoint`/extensions of the existing run record, and golden-set is a thin add-on to `step_pauses` once they exist.

---

## Phase 1 — DB-Reality-Check

### 1.1 Existence and schema of the 7 named tables

All exist with the noted exception — **`tools` does NOT exist as a table**. Tool data lives on `articles` (columns `tool_pricing`, `tool_price_from`, `tool_rating`, `tool_votes`, `tool_affiliate_slug`, `tool_website`) and via Astro imports of the `tools` collection (articles with `collection='tools'`).

| Table | Rows | Key fields | Notes |
|---|---|---|---|
| `articles` | 306 | id, project_id, cluster_id, status, slug, collection, locale, translation_key, source, intent_type, collection_type | Multi-collection (blog/tools/comparisons/ki-wissen/authors). `translation_key` links DE↔EN siblings. |
| `article_discovery` | 274 | article_id (unique), word_count, content_hooks (jsonb), suggested_templates (jsonb), narrative_arc, enrichment_mode, content_hash | All 274 enriched via `enrichment_mode='llm_enriched'`, all on 2026-05-13 (no fresh discovery in last 7 days). |
| `template_renders` | 27 | article_id, template_key, locale, theme, status, render_input (jsonb), suggested_template, suggestion_confidence, user_override | Spec 60.6/60.7 canonical render table (`social_posts` is legacy). |
| `cost_logs` | 1071 | project_id, service (enum), operation, cost_eur, pipeline_run_id, article_id, metadata | Daily working table. |
| `batch_requests` | **0** | pipeline_run_id, anthropic_batch_id, anthropic_custom_id, status, model, step_key, request/response_body, cost_eur | Spec 61.4 table — schema exists, **never exercised**. |
| `clusters` | 44 | pillar_id, name, primary_keyword, generation_status, embedding (vector(1024)), proposed_hub/spokes (jsonb), trigger_brief_id | Vector-indexed for trend cluster-match. |
| ~~tools~~ | N/A | — | **No such table.** Tools = `articles WHERE collection='tools'`. |

Sample article (project=Toolwiki): `id=f098…, status=final_review, collection=blog, locale=en, translation_key=b048…, source=generated, created_at=2026-05-17`. EN translation pair confirmed via `translation_key`.

Sample article_discovery: `narrative_arc=4203 words, completeness_score=0.700, hooks_type=array, suggested_count=4`. All rows have `suggested_templates` populated as jsonb arrays.

Sample template_renders: `template_key=comparison-stunning, locale=de, theme=dark, status=ready` and `template_key=use-case-verdict-per-tool, status=superseded` (Spec 59.3 rename in progress, see migration 0062).

### 1.2 Planning/Scheduling tables

**Only one match** for `%plan%|%schedule%|%goal%|%cadence%|%calendar%|%pause%|%prompt%|%snapshot%|%optimization%`:

| Table | Rows | Purpose |
|---|---|---|
| `project_pause_states` | 0 | Spec 41 cost-enforcement pause (per-project, single row) — has `service` column for service-scoped pause. |

**Adjacent existing tables that could be repurposed or merged**: `pipeline_chains` (3 rows) is the closest thing — it tracks multi-pipeline chains (gap→outline→draft→schema→localize→…) with `status`, `current_step`, `step_runs` JSONB. It is gap-level, not week-level, and is documented at Spec 49d.

**Explicit gaps:** no `project_goals`, `goal_overage_policies`, `weekly_plans`, `planned_items`, `step_pauses`, `step_optimization_requests`, `prompt_versions`, `signal_snapshots`, `cadence_*`. These all need to be created.

### 1.3 Prompt-Storage

**Hybrid: file-based with a DB override layer.** No dedicated `prompts` table.

**Files** (all under `packages/pipelines/src/`):
- `prompts/builder.ts` — `buildSystemPrompt({skills, projectIdOrSlug, stepInstructions, locale, frontmatterSchema})` aggregator that produces `{cacheablePrefix, variableSuffix, full}`. cacheablePrefix gets `cache_control: ephemeral` for Anthropic prompt caching.
- `article/prompts/{index,comparison,ki-wissen}.ts` — `selectDraftPrompt(collectionType)` switch returning `null|DraftPromptFn`. Pattern 109.
- `cluster-creator/prompts.ts` — `buildClusterProposalPrompt({brief, projectName, topicScope, …})` returns `{systemPrompt, userMessage}`.
- `cluster/full-plan/prompts.ts` — hub+spokes plan generation.
- `topic-sources/trend-discovery/prompts.ts` — `buildTrendSynthesisDefaultPrompt(scope)`.
- `article-quality/prompt.ts` — single quality-eval prompt.
- `config/resolve-master-prompt.ts` — **the override mechanism**.

**Override mechanism** (Spec 54.2+): `project_configurations.masterPrompts` (JSONB) holds per-project overrides for **5 hardcoded keys**:
```
article.outline
article.draft
article.self_review
article.localize.fresh
article.localize.translate
```
Resolution: `resolveMasterPrompt({projectId, promptKey, fallback})` → returns DB override if set, else the code-default fallback string passed by the step (see `config/resolve-master-prompt.ts:4-12`).

**Structure of a representative prompt file** (3 examples):

1. **`cluster-creator/prompts.ts`** — pure function builder. No frontmatter, no version field, no metadata. Two-string return: `systemPrompt` (instructions) + `userMessage` (data). The `existingClusterNames` injection is anti-duplication. **Not versioned, not stored, not diff-able.**

2. **`article/prompts/index.ts`** — Pattern 109 selector. Takes `ArticleCollectionType`, returns a function-with-known-signature. Adding a new collection = 1 import + 1 switch case. **No history of which prompt fired which run.**

3. **`topic-sources/trend-discovery/prompts.ts`** — `buildTrendSynthesisDefaultPrompt(scope)` returns a single string. Dynamic interpolation of `exclusions`, `relevance_keywords`, `primary_themes` from `topic_scope`. Comment at line 5 explicitly enforces "dynamic prompts MUST live inside a function, not at module level". **No record of which exclusions/relevance lists were in scope at the time a brief was generated.**

**Empty placeholder**: `packages/prompts/` exists with only `.gitkeep` — pre-allocated for a future centralized prompt registry, never wired up.

**Net for 62.1:** there is no prompt-version table, no diff between active and previous version, no "this run used prompt rev X" link from `pipeline_runs`, and no golden-set fixture. The `masterPrompts` JSONB is closest, but it's a single-version-per-project override (newest wins, no history).

### 1.4 Pipeline-Run-Persistenz

**`pipeline_runs` IS the canonical persistence layer** — every step run gets its own row (parent_run_id self-reference) with input/output JSONB. The state outside Redis lives here entirely.

Schema highlights:
```
pipeline_runs(
  id uuid PK,
  project_id uuid FK,
  pipeline_name text,
  step_name text NULL,         -- NULL on parent row, set on step rows
  status pipeline_run_status,  -- ENUM
  job_id text NULL,            -- BullMQ job correlation
  parent_run_id uuid NULL,     -- self-FK for step rows
  input jsonb NULL,
  output jsonb NULL,
  error_message text NULL,
  started_at, completed_at, created_at timestamptz,
  batch_checkpoint jsonb NULL  -- Spec 61.4: {stepKey, batchRequestId, accumulatedOutput}
)
```

**Enum `pipeline_run_status` values**: `queued, running, completed, failed, cancelled, batch_pending` — confirmed via `enum_range()`.

Counts:
- 1419 total rows
- 1264 completed (89%)
- 155 failed (11%)
- **0 in `batch_pending`**, **0 rows with `batch_checkpoint IS NOT NULL`** — Spec 61.4 is wired but field-untested.

Top pipelines by run count: `article:social-image` (534), `article:blog` (214), `astro:repo-import` (207), `article:schema-extension` (138), `article:translation` (104).

Highest failure rates worth noting: `article:pagespeed-validation` 19/19 failed (100%), `article:astro-sync` 4/5 failed (80%), `cold-start:voice-refinement-questions` 16/18 failed (89%), `cold-start:competitor-questions` 4/8 failed (50%).

**BullMQ-side state**: each job carries `{pipelineName, projectId, input, preRunId?, resumeFromStep?, batchResult?, priorOutput?}` (Zod-validated in `queue.ts:15`). After job completion the data is removed per `removeOnComplete: {count:100, age:7d}` — the **only** durable state is `pipeline_runs`.

### 1.5 Signal-Snapshots

`external_signals` is the snapshot table.

```
external_signals(
  id uuid, project_id uuid, source text,    -- CHECK source IN (producthunt|hackernews|vendor_rss|reddit|github|dataforseo_trends)
  external_id text,                          -- dedup key
  title, url, summary, author text,
  published_at timestamptz,
  raw_payload jsonb,                         -- full source payload
  metrics jsonb,
  collected_at, processed_at, expired_at timestamptz,
  processed_into uuid FK → topic_briefs.id   -- nullable
)
UNIQUE (source, external_id)
INDEX unprocessed: project_id, collected_at WHERE processed_at IS NULL
```

Live state (only **3** sources active out of 6 allowed):
| Source | Count | Last collected | Unprocessed |
|---|---|---|---|
| `vendor_rss` | 54 | 2026-05-15 17:03 | 12 |
| `producthunt` | 36 | 2026-05-15 17:03 | 1 |
| `hackernews` | 2 | 2026-05-15 14:41 | 1 |
| `reddit` | 0 | — | — |
| `github` | 0 | — | — |
| `dataforseo_trends` | 0 | — | — |

**Stale.** Last successful collection was **5 days ago** (2026-05-15). Cron is currently `// disabled` in `apps/api/src/workers/index.ts:180-182` — manual trigger only.

`ExternalSignalSource<Input>` implementations (5 total):
- `@marketing-auto/adapter-producthunt` — OAuth API, free
- `@marketing-auto/adapter-hackernews` — Algolia search API, free
- `@marketing-auto/adapter-vendor-rss` — RSS poll, free
- `@marketing-auto/adapter-reddit` — OAuth2 client_credentials, free
- `@marketing-auto/adapter-github-trending` — PAT-auth GitHub search, free

`dataforseo_trends` is in the CHECK constraint but has no `ExternalSignalSource` adapter — it's consumed inline in `topic-sources/trend-discovery/score.ts` via `dataforseo.trendsExplore()`.

### 1.6 Cost-Logs Analyse

```
cost_logs(
  project_id, service cost_service ENUM, operation text, cost_eur numeric(10,6),
  metadata jsonb, pipeline_run_id, article_id, created_at
)
```

**Service distribution** (4 distinct):
- `anthropic` 856 (80%)
- `dataforseo` 148 (14%)
- `voyage` 39 (4%)
- `replicate` 28 (3%)

**Top 10 operations by spend (last 30d)**:
| service | operation | n | avg € | max € | total € |
|---|---|---|---|---|---|
| anthropic | article-draft | 29 | 0.1608 | 0.2423 | **4.66** |
| anthropic | article-outline | 37 | 0.1068 | 0.2971 | **3.95** |
| anthropic | trend-synthesis | 10 | 0.3260 | 0.4141 | **3.26** |
| anthropic | research-competitor-synthesis | 32 | 0.0388 | 0.0964 | 1.24 |
| anthropic | discovery-backfill-classify | 275 | 0.0041 | 0.0059 | 1.12 |
| replicate | hero-image-generation | 28 | 0.0368 | 0.0368 | 1.03 |
| anthropic | translate-draft | 8 | 0.0862 | 0.0996 | 0.69 |
| anthropic | article-self-review | 38 | 0.0180 | 0.0343 | 0.69 |
| anthropic | schema-rich-detection | 26 | 0.0235 | 0.0644 | 0.61 |
| anthropic | social-image-extract | 160 | 0.0034 | 0.0104 | 0.54 |

**Batch operations** (`operation LIKE 'batch:%'`): **0 rows**. Pattern 120 (Spec 61.4) prescribes `service="anthropic" operation="batch:<model>"` but no batch has been processed yet. The DB enum `cost_service` does NOT have a `batch_api` value (the CLAUDE.md rule is "all LLM calls go under `anthropic`").

**Last 10 entries**: all on 2026-05-19 21:14-21:15, all `service=anthropic, operation=audit:caption-eval, cost_eur≈0.0006` (a quality-audit pass). Notably **`has_run=false`** on all 10 — these audit calls don't link to a `pipeline_run`. **Implication for 62**: cost estimation by pipeline-run-ID will undercount audit and ad-hoc tooling calls.

### 1.7 article_discovery Verteilung

- 274 rows total, 1:1 with articles where discovery has run.
- Source breakdown via JOIN articles: **262 imported, 12 generated**.
- Locale: **DE 139 / EN 135** (near-even split).
- All 274 rows have `enrichment_mode='llm_enriched'` (no `metadata_only` or `fallback` rows).
- Age: oldest=newest=2026-05-13, p50=7 days, avg=7 days. **Discovery has not run in the last 7 days** — confirmed via `MAX(created_at)`.
- Quality: DE avg completeness 0.499, EN avg 0.523; DE avg 1424 words, EN avg 1643 words.
- `content_hooks` is always populated as a JSONB array; `suggested_templates` is always a JSONB array (avg 4 entries).

Sample row (curated): `article_id=…, word_count=4203, narrative_arc=A 2026 practical verdict on whether ChatGPT Plus's $20/month subscription justifies its cost…, enrichment_mode=llm_enriched, completeness_score=0.700, hooks_type=array, suggested_count=4`.

---

## Phase 2 — Code-Inventur

### 2.1 Pipeline-Inventur

20 pipelines registered at worker startup (`apps/api/src/workers/index.ts:111-133`). All run via the central `runPipeline` (sync) or via the `pipelines` BullMQ queue.

| Pipeline name (BullMQ key) | Class | Steps inferred | LLM steps | Batch-capable | Run count |
|---|---|---|---|---|---|
| `article:outline` | `ArticleOutlinePipeline` | Outline + Persist | OutlineStep | yes (61.4) | 48 |
| `article:draft` | `ArticleDraftPipeline` | Draft + Persist + ToolLinker + SelfReview | DraftStep, SelfReviewStep | partial | 65 |
| `article:blog` | `BlogPipeline` | 13–14 steps (AuthorPick → ToolRel → TopicIntake → Research → Outline → PersistOutline → Draft → PersistBody → ToolLinker → SelfReview → HeroImage → Assembly → PersistArticle → SocialGeneration*) | Outline/Draft/SelfReview + optional SocialGen | partial | 214 |
| `article:refresh` | `RefreshPipeline` | 8 (RefreshIntake → ToolRelevance → Outline → PersistOutline → Draft → PersistBody → ToolLinker → SelfReview) | Outline+Draft+SelfReview | partial | 4 |
| `article:translation` | `TranslationPipeline` | 7 (TranslationSetup → Decision (Haiku) → Body → PersistBody → ToolLinker → SelfReview → PersistArticle) | Decision+Body+SelfReview | partial | 104 |
| `article:hero-generation` | `HeroImageGenerationPipeline` | Hero | (Replicate) | no | 31 |
| `article:localize` | `LocalizeArticlePipeline` | LegacyTwoCall | LocalizeBody (Sonnet ×2) | no | 16 |
| `article:schema-extension` | `SchemaExtensionPipeline` | Detect + Persist + (assembly) | SchemaRichDetect | partial | 138 |
| `article:social-image` | `SocialImagePipeline` | 7 (Extract → Hook → Caption → Render → Persist) | ExtractTools/Hook/Caption | partial | 534 |
| `article:astro-sync` | `ArticleSyncPipeline` | git + write + push | none | no | 5 |
| `article:pagespeed-validation` | `PageSpeedValidationPipeline` | local Lighthouse + persist | none | no | 19 |
| `article:pagespeed-api-validation` | `PageSpeedApiValidationPipeline` | PageSpeed API | none | no | 0 |
| `article:cluster-link-rebuild` | `ClusterLinkRebuildPipeline` | rebuild links | none | no | n/a |
| `astro:repo-import` | `RepoImportPipeline` | git clone + walk + parse + insert | none | no | 207 |
| `cold-start:cluster-plan` | `ClusterProposePipeline` | LLM | yes | partial | n/a |
| `cold-start:cornerstone-list` | `CornerstoneListPipeline` | LLM | yes | partial | n/a |
| `cold-start:competitor-analysis` | `CompetitorAnalysisPipeline` | LLM | yes | partial | 6 |
| `cold-start:competitor-questions` | `CompetitorQuestionsPipeline` | LLM | yes | partial | 8 |
| `cold-start:voice-refinement-questions` | `VoiceRefinementQuestionsPipeline` | LLM | yes | partial | 18 |
| `cold-start:voice-synthesis` | `VoiceSynthesisPipeline` | LLM | yes | partial | 2 |
| `cold-start:go-live-checklist` | `GoLiveChecklistPipeline` | check | LLM-light | no | n/a |

**Batch-capable** = the step uses `batchLlmCall({ mode: ctx.llmMode, … })` (Pattern 118+119, Spec 61.4). Confirmed in `OutlineStep` and other LLM steps per the CLAUDE.md hint "see `OutlineStep` for the canonical check". **None of these have actually run in batch mode yet** — `batch_requests` is empty.

**`enqueuePipeline()` entry points** (from `routes/_lib/trigger-helpers.ts`): all HTTP triggers go through `triggerWithPreRunId` or `checkTriggerAllowed`. Cold-start CLI scripts call `runPipeline` synchronously without BullMQ.

### 2.2 BaseStep / PipelineRunner Architektur

**`BaseStep<TInput,TOutput>` at `packages/pipelines/src/engine/step.ts:49`** — abstract class, not interface:

Required: `name`, `inputSchema`, `outputSchema`, `execute(input, ctx): Promise<TOutput>`.

Optional:
- `idempotencyKey(input): string | null` — **default returns `null`**. Comment at `runner.ts:176` says "Idempotency key computed (caching not yet implemented)" → **the caching shortcut is NOT live yet**. Steps document an idempotency key, the runner logs it, but **does not skip re-execution**. This matters for 62: any "Resume after edit-input" path will re-charge every prior step unless we wire actual caching here.
- `estimatedCostEur(input): number` — default 0. Used by cost-budget pre-flight (`triggerWithPreRunId`).
- `shouldRun(ctx): Promise<boolean>` — Pattern 102 (Spec 60.7). Runner calls before execute.
- `skipOutput(input): TOutput` — must be defined when shouldRun is. Validated through outputSchema.

**`StepContext`** (passed to every `execute()`):
- `projectId`, `pipelineRunId`, `stepRunId`, `pipelineName`, `log`
- `llmMode: "sync" | "batch"` — loaded from `projects.llmMode` once per pipeline run (`runner.ts:71-76`)
- `batchResult?: {stepKey, content}` — set only on the one step being resumed
- `reportProgress(percent, message)` — writes to `pipeline_runs.output` for the step row
- `getStepOutput<T>(stepName): T | undefined` — read prior step outputs without re-running

**`Pipeline<TInput,TOutput>` at `pipeline.ts:17`**:
- `name`, `inputSchema`, `outputSchema`, `steps: ReadonlyArray<BaseStep<unknown,unknown>>`
- `bridge(fromStep, toStep, output, pipelineInput, getStepOutput)` — sync only, default = identity
- `afterComplete?(output, pipelineInput, runId)` — try-catch wrapped, failures `log.warn`, do NOT fail pipeline
- `afterError?(error, pipelineInput)` — guaranteed cleanup hook, same try-catch semantics

**`runPipeline(pipeline, input, options, reportJobProgress?)`** at `runner.ts:62-390` — the single execution path used by BullMQ workers and Cold-Start CLI scripts. Persists every step as its own `pipeline_runs` row (parent_run_id = parent).

**`enqueuePipeline()` at `queue.ts:90`** wraps `runPipeline` for async BullMQ execution. BullMQ defaults: `attempts: 1` (paid jobs must never auto-retry), `removeOnComplete {count:100, age:7d}`, `lockDuration: 10min`, `maxStalledCount: 0`.

**`batchPending` mechanism (Pattern 118, Spec 61.4)** — already implemented end-to-end:

1. Step's `execute()` returns `{batchPending: true, batchRequestId}` instead of throwing. Runner detects shape before `outputSchema.parse()` at `runner.ts:247-281`.
2. Runner writes `pipeline_runs.status='batch_pending'` and `batchCheckpoint={stepKey, batchRequestId, accumulatedOutput: stepOutputs}`.
3. Returns `{ok: false, suspended: true, runId, stepKey, batchRequestId}` to the BullMQ worker.
4. BullMQ worker treats suspension as job-complete (no retry) — `queue.ts:157-159`.

**Resume flow** (the missing-but-only-batch-API piece for 62.0):

1. `apps/api/src/workers/batch-processor.worker.ts` runs `submit-pending` every 30 min and `process-results` every 6h.
2. On Anthropic batch completion, `processResultItem()` writes `batch_requests.responseBody` + inserts a `cost_logs` row (Pattern 120) + calls `resumePipeline(batchRow)`.
3. `resumePipeline` (in `engine/batch-resume.ts:15`) reads the suspended `pipeline_runs` row → marks status=queued + clears `batchCheckpoint` → re-enqueues via `enqueuePipeline({…, preRunId: run.id, resumeFromStep, batchResult, priorOutput})`.
4. Runner skips already-completed steps via `priorOutput` (`runner.ts:117-152`) and injects `ctx.batchResult` only on the matching step.

**Resume mechanism for Theme 62's edit-input/edit-prompt/etc.** — the building blocks are right here. Adding a 7-action resume table = adding `step_pauses(pipeline_run_id, step_name, status, action, edited_input, edited_output, edited_prompt, …)` + a `paused` enum value + a polling worker that re-enqueues with `priorOutput + edited overrides`. The existing `priorOutput` machinery is the exact extension point.

### 2.3 LLM-Adapter (sync vs batch, forceSync, cost-hook)

**One adapter, two modes.**

`@marketing-auto/adapter-anthropic` exposes `anthropic.messages(MessagesInput)` for sync. The dual-mode wrapper is `batchLlmCall({mode, …})` at `packages/pipelines/src/engine/batch-llm-client.ts:150`:

- `mode: "sync"` → calls `anthropic.messages()` directly. Adapter writes `cost_logs` (so `service="anthropic"`, `operation=params.operation`, `cost_eur=…`, `pipeline_run_id` set).
- `mode: "batch"` → builds raw Anthropic batch-format request body, INSERTs `batch_requests` row with `anthropicCustomId = ${pipelineRunId}:${stepKey}`. Returns `{mode:"batch", batchRequestId, outputTokens:0}`. Cost row is NOT written here — it's written by `batch-processor.worker.ts` after `processResultItem` succeeds (Spec 61.4 Pattern 120).

**No `forceSync` parameter** — `mode` is bound at the pipeline-run boundary in `runner.ts:71-76` via `projects.llmMode`. Steps cannot override mid-pipeline. **Implication for Theme 62 Debug-Run**: we either flip `projects.llmMode='sync'` per-debug-session (heavyweight) or add an `overrideLlmMode` to `StepContext` and let the runner inject it from a debug flag in `PipelineRunOptions`. The latter is a small addition (~15 LoC).

**Cost-logging hook site**: lives **in the adapter** for sync calls (the adapter wraps every `anthropic.messages` call with cost tracking). For batch calls, it lives **in `batch-processor.worker.ts:192-207`** where `processResultItem` inserts into `cost_logs` after reading the batch response usage tokens. There is NO cost-logging in the Runner. The `cost_eur` field on `pipeline.step.completed` events is hardcoded to 0 (see `runner.ts:303`) — UI must aggregate from `cost_logs` separately.

**Cost-pre-flight**: `BaseStep.estimatedCostEur(input)` summed across pipeline steps → `triggerWithPreRunId` does the budget check against `cost_logs` rolling window → returns 402 if exceeded. The +15% safety buffer that 62.3 wants is a multiplier the helper can add directly.

### 2.4 Signal-Adapter Impls + last-run + APIs

5 `ExternalSignalSource<Input>` implementations:

| Adapter | Package | API | Auth | Free? | Last successful run |
|---|---|---|---|---|---|
| ProductHunt | `@marketing-auto/adapter-producthunt` | Product Hunt OAuth API | api_key + api_secret | Yes | 2026-05-15 17:03 |
| HackerNews | `@marketing-auto/adapter-hackernews` | Algolia HN search API | none | Yes | 2026-05-15 14:41 |
| Vendor RSS | `@marketing-auto/adapter-vendor-rss` | Multiple RSS feeds | none | Yes | 2026-05-15 17:03 |
| Reddit | `@marketing-auto/adapter-reddit` | Reddit OAuth2 client_credentials | client_id + client_secret + user_agent | Yes | **never** |
| GitHub | `@marketing-auto/adapter-github-trending` | GitHub Search API | personal_access_token | Yes | **never** |

Reddit + GitHub adapters are wired into the signal-collector at `apps/api/src/workers/signal-collector.ts:220-272`, registered in `cron_state` via `cron_job_type` enum (Reddit, GitHub variants exist), but no project has them enabled yet — confirmed by `external_signals.source` distribution.

**`dataforseo_trends`** is consumed directly by `topic-sources/trend-discovery/score.ts` (`dataforseo.trendsExplore()` calls) — it does NOT have an `ExternalSignalSource` adapter. Spec 62.3 ComparisonDiscovery would likely follow the same pattern (direct adapter call inside a TopicSource).

**Credentials**: stored in `global_credentials` table, keyed by `service: text` (no `credential_type` enum). Read via `readAdapterCreds(service)` in `apps/api/src/lib/system-service.ts`.

**Env vars**: `getEnv()` from `@marketing-auto/shared` (Zod-validated `envSchema` in `packages/shared/src/config.ts`). `REDIS_URL`, `ANTHROPIC_API_KEY`, `SIGNAL_COLLECTOR_CRON`, `TREND_SYNTHESIZER_CRON`, etc.

### 2.5 Discovery-Module + ContentDiscoveryUI

No single backend "ContentDiscoveryUI" module exists. The discovery surface is spread across:

- **Gap discovery** — `apps/api/src/lib/gap-service.ts` (`suggestGapTitle`) + the `gap-auto-approver.ts` worker. Driven by `content_gaps` table (166 rows, 175 open, 24 resolved/dismissed/in_progress).
- **Trend discovery** — `packages/pipelines/src/topic-sources/trend-discovery/` (TrendDiscoveryTopicSource + `score.ts`, `coverage.ts`, `cluster-match.ts`, `synthesize.ts`, `emit-brief.ts`) + `apps/api/src/workers/trend-synthesizer.ts`. Produces `topic_briefs` (184 rows, of which 23 from trend_discovery).
- **Refresh detection** — `apps/api/src/workers/refresh-detector.ts` + `refresh_suggestions` table (0 rows — never populated yet) + `refresh_dismissed`. The DB layer is ready, the cron writes nothing currently.
- **Discovery worker** — `apps/api/src/workers/discoveryWorker.ts` runs the per-article post-draft enrichment that populates `article_discovery` (hooks, suggested_templates, narrative_arc) and `template_renders` suggestions.

**Frontend "ContentDiscoveryUI" referenced in Spec 56.6** is actually a set of distributed components (per Explore agent report):
- `TrendsListPage.vue` + `TrendDetailPage.vue` (approve / dismiss brief)
- `BriefsPage.vue` (3-section backlog: pending/in-flight/done with bulk approve+dismiss)
- `ClusterDetailPage.vue` (approve plan)
- `ArticleSocialTab.vue` (template picker + per-template generate)
- `RefreshQueuePage.vue` + `QualityFindingsModal.vue`

Backend endpoints these consume:
- `POST /projects/:slug/briefs/:id/approve|dismiss`
- `POST /projects/:slug/briefs/bulk-approve`
- `POST /projects/:slug/clusters/:id/approve-plan`
- `POST /projects/:slug/content-gaps/:id/suggest|generate|automate`
- `POST /projects/:slug/articles/:id/social/:locale/:templateKey/generate`
- `GET /projects/:slug/template-suggestions` + `/all-templates`

**ComparisonDiscovery module — does NOT exist.** No code path generates a tool-pair / co-mention / comparison-gap signal. To slot it in:

- Inputs needed: tool-list (already on `articles WHERE collection='tools'`), co-mention signal (could be derived from `article_discovery.referenced_tools` jsonb arrays joined across the article corpus), search-volume pair data (DataForSEO `relatedKeywords` with two seed terms).
- Most natural shape: `ComparisonDiscoveryTopicSource implements TopicSource<Input>` in `packages/pipelines/src/topic-sources/comparison-discovery/` emitting `TopicBrief` rows with `cluster_action='create_new'` or `'append_to_existing'` and `source='manual'` (until we add a `'comparison_discovery'` value to the `topic_briefs.source` CHECK constraint).

### 2.6 Sibling-Locale-Logik + 60.7 silent-skip

**Translation key linking**: `articles.translation_key text NULL` is the join key. Project-scoped by convention but NOT by DB unique constraint (warning in root CLAUDE.md).

**`findSibling()`** at `packages/pipelines/src/article/translation/sibling.ts:12` is the canonical lookup. Bidirectional since Spec 59.2 — given any article, returns the opposite-locale sibling. `findEnSibling = findSibling` (line 38) is a backward-compat alias.

**EN sibling generation**: `TranslationPipeline` (article:translation) with three modes — `fresh_translation`, `refresh_propagation`, `manual_resync`. Auto-triggered from `BlogPipeline.afterComplete` and `RefreshPipeline.afterComplete` when `project.targetLocales` includes the opposite-locale BCP-47 tag AND `project.translationAutoTrigger=true`.

**60.7 "Sibling-Skip silent" — confirmed and located**:
- Site: `packages/pipelines/src/article/blog/pipeline.ts:390-411`.
- Logic: `BlogPipeline.afterComplete` calls `findSibling(articleForSibling)` first; if a sibling exists, `log.info(…, "[blog] sibling already exists — skipping auto-translation")` and returns.
- **The skip emits an info log but no DB row, no notification, no UI hint.** Marcel cannot see why a given DE article has no EN twin without grepping `pipeline_runs.output` or worker logs.
- Failure-mode-twin at `:413`: when the auto-trigger throws, it `log.warn(…, "[blog] translation auto-trigger failed — skipped")`. Same silent-skip pattern.

**Proactive detection in a Planner step**: the planner-engine can call `findSibling(article)` for every DE article it plans, surface `needs_en_translation` flags up-front in `planned_items`, and explicitly schedule a Translation pipeline run (with `preRunId`) so it's a first-class item the user sees in the calendar — not an invisible auto-skip downstream.

### 2.7 BullMQ-Queue-Inventur

**9 BullMQ queues** running in the single worker process (`apps/api/src/workers/index.ts`):

| Queue | Worker file | Concurrency | Attempts | Notes |
|---|---|---|---|---|
| `pipelines` | engine/queue.ts (started via `startPipelineWorker`) | **5** | **1** | Paid LLM jobs — auto-retry would re-charge. lockDuration=10min, maxStalledCount=0. |
| `scheduled` | engine/scheduler.ts (`startScheduler`) | default | default | **All registered scheduled jobs commented out** (`workers/index.ts:137-158`). Effectively idle. |
| `discovery` | discoveryWorker.ts (`startDiscoveryWorker`) | (default) | (default) | Per-article enrichment. |
| `signal-collector` | signal-collector.ts | **4** | **3** (expo backoff) | Free APIs — retries OK. |
| `cron-orchestrator` | cron-orchestrator.ts | **1** | default | Repeating every 1 min, syncs `cron_state` → repeating BullMQ jobs across queues. |
| `trend-synthesizer` | trend-synthesizer.ts | (per file) | (per file) | Daily synth of external_signals → topic_briefs. |
| `refresh-detector` | refresh-detector.ts | (per file) | (per file) | Detects refresh candidates by staleness + quality findings. |
| `gap-auto-approver` | gap-auto-approver.ts | (per file) | (per file) | Cron disabled (`workers/index.ts:189` comment). |
| `social-render` | social-render.worker.ts (queue defined in `engine/social-render-queue.ts`) | **1** | (per Spec 57.2) | Real Remotion render + R2 upload — heavy/sequential by design. |
| `article-quality-analysis` | article-quality-analysis.worker.ts | (per file) | (per file) | Standalone pipeline (Spec 58.1 pattern). Cron-batch + per-item job shapes (Pattern from Spec 61.4). |
| `batch-processor` | batch-processor.worker.ts | **1** | default | 2 repeatable jobs: submit-pending every 30 min, process-results every 6h. |

**`cron_state.job_type`** ENUM = `{trends_synthesizer, refresh_detector, quality_analysis, signal_collector_reddit, signal_collector_github, signal_collector_hackernews, signal_collector_producthunt, signal_collector_vendor_rss}` — 8 job types.

**Single-worker PID lock** at `apps/api/src/workers/index.ts:59-94`: writes to `tmp/worker.pid`, SIGTERMs any previous holder.

### 2.8 UI-Layer (pages, Cmd+K, Cron config, calendar, settings)

(From parallel Explore agent — file paths and line numbers verified.)

- **Router**: `apps/web/src/router/index.ts:11-230`. Hub paths: `/projects/:slug/{dashboard,articles,briefs,clusters,settings,costs,article-tools,trends,refresh-queue}`. Cold-start: `/cold-start/new` + `/cold-start/:draftId/phase-[1-5]`.
- **Cmd+K palette EXISTS**: `apps/web/src/components/search/CommandPalette.vue` (246 lines). 3 sections — Articles, Briefs, Clusters — driven by `GET /projects/:slug/search?q=…`. Wired in `AppShell.vue` via `useKeyboardShortcuts.ts`. **Adding a Theme 62 "Plan This Week" / "Show Quarantine" / "View Goal" action = additive — same registration pattern.**
- **Cron toggles EXIST** for 3 jobs in `SettingsProjectPage.vue:301-404` (Trends Synthesizer, Refresh Detector, Quality Analysis) with `CronStatusDisplay.vue` showing `isActive / cronPattern / lastRunAt / lastRunStatus / nextRunAt` and a "Run Now" button. Per-signal-source cron toggles in `SignalSourceCard.vue:50-59`.
- **Calendar view DOES NOT EXIST.** No `QCalendar`, no `FullCalendar`, no custom week-view component. Theme 62 will need to introduce one (Quasar QCalendar is the natural pick).
- **Settings has 5 tabs**: `project, brand-tokens, brand-assets, credentials, signal-sources`. Adding a `goals` (or `planner`) tab is one router child + one page. The `SettingsProjectPage.vue` already houses 9 form sections — extending it is the path of least resistance, but a dedicated `SettingsPlannerPage.vue` keeps Theme 62 isolated.
- **Pipeline run inspector**: no single page. `ClusterRunsPanel.vue` shows `pipeline_runs` for a cluster, `PipelineStepTimeline.vue` (in `components/pipeline/`) is used in cold-start phases, `RefreshQueuePage.vue` shows quality-finding modals. **There is no "step output JSONB viewer + 7-action toolbar" anywhere.** Theme 62.6 has to build this from scratch (likely a new `components/pipeline/StepInspector.vue` with prompt-editor + JSON-editor + action buttons).
- **Notification center**: `AppTopbar.vue:44-102` with bell-icon dropdown, unread count poll every 60s, mark-all-read. Suitable surface for "Plan Ready" notifications via `createNotification({type:"plan_ready", …})`.

---

## Phase 3 — Gap-Analyse & Findings

### 3.1 Vorhanden vs. Fehlend (Tabelle)

| Komponente | Status | Pfad falls vorhanden | Bemerkung |
|---|---|---|---|
| PipelineRunner mit generischem Suspend/Resume | **vorhanden** (batch-API-only) | `packages/pipelines/src/engine/runner.ts:62` + `batch-resume.ts:15` | Today: suspend triggered ONLY by `{batchPending: true}` signal. No generic "pause-for-human" — that's the Theme 62.0 extension. The mechanism (status=batch_pending, batchCheckpoint, priorOutput on resume) is the exact template to copy for step-pause. |
| Step-Level Pause (jenseits batchPending) | **fehlt** | — | Add a new `paused` status value to `pipeline_run_status` enum + a parallel signal `{stepPaused: true, action: "approve"|"edit-output"|…}` shape returned from `execute()`. |
| Step-Pause-Persistenz (Input + Output je Step) | **teilweise** | `pipeline_runs.input/output JSONB` per step row | Every step row already stores `input` + `output` JSONB. What's missing is a) the "frozen at suspend point" view of intermediate output that the user can edit before resume, and b) the `step_pauses` row tracking which action the user picked. |
| Resume-Action-Handler (7 actions) | **fehlt** | — | Build a `step_pauses(action, edited_input?, edited_output?, edited_prompt?, requested_at, resolved_at, resolved_by)` table + an `apps/api/src/lib/step-pause-service.ts` that translates each action into a `priorOutput`/`batchResult`/`overrideInput` payload re-enqueued via `enqueuePipeline`. |
| Prompt-Versionierung (systematische Struktur) | **teilweise** | `project_configurations.masterPrompts` JSONB (Spec 54.2) | Single-active-version-per-project for 5 hardcoded keys. No history, no diff, no rollback. 62.1 must extend this into a versioned table (`prompt_versions(prompt_key, version, body, created_at, created_by, is_active)`) AND broaden the keys list (cluster-creator, trend-synthesis, etc. should be overridable too). |
| Golden-Set Definition | **fehlt** | — | New table `prompt_golden_samples(prompt_key, sample_input jsonb, expected_output jsonb, last_run_at, last_run_result jsonb)` + a CLI script that replays the active prompt against the sample set. |
| `project_goals` Tabelle | **fehlt** | — | New. Per-project weekly floors: clusters_per_week, comparisons_per_week, social_per_day_avg, ki_wissen_per_week, etc. |
| `goal_overage_policies` Tabelle | **fehlt** | — | New. Optional — could be a JSONB column on `project_goals` if simple. |
| `weekly_plans` Tabelle | **fehlt** | — | New. `(project_id, iso_week, status, generated_at, approved_at, plan_input_snapshot jsonb, total_cost_estimate_eur)`. |
| `planned_items` Tabelle | **fehlt** | — | New. `(weekly_plan_id, day, item_type, role_within_cluster, cluster_id, brief_id, locale, pipeline_name, predicted_cost_eur, status)`. |
| `pipeline_runs` Tabelle | **vorhanden** | `packages/db/src/schema/operations.ts` | 1419 rows. Has `batch_checkpoint` JSONB. Status enum includes `queued, running, completed, failed, cancelled, batch_pending` — add `paused`. |
| `step_pauses` Tabelle | **fehlt** | — | New. See "Resume-Action-Handler" row. |
| `step_optimization_requests` Tabelle | **fehlt** | — | New. Triggered by the "Extract for optimization" action — captures the (step_name, input, output, prompt_at_run_time, user_note) for offline review. |
| `prompt_versions` Storage | **fehlt** (file-based today) | — | See "Prompt-Versionierung". |
| `signal_snapshots` Tabelle | **vorhanden** (as `external_signals`) | `packages/db/src/schema/cron.ts` (or wherever externalSignals lives) | 92 rows. Already has dedup unique index, processed/expired columns. Plan-Engine can read from here directly — no new table needed unless we want "as-of-week-N frozen pool". |
| `content-planner` BullMQ-Queue + Worker | **fehlt** | — | New queue + worker. Standalone-worker pattern from Spec 58.1 is the template (article-quality-analysis is the canonical example). |
| `PlanWeekPipeline` | **fehlt** | — | New `Pipeline` subclass in `packages/pipelines/src/planner/`. |
| `CostEstimator`-Modul mit Pre-flight aus cost_logs | **teilweise** | `packages/cost-tracker/`, `BaseStep.estimatedCostEur()`, `triggerWithPreRunId` cost-budget guard | Pre-flight check exists per-pipeline. The Theme 62 +15% safety-buffer-weekly-budget is a new aggregator on top: sum predicted-cost across `planned_items`, compare to `€50 × 1.15`. |
| ComparisonDiscovery-Modul | **fehlt** | — | New TopicSource at `packages/pipelines/src/topic-sources/comparison-discovery/`. See 2.5 for input sources. |
| Goal-Editor-UI | **fehlt** | — | New tab in Settings (or in a new `/projects/:slug/planner` route). |
| Weekly-Plan Kalender-UI | **fehlt** | — | New page. No existing calendar component to reuse — pick QCalendar. |
| Approval-Flow-UI (Plan Approval) | **fehlt** | — | New. Pattern from `BulkApproveModal` in `BriefsPage.vue` is the analog. |
| Debug-Run Step-Inspector-UI (mit JSON-Editor, Prompt-Editor, 7 Actions) | **fehlt** | — | New `components/pipeline/StepInspector.vue`. JSON editor: `<JsonEditor>` (`vue-codemirror` already in deps per root CLAUDE.md — use `@codemirror/lang-json`). |
| Cron-Toggle in Settings (Planner) | **vorhanden, erweiterbar** | `SettingsProjectPage.vue:301-404` + `cron_state` table | Add `cron_job_type = 'content_planner'` enum value + a 4th toggle card following the same `CronStatusDisplay` pattern. |
| Quarantäne-View | **fehlt** | — | New page or filter on Activity. Driven by `pipeline_runs.status='failed'` joined with `planned_items.status='quarantined'` (new column on planned_items). |
| Notification (Mail) bei Plan-Ready | **teilweise** | `notifications` table + `web-push`, `nodemailer` adapters | The notification rail exists. Mail per `email.sendEmail()`. Adding a `plan_ready` type to `notifications.type` + a trigger in PlanWeekPipeline.afterComplete = 1 small change. |

### 3.2 Risiken & Stolpersteine

1. **Batch-API resume path is implemented but field-untested.** `batch_requests=0`, `pipeline_runs.batch_pending=0`. Marcel's Theme 62 step-pause builds directly on this pattern (`batchCheckpoint`, `priorOutput`, `resumeFromStep`, `ctx.batchResult`). If there's a bug in the actual Anthropic batch round-trip (encoding, custom_id parsing, content extraction at line 173), it will surface for the first time inside Theme 62. **Recommendation: Spec 62.0 must include "exercise the existing batch path end-to-end first" as a precondition** — pick the smallest existing batch-capable step, flip `projects.llmMode='batch'` on a test project, run an article:outline, verify a resume completes successfully. This catches latent 61.4 bugs before we extend them.

2. **`BaseStep.idempotencyKey()` is documented but not honored.** Runner comment at `runner.ts:174-176`: "Idempotency key computed (caching not yet implemented)". Every step has the contract, no step actually skips on re-run. For Theme 62, this means: a Resume after `edit-input` will re-execute every step from step 1 unless the runner is taught to check idempotencyKey against prior step outputs. **Either we wire it now (in 62.0) or accept that `priorOutput`-based skipping is the only resume mechanism — which is fine for batch resume but problematic for edit-input.** Decision needed.

3. **Sibling auto-translation skip is silent.** `blog/pipeline.ts:407` `log.info("… skipping auto-translation")` with no DB row, no notification. A planner that pre-detects siblings (per 2.6) is the fix, BUT we have to be careful that the planner's proactive scheduling doesn't double-trigger a translation that the existing `BlogPipeline.afterComplete` ALSO triggers. **Recommendation: when a planned_item is `kind="translation"`, mark the source article as `skip_auto_translation=true` for that planning window** — or short-circuit `BlogPipeline.afterComplete` when a `planned_items` row covers the sibling.

4. **Idempotency of "Approve" after JSONB-key-order issue (60.0b)**. Spec 60.0b found that JSONB columns lose key order after Postgres round-trip. Re-writing through canonical Zod schemas on every write is the fix already documented. For Theme 62 step-pause, this means: when we persist `step_pauses.edited_output`, we MUST `outputSchema.parse(edited)` before INSERT — otherwise edited-output-and-approve will look "modified" on every reload because key order shifted.

5. **Cross-pipeline dependencies for week-level scheduling**:
   - Social posts (`article:social-image`) currently auto-enqueue from `BlogPipeline.afterComplete` and from the dedicated `template_renders` flow. A planner that schedules separate social-renders for the same day must avoid double-triggering. **The `template_renders` table already handles dedup via its `template_renders_unique_combo` partial unique index** (`(article_id, template_key, locale, theme) WHERE status IN ('pending','rendering','ready')`) — Theme 62 can lean on that.
   - Schema extension (`article:schema-extension`) is automatically triggered after blog completion. If 62 schedules an explicit schema-extension run, the auto-trigger needs to be aware via the chain-mechanism (Spec 49d already exists for this).
   - **Cluster sequencing**: Spec 54.12 introduced "Hub-first" sequencing — hub article must complete before spokes are enqueued. Theme 62's daily-cluster cadence MUST respect this; the cluster completion check (`checkClusterCompletion`) is the existing hook.

6. **Step-Level Retry vs. Pipeline-Kill semantics**. Currently `attempts: 1` on the `pipelines` queue means: any failure inside any step = entire run is `status="failed"`, no resume. There IS a resume endpoint (`POST /pipeline-runs/:id/retry`) per `apps/api/CLAUDE.md` but it re-enqueues the same input from scratch. **Theme 62.7 Quarantine must be more granular**: a Quarantäne-row should let the rest of the week's plan proceed while the failed item is parked for human inspection. Implementing this requires the `planned_items.status` to have its own state-machine (`pending → running → completed | quarantined | failed`) independent of `pipeline_runs.status`.

7. **60.7 silent skip — feature or bug?** Looking at the code at `blog/pipeline.ts:390-411`: this is intentional ("Guard: skip if sibling already exists (refresh handles propagation separately)"). It's a feature in isolation, but creates a discoverability problem at the system level — Marcel has no UI signal that "EN was not created because it already exists". **Theme 62 should treat this as a planner concern (proactive detection per 2.6), not as a refactor of `BlogPipeline.afterComplete`.**

### 3.3 Quickwin-Bestätigung

1. **Dry-Run-Modus für Plan-Generierung** (LLM-Calls geskippt, nur Cost-Estimate).
   **VERIFIED implementable.** `BaseStep.estimatedCostEur(input)` is already the contract for pre-LLM cost prediction. A `PlanWeekPipeline` with steps that compute `estimatedCostEur` without making the actual call is the natural shape. The cost-tracker's `assertCostBudget` already does pre-flight on `cost_logs` — multiplying by 1.15 is a trivial change. **Concrete approach**: add a `dryRun: boolean` field to `PlanWeekPipelineInput` schema; in each step's `execute()`, if `input.dryRun`, return `{cost: estimatedCostEur(input), plan: planned_items_array}` without invoking LLM steps. The runner doesn't need changes.

2. **Sibling-Locale-Aware Planning vorab im Plan-Step.**
   **VERIFIED implementable.** `findSibling(article)` (`packages/pipelines/src/article/translation/sibling.ts:12`) is a synchronous DB query with no LLM involvement. The Plan-Step can iterate over planned DE articles and call `findSibling(planned_article)` before emitting `planned_items` — and explicitly emit a `kind="translation"` row only when no sibling exists. **Concrete coupling**: the planner must mark its scheduled `kind="article"` rows with `pre_skip_auto_translation=true` so `BlogPipeline.afterComplete` knows the planner owns the EN sibling.

3. **Failed-Step-Quarantäne** (rest of items proceeds).
   **CONFLICT with current BullMQ pattern.** Today, a failed `article:blog` run does not block other queued runs — the queue continues. So at the **BullMQ level** there's no collision. The problem is at the **Planner abstraction layer**: when we batch-enqueue 20 planned_items at the start of a week, a failure inside one cluster's hub article needs to STOP that cluster's spokes (Hub-first sequencing) but should NOT stop unrelated planned_items. The existing `checkClusterCompletion` + chain-mechanism (Spec 49d) already provides per-cluster sequencing. **Recommendation**: planned_items inherit `chainId` from the cluster they belong to, and a failed chain → all that cluster's still-pending planned_items go to quarantine; unrelated clusters continue. This is additive to existing patterns, no BullMQ rewiring needed.

### 3.4 Reihenfolge-Empfehlung (inkl. 62.0+62.1 Merge-Frage)

**Verdict: MERGE 62.0 and 62.1.** Here's why:

- Step-Pause-Persistenz (62.0) writes data structures (`step_pauses.edited_prompt`, `step_pauses.action='edit-prompt'`) that only make sense if there's already a versioned prompt store to compare against. Without 62.1 you'd build a 62.0 that points at the file-based prompts and breaks the moment 62.1 ships.
- Golden-Set (62.1) tables (`prompt_golden_samples`) need to attach to `prompt_versions` rows — which 62.0 doesn't define. Defining a stub `prompt_versions` in 62.0 just to support `step_pauses.prompt_version_id` then re-touching it in 62.1 is double-work.
- Both 62.0 and 62.1 touch the same `BaseStep` and `Pipeline` extension surface (resume action handler in 62.0, `prompt_version_id` in StepContext in 62.1). Merging means one round of `worker:restart` instead of two.
- Tests for 62.0 will reference golden-set fixtures anyway.

**Risk of merging**: bigger PR, more review surface. Mitigation: ship as **62.0a (foundation tables + step-pause mechanic)** and **62.0b (prompt_versions + golden_samples + 7-action extract-for-optimization)** as two sequential PRs against the same merged spec.

**Otherwise the rest of the ordering is sound.** Suggested adjustments:

- **62.3 Signal-Refresh + Cost-Estimator + ComparisonDiscovery** — bundle these. Cost-estimator can be split out if 62.0a needs it as a hard dep (it does — `assertWeeklyCostBudget` is called by the planner-engine in 62.4). **Suggest moving CostEstimator into 62.0a** alongside the +15% buffer. Then 62.3 becomes "Signal-Refresh + ComparisonDiscovery" — smaller, cleaner.
- **62.5 Kalender-UI** has no calendar component to reuse — budget extra time for QCalendar integration + a custom day-cell with hover-actions.
- **62.7 Cron-Trigger + Quarantäne-View** — Cron-trigger is trivial (one new `cron_job_type` enum value + one `SettingsProjectPage.vue` card). Quarantine-view is where the work is. Consider splitting: 62.7a Cron-Trigger, 62.7b Quarantäne.
- **62.8 Production-Run + Batch-API-Integration** — depends on the 62.0 recommendation in §3.2 risk #1 (exercise existing batch path first). **Add 62.8 prerequisite: Spec 61.4 batch-API has been validated end-to-end at least once in production.** If it hasn't, do that as a tiny "62.0a-pre" smoke test.

---

## Empfehlungen für Marcel

Concrete questions to answer before writing Spec 62.0:

1. **Idempotency-key caching** (§3.2 risk #2): wire it now in 62.0 (so `edit-input` re-runs don't re-charge), or punt to 62.x and accept that `edit-input` re-charges all prior steps? Latter is cheaper to ship but expensive at runtime; former is ~50 LoC in `runner.ts` + a per-step "completed-runs-by-idempotencyKey" lookup.

2. **`overrideLlmMode` in StepContext** (§2.3): Theme 62.6 Debug-Run wants per-run sync mode regardless of `projects.llmMode='batch'`. Adding `runOpts.overrideLlmMode?: 'sync'|'batch'` to `PipelineRunOptions` and passing it through is ~10 LoC. Confirm this is the right approach (vs. flipping `projects.llmMode` per session).

3. **Sibling-Skip coupling** (§3.2 risk #3): when the planner schedules a `kind="translation"` item, do we want to disable `BlogPipeline.afterComplete`'s auto-translation entirely for that week, or selectively per-article via a flag? Selective is cleaner but adds a column to `articles` (`skip_auto_translation_until timestamptz`).

4. **`pipeline_run_status` enum extension**: add `paused` value via migration before 62.0a, or include in the 62.0a migration? I'd lump it in.

5. **Quarantine + chain-orchestrator integration** (§3.3 quickwin 3): planned_items get a `chain_id` FK, or stand-alone with their own sequencing? The 49d `pipeline_chains` table already exists and works; reusing it as the cluster-sequencing primitive is tempting but couples Planner to Chains. **Decision: separate, but planned_items can OPTIONALLY reference a `chain_id` when one already exists for their cluster?** Need your call.

6. **Goal-Editor placement**: dedicated `SettingsPlannerPage.vue` as a 6th settings tab, or a section within `SettingsProjectPage.vue` (which already has 9 sections)? The former is cleaner; the latter is faster to ship.

7. **ComparisonDiscovery inputs** (§2.5): is co-mention from `article_discovery.referenced_tools` enough, or do we want DataForSEO `relatedKeywords` with two-seed-term queries as a primary signal? The latter costs money per call (€0.01-0.014 per call seen in cost_logs).

8. **Batch-API smoke test before 62.8** (§3.4): can we exercise 61.4 once before relying on it for 62.0's step-pause extension? Pick a low-cost step (e.g. `social-image-hashtags`) and run it in batch mode against a real project.

9. **Existing failure pile** (§2.1): `article:pagespeed-validation` has 19/19 failed (100%). Theme 62 plans will likely schedule this. Investigate before scheduling — or explicitly exclude pagespeed-validation from planner output until that's fixed.

10. **Signal staleness** (§1.5, §2.4): last `external_signals` collection was 2026-05-15, 5 days ago. Cron registration in `apps/api/src/workers/index.ts:180` is commented out. Re-enable signal-collector cron via `cron_state` (the runtime toggle exists per Spec 56.6) before scheduling Planner runs — otherwise the planner reads stale data.

---

_End of discovery findings. Next: Marcel reviews and answers the 10 questions above; then we write Spec 62.0a together._
