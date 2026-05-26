# Pipelines Package

The execution engine for all marketing pipelines. This is INFRASTRUCTURE — Phase 2+
specs build actual pipelines (article-generation, social-repurpose, identity-workshop)
on top of this.

## Key Concepts

**Step**: One unit of pipeline work. Has typed input/output, idempotency key, cost estimate.
**Pipeline**: Ordered list of steps. The output of step N becomes input of step N+1.
**Runner**: Executes a pipeline synchronously, persisting pipeline_runs rows.
**Queue**: BullMQ wrapper. Enqueue pipelines for async execution.
**Registry**: Pipelines must be registered at worker startup so BullMQ workers can find them.
**Scheduler**: Cron-style scheduled jobs (auth cleanup, daily briefings).

## Hard Rules

- Steps MUST be idempotent
- Steps MUST validate input/output via Zod
- Steps MUST use `@marketing-auto/cost-tracker` for any external API call
- Pipelines MUST be registered before workers start

## `pipeline_runs` row shape (Spec 004 F2)

Every pipeline run produces `1 + N` `pipeline_runs` rows where `N` = step count:

- 1 **parent row** (`parent_run_id IS NULL`, `step_name IS NULL`) for the whole run
- N **child rows** (`parent_run_id = parent.id`, `step_name = '<step>'`), one per step

INSERTed in [runner.ts:202](src/engine/runner.ts:202) (parent) and
[runner.ts:438-449](src/engine/runner.ts:438) (per-step children). This is **not** a bug
and **not** BullMQ-dedup artifacts — the child rows back step-pause FK
(Spec 62.0a), rerun supersession via `supersedeOldSubstep` (Spec 62.6),
SSE events (`step.paused`, `step.resolved`), and idempotency-cache attribution.

Verified counts across pipelines: `astro:repo-import` (10 steps) → 11 rows;
`article:blog` (13 steps) → 14 rows; `planning:weekly` (11 steps) → 12 rows.

When investigating "why does X pipeline log so many rows", confirm against the
pipeline's step list before assuming a leak. See
[`docs/discovery/f2-pipeline-observability-codeRead.md`](../../docs/discovery/f2-pipeline-observability-codeRead.md)
for the full code-read.

## Standalone BullMQ Workers (Spec 58.1)

Not every async job runs through the pipeline engine. For jobs that are NOT multi-step pipelines (e.g. a single LLM call per article), use a **standalone BullMQ worker** pattern:

1. **Queue definition** in `packages/pipelines/src/engine/<name>-queue.ts` — exports `getQueue`, `enqueue`, `close`, `JobData`, `JobResult`, `PerJobData` (specific shape without the cron-batch variant)
2. **Worker** in `apps/api/src/workers/<name>.worker.ts` — imports queue from the subpath, discriminates two job shapes via Zod `.safeParse()`:
   - **Cron-batch variant** (`{ type: "cron-triggered", projectId }`) — fans out per-item jobs
   - **Per-item variant** (`{ articleId, projectId, projectSlug }`) — does the actual LLM work
3. **Union type** for `JobData` in the queue file, plus a separate `PerJobData` type for callers that only enqueue per-item jobs (avoids exposing `type: "cron-triggered"` to those call sites)
4. **Subpath export** in `packages/pipelines/package.json` + matching `paths` entry in `apps/api/tsconfig.json`
5. **Cron registration** in `apps/api/src/workers/cron-orchestrator.ts` (4 places: type union, `getQueueForJobType`, `allQueues`, `isCronOrchestrated`)

See `packages/pipelines/src/engine/article-quality-analysis-queue.ts` + `apps/api/src/workers/article-quality-analysis.worker.ts` for the canonical example.

## External Signal Sources (Spec 54.4+)

`ExternalSignalSource<Input>` is a parallel abstraction to `TopicSource` for fetching raw external signals (PH launches, HN posts, RSS items). Lives in `src/signal-sources/`.

Interface (three required members):
```typescript
interface ExternalSignalSource<Input = unknown> {
  readonly source: ExternalSignalSourceValue;   // must match DB enum
  readonly inputSchema: z.ZodType<Input>;        // Zod validates + applies defaults
  fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]>;
}
```

**Key invariants:**
- MUST NOT persist — the BullMQ worker owns the `db.transaction()` + `onConflictDoNothing`
- MUST set `externalId` to the source's stable per-entity ID (dedup key)
- No cost tracking required — these adapters call free public APIs (€0/day)
- Caller passes `{} as never` for adapters that rely entirely on Zod `.default()` input fields; Zod `.parse()` inside `fetch()` applies the defaults at runtime

**`as z.ZodType<Input>` cast pattern** — required whenever `inputSchema` has `.default()` fields. Zod `.default()` makes `_input` type `T | undefined`, which fails `ZodType<T>`. Split into `_Schema` + cast alias:
```typescript
const _InputSchema = z.object({ topic: z.string().default("artificial-intelligence") });
type Input = z.infer<typeof _InputSchema>;
const InputSchema = _InputSchema as z.ZodType<Input>; // resolves exactOptionalPropertyTypes variance
```

**Implemented sources:**
| Adapter | Package | Cron job type | Free? |
|---------|---------|---------------|-------|
| HackerNews (Algolia) | `@marketing-auto/adapter-hackernews` | `signal_collector_hackernews` | ✅ |
| ProductHunt | `@marketing-auto/adapter-producthunt` | `signal_collector_producthunt` | ✅ |
| Vendor RSS | `@marketing-auto/adapter-vendor-rss` | `signal_collector_vendor_rss` | ✅ |
| Reddit OAuth | `@marketing-auto/adapter-reddit` | `signal_collector_reddit` | ✅ |

**Reddit specifics:** OAuth2 `client_credentials` flow. Token cached per `clientId` (60s pre-expiry buffer). Credentials stored via `global_credentials` service=`"reddit"`, keys: `client_id`, `client_secret`, `user_agent`. Default: 9 AI/SaaS subreddits, `sortMode=top`, `timeWindow=week`. Stickied + NSFW posts filtered before returning. Rate-limit header `x-ratelimit-remaining` parsed and logged; 429 throws `RedditApiError(status=429)`. Live test: `RUN_LIVE_REDDIT=1 REDDIT_CLIENT_ID=... bun --filter @marketing-auto/adapter-reddit test`.

**Adding a new source**: create `packages/adapters/<name>/`, implement `ExternalSignalSource<Input>`, add the adapter to the `collect-adapter` switch in `signal-collector.ts`, and register it in `handleCollectProject()`.

## Topic Sources (Spec 54.1+)

`TopicSource<Input>` is a lighter-weight abstraction than `Pipeline` for anything that *produces data* rather than orchestrating a multi-step LLM workflow. Interface: one `emit(input, ctx): Promise<TopicBriefInsert[]>` method. Lives in `src/topic-sources/`.

**When to use TopicSource vs Pipeline:**
- `TopicSource`: single-concern data producers — gap analysis, RSS fetch, trend API call. No cost tracking, no step orchestration needed.
- `Pipeline`: multi-step workflows where each step has cost tracking, idempotency keys, and retries.

**Key invariant**: sources MUST NOT persist `TopicBriefInsert` rows themselves. The caller (route, worker, or import step) owns the `db.transaction()` so that dual-write atomicity is preserved. See `src/topic-sources/README.md`.

**Adding a new source**: see `src/topic-sources/README.md`.

## TopicRoutingPolicy (Spec 54.3)

`src/routing/` contains pure functions that map a `TopicBrief` to a DB action:

```typescript
import { decideRoute, executeDecision } from "@marketing-auto/pipelines";

const decision = decideRoute(brief);          // pure — no DB
const result = await db.transaction(async (tx) =>
  executeDecision(decision, brief, tx)        // transactional
);
```

**`decideRoute(brief): RoutingDecision`** — pure function, no I/O. Maps `brief.source + gapMetadata.gapType` to a discriminated union:
- `missing_hub` → `create_cornerstone_spec`
- `missing_spoke_type` → `create_article` (requires `intentType`)
- `cluster_too_small` → `create_article` (defaults `intentType` to `"use_case"`)
- `missing_translation` → `create_translation` (requires `translationKey + locale`)
- Non-gap_analysis source → `skip`

**`executeDecision(decision, brief, tx): Promise<RoutingResult>`** — runs inside a transaction passed by the caller. Inserts article/spec/translation AND marks the brief as `routed` atomically. For `skip` decisions, marks brief as `superseded`.

**`findBriefForArticle(articleId): Promise<TopicBrief | null>`** — looks up the `TopicBrief` linked to an article via `routedArticleId`. Used by `TopicIntakeStep` for brief-sourced keyword resolution.

**`RoutingNotImplementedError`** — thrown for `create_cluster` (Spec 54.7) and `refresh_article` (future). Field is named `routingKind` (not `kind` or `cause`) to avoid conflict with `Error.cause` reserved built-in.

**`Transaction` type** — `packages/db/src/client.ts` exports `type Transaction = Parameters<Parameters<DB["transaction"]>[0]>[0]`. Use it as the parameter type for any function that must run inside an existing Drizzle transaction (e.g. `executeDecision`). Never open a new transaction inside such a function — always receive `tx` from the caller so the boundary is composable.

**TopicIntakeStep brief-sourced path (Spec 54.3)**: `TopicIntakeStep` calls `findBriefForArticle()` first. If a brief is linked, `brief.secondaryKeywords` is used as satellite keywords. If no brief is found (legacy article created before 54.1), falls back to cluster `satelliteKeywords` match with a `log.warn`. Both paths produce identical output shapes — downstream steps are unaffected.

## Adding a New Pipeline

1. Create `packages/pipelines/src/article/<pipeline-name>/` (or a peer directory under `src/`)
2. Create one file per step under `steps/`
3. Create `pipeline.ts` composing steps + bridges
4. Export from the directory's `index.ts`; re-export from `packages/pipelines/src/index.ts`
5. Register in `apps/api/src/workers/index.ts`
6. Trigger via `enqueuePipeline({ pipelineName: "...", projectId, input })`

## Cold-Start CLI Pipelines

Cold-start phases run synchronously via `runPipeline()` — no BullMQ, no worker registration.
Pattern: load project from DB → call `runPipeline()` → write output markdown to disk.

Steps live in `packages/pipelines/src/cold-start/<phase>/`, CLI scripts in
`apps/api/src/scripts/cold-start/`. Add the script as a `cold-start:<phase>` entry in
`apps/api/package.json` with `--env-file ../../.env`.

## Cold-Start UI Trigger Helpers (preRunId pattern)

When a UI needs a stable `runId` to poll immediately after enqueue (Spec 35+), use the **preRunId pattern** via the helpers in `packages/pipelines/src/cold-start/triggers.ts`:

```typescript
// canonical trigger helper shape
async function enqueueColdStartXxx(input: { projectId: string; ... }): Promise<{ runId: string; jobId: string }> {
  const runId = await createQueuedRun(projectId, 'cold-start:xxx', pipelineInput);  // INSERT pipeline_runs status='queued'
  const { jobId } = await enqueuePipeline({ ..., preRunId: runId });                 // worker UPDATEs that row to 'running'
  return { runId, jobId };
}
```

The `preRunId` flows through job data → `runPipeline()` UPDATEs the queued row instead of INSERTing. This avoids a second DB round-trip and gives the UI a runId before the worker picks up the job.

**Article pipeline variant (Spec 36+):** HTTP routes use a shared `triggerWithPreRunId` helper that does the `pipelineRuns` INSERT inline, then calls a thin enqueue wrapper from `packages/pipelines/src/article/trigger.ts`. The wrappers export `PreRunInput = { preRunId, articleId, projectId }` and call `enqueuePipeline` directly. Wrappers for pipelines that also write adapter-specific run tables (`enqueueArticleSyncPipeline`, `enqueuePagespeedValidationPipeline`) pre-create those rows **inside the wrapper** so the pipeline's `afterError` hook can find and settle them on failure.

## DATA Blocks (cold-start inter-phase protocol)

Phases communicate via structured YAML embedded in markdown files using named DATA blocks:

```markdown
<!-- DATA:clusters BEGIN -->
- name: "Claude Marketing"
  status: proposed
<!-- DATA:clusters END -->
```

Use `parseDataBlock(md, "clusters", ZodSchema)` to read and `renderDataBlock("clusters", data)`
to write. Both live in `@marketing-auto/pipelines/cold-start/shared`. The next phase reads
only the DATA sections; Marcel can freely edit prose outside them.

## Adapter Dependencies in Steps

Steps that call external adapters must list those adapters in `packages/pipelines/package.json`
dependencies. They are NOT inherited from `apps/api`. Currently added: `adapter-anthropic`,
`adapter-dataforseo`, `adapter-nano-banana`, `adapter-replicate`, `adapter-storage`,
`adapter-voyage`, `adapter-astro-sync`. Run `bun install` after adding a new workspace dep or
typecheck will fail.

## Hero-Image Provider Routing (Spec 64.6 → 64.6d)

`HeroImageStep` selects its provider per-call by reading `projects.image_generation_provider`
(`'nano-banana-2'` default → `@marketing-auto/adapter-nano-banana`, `'flux-1.1-pro'` → legacy
`replicate.generateImage`). The provider + resolution lookup lives in
[`resolveImageConfig(projectId)`](src/article/lib/image-config.ts) — extracted from
`hero-image.ts` in Spec 64.6d when the `rebake-hero-samples` script became the second consumer.

The step also exports a pure `seedFromArticleId(articleId): number` helper that produces a
31-bit non-negative deterministic seed (`(h << 5) - h + charCode` accumulator). Same articleId →
same seed across reruns. Pair with `seed + 1` in a future UI re-roll button for controlled A/B.

**Resolution + aspect-ratio are prompt-text-derived, not API-config (Spec 64.6d).** The Gemini
Image API has no config field for either (Discovery 64.8 §4 verified live; both 64.6's
`imageConfig.*` and 64.6b's `responseFormat.image.*` returned HTTP 400). `HeroImageStep` computes
`augmentedPrompt = buildPromptWithResolutionHint(outline.heroImagePrompt, resolution)` once after
`resolveImageConfig` and threads it through all three dispatch paths (batch enqueue, sync
nano-banana, sync replicate). The [`buildPromptWithResolutionHint`](src/article/lib/prompt-resolution-hints.ts)
helper appends `\n\nFormat: 16:9 widescreen aspect ratio, <qualitative hint>.`. Alt-text still
uses raw `outline.heroImagePrompt` — the Format suffix is rendering noise, not screen-reader content.

The ad-hoc [`apps/api/src/scripts/rebake-hero-samples.ts`](../../apps/api/src/scripts/rebake-hero-samples.ts)
reuses `resolveImageConfig` + `buildPromptWithResolutionHint` + `seedFromArticleId` (all
re-exported from `@marketing-auto/pipelines`) and a `buildFallbackHeroPrompt(article)` for
imported content where `outline IS NULL`. Use the same pricing helper (`estimateHeroImageCost`),
never hardcode estimates.

Existing graceful try/catch skip-with-warn (returns `{r2Key: "", publicUrl: "", skipped: true}`
on failure) stays as the outer backstop for API errors — the article lands in `final_review`
without a hero rather than failing the whole pipeline. The fallback to Replicate is NOT a cascade
on API errors — it only fires when the project is explicitly opted out via the column value.
If you want behaviour different from "skip-with-warn on transient failure", change the adapter's
internal retry logic rather than wrapping retries at the step layer.

## Test Script Caveat

DO NOT run `bun run test` from inside `packages/pipelines/` — Bun's CLI resolves
the same-named script before the `test` built-in, which triggers workspace broadcasting
and recurses across other packages. Always invoke via:

```
bun --filter @marketing-auto/pipelines test
```

The test script itself does `cd ../.. && bun test packages/pipelines/test` to ensure
the root `.env` is auto-loaded by Bun.

## Project Config Resolvers (Spec 54.2+)

`src/config/` provides three resolver functions consumed by article generation steps and gap detection:

- **`loadActiveConfig(projectId)`** — loads the active `project_configurations` row for a project; 60s in-process cache; throws on missing config (system invariant). Parses `topicScope` and `masterPrompts` JSONB fields through their Zod schemas on every cache miss — Zod `.default()` values are applied to rows stored before new fields were added (spec 54.5b forward-compat fix).
- **`resolveMasterPrompt({ projectId, promptKey, fallback })`** — returns the DB override for a prompt key if set, otherwise the code-default fallback. Supported keys: `"article.outline"`, `"article.draft"`, `"article.self_review"`, `"article.localize.fresh"`, `"article.localize.translate"`.
- **`resolveIntentTaxonomy({ projectId, pillarId })`** — returns the pillar's `intent_taxonomy_override` if set, otherwise the project's `intent_taxonomy_default`.

**Pattern for any new article generation step:**
```typescript
// Keep the code default as a named constant for fallback
const MY_STEP_DEFAULT_PROMPT = `...static instructions...`.trim();
// OR inside execute() if the prompt uses runtime values (input.*, locale labels, etc.)

const stepInstructions = await resolveMasterPrompt({
  projectId: ctx.projectId,   // or input.projectId
  promptKey: "article.outline",
  fallback: MY_STEP_DEFAULT_PROMPT,
});
const prompt = await buildSystemPrompt({ ..., stepInstructions });
```

**Scoping rule:** if the prompt string uses runtime values (cluster name, locale, author list), the constant MUST be inside `execute()` — it cannot be a module-level const. If it's fully static, prefer module-level for readability.

## Prompt Composition

All generative pipeline steps must use `buildSystemPrompt()` from
`@marketing-auto/pipelines` to assemble system prompts. The function
returns a stable `cacheablePrefix` (skill + project context) and a variable
`variableSuffix` (step instructions). Adapter implementations should pass
`cacheablePrefix` with `cache_control: { type: "ephemeral" }` to claim the
90% prompt-caching discount on Anthropic.

Never inline-concat skill content with step instructions yourself. The
caching boundary matters for cost and consistency.

### `frontmatterSchema` injection (Spec 50)

`buildSystemPrompt()` accepts an optional `frontmatterSchema?: FrontmatterFieldDescriptor[]`
(imported from `@marketing-auto/db`). When provided, it appends a
"# Frontmatter Requirements" block to `cacheablePrefix` listing required/recommended
fields with their types, allowed values, and format hints. This block is project-level
(not per-article), so it benefits from Anthropic's prompt-cache TTL.

**Pattern** for any step that writes to an Astro collection:
1. `TopicIntakeStep`: loads `project.astroCollectionSchemas?.["blog"] ?? null` and
   returns it as `frontmatterSchema` in its output.
2. Downstream steps (`OutlineStep`, `DraftStep`): accept `frontmatterSchema` in
   `InputSchema` as `z.array(z.unknown()).nullable().optional()`, cast to
   `FrontmatterFieldDescriptor[]` when passing to `buildSystemPrompt()`.
3. `DraftStep` additionally instructs the LLM to output a
   `<!-- DOMAIN_EXTRAS: {...JSON...} -->` block at end of body; it parses
   this, strips it from `bodyMd`, and saves to `articles.domainExtras`.
4. **Tool spotlight fields (Spec 54l):** When `intentType` is `overview`, `features`, `review`, `pricing`, or `use-cases` AND `primaryTool` is set, `DraftStep` also emits `pros`, `cons`, `features`, `useCases`, `pricingTier`, `priceFrom`, `rating` in `DOMAIN_EXTRAS`. These fields are required for `single-tool-spotlight` eligibility. Articles with `intentType: "general"` or `"tutorial"` do not get these fields — by design.

### Tagged-block output pattern (multi-field LLM responses)

When a step needs the LLM to return multiple distinct fields (e.g. localization: title,
slug, outline JSON, body, extras), instruct it to wrap each field in XML-like tags and
parse with a `parseBlock()` helper:

```typescript
function parseBlock(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "i");
  const m = text.match(re);
  if (!m) return null;
  return m[0].replace(new RegExp(`^<${tag}>\\s*`, "i"), "")
             .replace(new RegExp(`\\s*<\\/${tag}>$`, "i"), "").trim();
}
// Usage: parseBlock(raw, "TITLE") ?? fallback
```

Always provide a fallback for every `parseBlock()` call — the LLM may omit a tag
under token pressure. See `src/article/localize/pipeline.ts` for the canonical example.

### HubCarousel MDX injection (DraftStep post-processing)

`DraftStep` injects the `HubCarousel` Astro component into every generated draft:
- Import statement prepended at the top of `bodyMd`
- `<HubCarousel excludeSlug="...">` inserted before the last `##` heading (= Fazit position)
- Idempotent: skips injection if `"HubCarousel"` already appears in the body

This must be preserved when adding post-processing steps — do not strip or move the
import. The component is required by the Astro blog layout for cluster navigation.

### Collection-specific draft prompts (Spec 61.2 + 61.3)

`src/article/prompts/index.ts` is the canonical selector entry point:

```typescript
import { selectDraftPrompt } from "../prompts/index.ts";
const promptFn = selectDraftPrompt(collectionType);
// null = use the blog default literal inside DraftStep
```

Builder files (`comparison.ts`, `ki-wissen.ts`) export `buildXxxDraftPrompt({authorInstruction, today, locale})` and nothing selector-related. Each builder owns its `LOCALE_LABELS` typed map (DE/EN section names) and emits a single-shot prompt that REPLACES the default — body structure + DOMAIN_EXTRAS block in one LLM call (Pattern 110).

Collection-specific validation lives in `src/article/frontmatter/<collection>.ts` as `validateXxxExtras(raw): {ok,data}|{ok,error}`. Called inside `DraftStep` after the DOMAIN_EXTRAS JSON parse; throws `ArticlePipelineError(stage="draft")` on failure (Pattern 111). Cross-collection fields like `faq` are NOT inside the collection schema — validate them separately in `DraftStep` (e.g. ki-wissen requires `faq.length ≥ 7`, blog/comparison ≥ 5).

Adding a new collection variant:
1. Add the enum value to `ARTICLE_COLLECTION_TYPES` in `packages/shared/src/types/article-collection.ts`
2. Add the folder mapping to `COLLECTION_ASTRO_NAME` in `PersistArticleStep`
3. Create `src/article/frontmatter/<collection>.ts` with the Zod schema + `validateXxxExtras`
4. Create `src/article/prompts/<collection>.ts` with the builder
5. Add the case to `selectDraftPrompt` in `prompts/index.ts`
6. Add a `if (collectionType === "<name>") { validate + faq check + word-count warn }` block in `DraftStep`

No changes to pipeline shape, bridge, or step list are needed — the same `BlogPipeline` handles all variants.

### Domain-Registry routing (Spec multi-domain-evolution)

`DraftStep` resolves a `DomainContext` for the current project via `getDomainRegistry().forProject(input.projectId)` BEFORE the comparison + ki-wissen validators run. The flow:

```typescript
const domainCtx = await getDomainRegistry().forProject(input.projectId);
// per-collection branch:
const collectionCtx = domainCtx?.forCollection("comparison") ?? null;
const validation = collectionCtx
  ? collectionCtx.validateExtras(domainExtras)  // registry path
  : validateComparisonExtras(domainExtras);     // legacy fallback
```

**Use `validateExtras()`, not `validate()`** — `CollectionContext.validate(frontmatter)` runs the COMPOSED schema (`baseFrontmatter + extras`), which would reject every LLM-emitted DOMAIN_EXTRAS block because the LLM doesn't produce `title`/`date`/`heroImage`/etc. (those are assembled later by `PersistArticleStep`). `validateExtras(raw)` runs ONLY the Bucket-C extras schema, plus any cross-field rule registered via `DomainCollectionSpec.validateExtras?` callback. Toolwiki's `spec.ts` registers the existing `validateComparisonExtras` + `validateKiWissenExtras` as those callbacks, so the registry path is byte-equivalent to the legacy direct import.

Null-registry path falls through to the legacy direct-import validators. Preserves zero-regression for any project whose `targetNiche` is missing OR whose DomainSpec isn't shipped yet.

The same singleton (`@marketing-auto/pipelines/domain-registry`) is consumed by `RenderMdxStep` (allowed-collections gate) in `astro-sync` and `briefs.ts` (gate + `GET /brief-options` dynamic taxonomy) in `apps/api`. The optional `DomainSpec.collectionToIntentMap` (Phase-C) feeds the brief route's `deriveIntentFromCollection` auto-derive — Toolwiki registers `{comparison→comparison, ki-wissen→knowledge, blog→use_case, cluster→use_case}` matching the legacy hardcoded switch byte-for-byte; new tenants override or omit (in which case the inline switch fallback fires). Adding a new tenant = one entry in `DOMAIN_SPECS` at `packages/pipelines/src/_lib/domain-registry-singleton.ts`; everything else flows automatically.

## Refresh + Translation Pipelines (Spec 54.10 + 59.2)

### article:refresh

`article:refresh` re-generates an existing article in place, preserving the original body in `article_versions` before any LLM call. 8 steps: `RefreshIntakeStep` → `ToolRelevanceStep` → `OutlineStep` → `PersistOutlineStep` → `DraftStep` → `PersistBodyStep` → `ToolLinkerStep` → `SelfReviewStep`.

Key invariants:
- `RefreshIntakeStep` (step 1) persists `article_versions` **before** any LLM call (Decision 14: defensive ordering)
- Outline + Draft receive `sourceContext` (refresh framing) + `voiceContext` (original body excerpt + peer refs) combined into a single `sourceContext` field via `[a, b].filter(Boolean).join("\n\n")`
- Article status stays at `published` — `PersistArticleStep` is NOT used; the refresh updates `bodyMd`/`wordCount`/`outline` in place via `PersistBodyStep` + `ToolLinkerStep`
- `afterComplete` enqueues schema extension, then propagates to the sibling (any locale) via `enqueueTranslationPipeline(mode: "refresh_propagation")` if one exists — bidirectional since Spec 59.2

### article:translation

`article:translation` generates a target-locale sibling from an existing source article. Works bidirectionally: DE→EN and EN→DE. Three modes:
- `fresh_translation` — creates target article stub, then generates body
- `refresh_propagation` — re-translates existing sibling after source refresh
- `manual_resync` — user-triggered re-sync; re-translates existing sibling

7 steps: `TranslationSetupStep` → `TranslationDecisionStep` → `TranslationBodyStep` → `PersistBodyStep` → `ToolLinkerStep` (target locale) → `SelfReviewStep` → `PersistArticleStep`.

`TranslationDecisionStep` (Haiku 4.5) classifies source content as `"literal"` (universal) or `"adaptive"` (locale-specific). Uses different adaptive markers per direction: `DE_TO_EN_ADAPTIVE_MARKERS` (DSGVO, BaFin, Mittelstand) and `EN_TO_DE_ADAPTIVE_MARKERS` (HIPAA, USD-only pricing, Silicon Valley framing). `TranslationBodyStep` handles both paths: one Sonnet call for literal, Sonnet outline + Sonnet draft for adaptive.

Auto-triggered from `BlogPipeline.afterComplete` when `project.targetLocales` includes the opposite-locale BCP-47 tag (`"en-US"` or `"de-DE"`) AND `project.translationAutoTrigger === true` (default). Sibling-existence is checked before enqueuing to avoid duplicate creation.

**Step I/O field names are locale-neutral (Spec 59.2):** `TranslationSetupOutput` uses `sourceBodyMd`, `sourceTitle`, `targetArticleId`, `sourceLocale`, `targetLocale`, `sourceHeroR2Key`, `sourceFrontmatterExtras`, etc. — NOT the old DE-named fields (`deBodyMd`, `enArticleId`). The bridge in `pipeline.ts` uses these neutral names throughout.

**`TranslationSetupStep` must carry all source fields the target article reuses:** hero image R2 key/URL/alt + `schemaJsonLd`. These are not re-generated; the bridge copies them into `persist-article` input. If omitted, target articles get empty hero and `schemaJsonLd: [{}]`.

**`TranslationBodyStep` outputs `targetTitle`, `targetMetaDescription`, `targetTags`** in addition to the body. Both literal and adaptive paths request `<TITLE>`, `<META_DESCRIPTION>`, and `<TAGS>` blocks at the end of the LLM response. The bridge derives `targetSlug = slugify(targetTitle)` and writes it to both the DB `articles.slug` column and `domainExtras.slug`.

**`LANG_INDEPENDENT_EXTRAS` must NOT include `"category"` or `"subcategory"`** — those are human-readable strings that may be locale-specific (e.g. "Praxis & Use Cases" in DE). Target locale categories should be generated by the LLM or left blank. Only copy truly locale-neutral values: enum-style fields (`intentType`, `bottomLinksVariant`, etc.) and numeric/boolean fields (`pricingTier`, `rating`, `priceFrom`, `pros`, `cons`, `features`, `useCases`, `toolSlugs`, etc.).

**`TranslationPipeline.afterComplete` calls `checkClusterCompletion`**: clusters wait for both DE + EN articles before transitioning to `completed`. The blog pipeline fires the check after the source article completes (count < expected at that point), so the translation pipeline must re-check after each target article finishes. Without this call, clusters stay stuck at `running` indefinitely.

**`TranslationPipelineOutputSchema` must exactly match `PersistArticleStep.outputSchema`**: the runner does NOT call `bridge()` for the final step — it passes `PersistArticleStep`'s Zod-validated output directly as the pipeline output. Any extra fields in `TranslationPipelineOutputSchema` that the step never emits will fail `invalid_type` validation at runtime for every translation job.

**`enqueueTranslationPipeline` accepts `preRunId?: string`** for `triggerWithPreRunId` compatibility (Spec 59.2). Internal auto-trigger callers (BlogPipeline, RefreshPipeline) omit it. The HTTP endpoint `POST /articles/:id/translate` passes it via `triggerWithPreRunId`'s `enqueue` callback.

**Locale-bridging contract (Spec 64.3 / Pattern 117).** The `self-review → persist-article` bridge is the locale-flip site: source-locale schema/alt-text/canonical comes in, target-locale values must come out. Three invariants:

1. **No naive spread of source-locale objects** — `{...sourceArticleSchema, headline: targetTitle}` is forbidden. Use sparser reconstruction: explicitly enumerate language-neutral fields (`@context`, `@type`, `author`, `publisher`, `datePublished`, `dateModified`, `image`) and assign target-locale values for everything else (`headline`, `description`, `inLanguage`, `mainEntityOfPage`). Unknown source-locale fields are intentionally dropped — that's the safety property the explicit enumeration buys.
2. **Use the shared helpers, don't inline.** [`buildCanonicalUrl()`](packages/pipelines/src/article/lib/canonical-url.ts) for URLs (collection-aware, BCP-47-locale-aware), [`buildHeroAltText(title, locale)`](packages/pipelines/src/article/translation/lib/locale-strings.ts) for hero alt-text (locale suffix map), [`bcp47Tag(locale)`](packages/pipelines/src/article/translation/lib/locale-strings.ts) for schema.org `inLanguage`. Both the DE hot path ([assembly.ts](packages/pipelines/src/article/steps/assembly.ts)) and the EN cold path (translation bridge) call the same helpers — single source of truth, single place to extend for `fr`/`es`/`it`.
3. **Bridge logic extracted to a pure exported helper.** [`buildTranslationPersistInput(args)`](packages/pipelines/src/article/translation/pipeline.ts) takes `{setup, body, linked, selfReview}` and returns the persist-article input. The bridge calls it as thin glue. This makes the locale-flip logic unit-testable without DB/runner/Anthropic mocks ([pipeline-locale-bridge.test.ts](packages/pipelines/test/article/translation/pipeline-locale-bridge.test.ts) for 10 cases incl. Bug #3a/#3b/#3c, EN→DE direction, collection-aware URLs).

Pair every locale-bridge change with a "no source-locale stopwords in target output" regression test ([no-source-locale-leak.test.ts](packages/pipelines/test/article/translation/no-source-locale-leak.test.ts)).

**Bridge synchronicity gotcha.** `Pipeline.bridge()` is **synchronous** — no `await db.select()`. When the bridge needs project- or article-level config to compute target-locale fields (e.g. `projects.domain` for the canonical URL, `articles.collection` for the URL path segment), plumb those values through the **setup-step's `OutputSchema`** so the setup step queries them once and the bridge reads via `getStepOutput(...)`. Canonical example: `TranslationSetupOutput` exposes `projectDomain` + `sourceCollection` (Spec 64.3). Adding the field to the setup step's existing SELECT is one column wider — no extra round-trip.

**Rich-type schemas are owned by schema-extension, not the bridge (Spec 64.4).** The Article schema is written by `buildTranslationPersistInput()` because `PersistArticleStep` is the natural single-write surface. `FAQPage` / `HowTo` / `Review` schemas are NOT — `TranslationPipeline.afterComplete` enqueues `SchemaExtensionPipeline`, whose `DetectRichTypesStep` + `BuildJsonLdStep` scan the target-locale body and emit those rich types from EN H3 questions, EN how-to steps, EN frontmatter rating. `PersistSchemaStep` then overwrites the entire `schemaJsonLd` column. If a future bridge change tries to pre-write `FAQPage` for the EN article, schema-extension wipes it within seconds. The translation bug-fix for FAQ asymmetry (Spec 64.4) lives entirely in the body-step (prompt + retry); the schema side took care of itself once the body had the FAQ section.

**Multi-validator retry in `TranslationBodyStep` (Spec 64.4 + 64.5).** The LLM occasionally drops FAQ items under token pressure (64.4) AND systematically inflates body length +30-130% on DE→EN (64.5 audit: 17/17 EN siblings). Each body-generating call (literal path × 1, adaptive draft × 1 — the adaptive outline call stays single-shot because it carries only headings) is wrapped in `#runWithValidationRetry()`:

1. **`FAQ_TRANSLATION_REQUIREMENT`** and **`WORD_COUNT_CONSTRAINT`** (with `{sourceWords}`/`{sourceWordsCap}` substituted per call) are injected into the user message of every attempt.
2. After each attempt, **both** validators run: [`validateFaqPreservation`](packages/pipelines/src/article/translation/lib/faq-validator.ts) (H3 headers under FAQ H2 sections) and [`validateWordDriftCap`](packages/pipelines/src/article/translation/lib/word-drift-validator.ts) (target ≤ source × 1.25 after markdown normalization).
3. On any failure, a cumulative retry suffix is built from each failing validator's stronger guidance (`STRONGER_FAQ_GUIDANCE` for FAQ, `STRONGER_DRIFT_GUIDANCE` for drift) and the call retries **1× max — never 2×** even when both fail. All placeholder substitutions use `String.replaceAll`.
4. **The step does NOT throw on persistent failure** — Marcel reviews translated siblings before publish. Both results are surfaced via `OutputSchema.faqValidation` + `OutputSchema.wordDriftValidation` (both `.optional()` for back-compat with pre-64.4/64.5 runs).

**Reusable pattern for other LLM steps with verifiable output invariants** (word-count drift, frontmatter completeness, tool-link count, etc.):
- Pure validator helper colocated in `<step>/lib/<thing>-validator.ts`. Return shape `{valid: boolean, …diagnostics, message: string}`.
- Step builds its user message via `buildUserMessage(retrySuffix: string)` lambda; first attempt passes `""`.
- Multi-validator helper runs all validators after each attempt, builds cumulative retry suffix from failures, retries 1× max with the same `systemPrefix` (preserves `resolvePrompt` cache hit).
- Each validator's final result is included in step output as an optional field — never throws, never blocks the pipeline.
- Use **named return fields** (not a `Record<string, unknown>` generic) so TS catches missing-validator wiring at compile time.

### Voice Reference Loader

`loadVoiceReferences({ projectId, clusterId, locale, excludeArticleId, limit })` in `src/article/voice-reference/loader.ts` returns top-N published articles (same cluster + locale, ranked by `selfReviewScore DESC, createdAt DESC`). Falls back to project-wide if cluster yields fewer than `limit` results. Used by both Refresh and Translation pipelines.

### ChainStep routing (Spec 54.10 Section A)

`ChainStep` is a **TypeScript-only union type** — no DB enum or CHECK constraint exists on `pipeline_chains`. Adding a new value requires only a Drizzle schema update (`packages/db/src/schema/content.ts`), no SQL DDL. The chain-orchestrator maintains two sequences: `LEGACY_STEP_SEQUENCE` (outline→draft→schema-de→localize→schema-en→astro-transfer) and `BLOG_STEP_SEQUENCE` (blog→localize→schema-en→astro-transfer). `isBlogEligible()` routes to the correct sequence at `startChain()` time.

## Optional Steps (Spec 60.7 Patterns 102–104)

**Pattern 102 — `shouldRun()` + `skipOutput()`**: the canonical guard for steps that should not execute in all projects. Override both methods on the step class:

```typescript
class MyOptionalStep extends BaseStep<Input, Output> {
  override async shouldRun(ctx: StepContext): Promise<boolean> {
    const [project] = await db.select({ featureFlag: projects.featureFlag })
      .from(projects).where(eq(projects.id, ctx.projectId)).limit(1);
    return !!project?.featureFlag;
  }

  override skipOutput(input: Input): Output {
    return { ...input, jobIds: [] };   // valid Output shape, no cost incurred
  }
}
```

Never gate with an `if` at the top of `execute()` — use `shouldRun()` so the engine accounts for the skip in run records and the pipeline output remains Zod-valid.

**Pattern 103 — `resolveAutoTemplates(config, suggestions)`**: the single source of truth for which social templates to auto-generate. `[]` = top-1 LLM suggestion (backward compat), `['__suggested__']` = all suggestions ≥ 0.6 confidence, explicit array = as-is with eligibility gate at enqueue time. Lives in `src/article/steps/social-generation.step.ts`. Always call it; never inline the resolution logic.

**Pattern 104 — `template_renders` is canonical**: `social_posts` is legacy. No new rows should be written to `social_posts` after Spec 60.7. During the transition period both tables are read via `mergeRenderHistory()` in `ArticleSocialTab.vue`.

## Editorial-field preservation in PersistArticleStep (Spec multi-domain-evolution S1.1)

`PersistArticleStep` SELECTs the current `domain_extras` alongside `bodyMd` inside its transaction, then applies `mergePreservedExtras()` from [`src/article/refresh/preserved-fields.ts`](src/article/refresh/preserved-fields.ts) before the UPDATE. Whitelisted keys (`featured`, `pricingVerifiedAt`) survive from the current row even when the bridge supplies a fresh extras blob from the LLM. Non-whitelist keys still flow from incoming (LLM/bridge wins).

**Rule for future "preserve editorial fields" needs**: extend `REFRESH_PRESERVED_EXTRAS_KEYS` (JSONB-resident) or `REFRESH_PRESERVED_COLUMNS` (defensive — promoted-column guard) in the same module. The merge is pure + unit-tested; no changes needed in `PersistArticleStep` for additions. Sprint 3+ will generalize this to a per-domain config; until then keep the whitelist surface narrow and well-documented in the module JSDoc.

**Regression guard pattern**: [`test/article/refresh/refresh-no-touch-preserved.test.ts`](test/article/refresh/refresh-no-touch-preserved.test.ts) is the canonical "this pipeline does NOT write to field X" test — it reads step source files and asserts no `.set({...})` block mentions a preserved field. Reusable any time a pipeline must provably stay out of a column set.

## afterComplete Hook

`Pipeline` has an optional `afterComplete?(output, input): Promise<void>` hook called by the runner after all steps succeed. Use it for post-pipeline side-effects that must happen outside the step chain (e.g., auto-enqueuing a follow-up pipeline). The runner wraps it in its own `try-catch` — failures log a `warn` but do NOT mark the pipeline as failed or trigger BullMQ retries. If `afterComplete` fails silently, manual recovery is needed (e.g., `article:continue`).

## afterError Hook

`Pipeline` has an optional `afterError?(error, input): Promise<void>` hook called by the runner when any step throws. Use it for **guaranteed cleanup** — killing spawned processes, releasing locks, closing connections — that must happen even if the pipeline fails mid-run. Same try-catch semantics as `afterComplete`: cleanup failures log a `warn` and do not affect BullMQ retry counts.

```typescript
override async afterError(_error: unknown, _input: PipelineInput): Promise<void> {
  await this.killPreviewServer();  // example: PageSpeedValidationPipeline
}
```

## Zod `.default()` in Step Schemas

Zod's `.default(value)` makes the field's `_input` type `T | undefined` while `_output` stays `T`. Under `strictFunctionTypes`, TypeScript rejects this schema as `ZodType<TOutput>` in `BaseStep` because `_input` doesn't extend `TOutput`.

Fix: export a cast alias from the types file and use it for `inputSchema`/`outputSchema` assignments:

```typescript
// In types.ts — safe: .parse() always returns T; cast only affects the _input variance check
export const ArticleOutlineSchemaOutput = ArticleOutlineSchema as z.ZodType<ArticleOutline>;

// In the step file
readonly outputSchema = ArticleOutlineSchemaOutput;
```

The `.default()` behavior is preserved at runtime — use this pattern whenever a schema needs a default for LLM-output resilience.

**Same problem at the Pipeline level** (not just steps): if a Pipeline `inputSchema` has any `.default()` field, TypeScript rejects the schema as `Pipeline<Input, Output>` for the same reason. Fix: declare a `type PipelineInput` explicitly, then cast the schema:

```typescript
// pipeline.ts
type PipelineInput = {
  projectSlug: string;
  approvedClusters: ApprovedCluster[];
  projectId?: string;
  locales: ("de" | "en")[];  // has a .default() — must use type cast
};

const InputSchema = z.object({
  projectSlug: z.string(),
  approvedClusters: z.array(ApprovedClusterSchema).min(1),
  projectId: z.string().optional(),
  locales: z.array(z.enum(["de", "en"])).default(["de", "en"]),
}) as z.ZodType<PipelineInput>;

class MyPipeline extends Pipeline<PipelineInput, ...> {
  readonly inputSchema = InputSchema;  // ← no TS error
}
```

## Testing Pipeline Steps

**Unit tests** (no LLM/API calls) call `step.execute(input, ctx)` directly against a real DB.
Use the `makeMockCtx()` factory from `packages/pipelines/test/fixtures/mock-ctx.ts` (Spec
62.0a-followup Issue 6):

```typescript
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

// Override only the fields your test cares about. All other required StepContext
// fields (llmMode, runMode, log, reportProgress, getStepOutput, etc.) are defaulted.
const mockCtx = (projectId: string) => makeMockCtx({ projectId });
```

**Adding a new required field to `StepContext`?** Update the defaults in
`packages/pipelines/test/fixtures/mock-ctx.ts` — no test file changes needed.
Cross-package tests (e.g. `packages/adapters/astro-sync/test/`) cannot import from
the pipelines test/ tree (not exported); they keep a thin local wrapper that
duplicates the defaults — search for the comment marker `Spec 62.0a-followup Issue 6`
to find and update them when the field set widens.

**Runner-mechanic tests** (e.g. step-pause + idempotency end-to-end on the runner itself, not on a single step) use the `TestPipeline` fixture in `test/fixtures/test-pipeline.ts`:

- 3 steps with mixed `idempotencyKey()` behaviour (A + C cached, B not)
- Step B is a "pseudo-LLM step" — reads `ctx.promptOverride?.[this.name]` directly without calling Anthropic, so tests stay deterministic + offline
- No registry registration — tests call `runPipeline()` directly, bypassing BullMQ

Driving the runner manually (simulating what the resolve service would do):

```typescript
const r2 = await runPipeline(new TestPipeline(), { x: 5 }, {
  projectId,
  runMode: "debug",
  preRunId: r1.runId,
  priorOutput: { "step-a": { value: 10 } },
  stepPauseResume: {
    stepName: "step-a",
    action: "approve",
    storedOutput: pauseA.stepOutput,
    stepPauseId: pauseA.id,
  },
});
```

**`getLatestPause` helper** — when integration tests bypass the resolve service, prior pauses stay `resolved_at: NULL`. The helper sorts `step_pauses` by `requestedAt DESC LIMIT 1` to reliably return the most recent unresolved pause across re-entries. See `test/engine/step-pause-resume.test.ts` for the canonical implementation.

**Live-gated tests** (call real APIs) use `describe.skipIf`:

```typescript
const LIVE = process.env.RUN_LIVE_ARTICLE_PIPELINE === "1";
describe.skipIf(!LIVE)("MyStep (live)", () => { ... });
```

Run with: `RUN_LIVE_ARTICLE_PIPELINE=1 bun --filter @marketing-auto/pipelines test`

**Two gotchas to avoid:**

1. **`projectSlug` must match the DB slug exactly.** Steps that call `buildSystemPrompt`
   (Research, Outline, Draft, SelfReview) load the marketing context by `projectSlug`.
   Capture the slug from `beforeAll` and pass it through — never re-derive it:
   ```typescript
   // ✗ Wrong: doesn't match the slug inserted in beforeAll
   projectSlug: `my-test-${projectId.slice(0, 8)}`
   // ✓ Right: capture slug variable in beforeAll and use it
   projectSlug,
   ```

2. **Steps that mutate the article slug need `afterEach` cleanup.**
   `PersistOutlineStep` writes the LLM-chosen slug back to the articles row. If `beforeEach`
   re-inserts with the original slug, the next run hits the unique `(project_id, slug)` index
   when the step writes the same derived slug again. Use `afterEach` to delete by `articleId`.

**Integration tests** use `runPipeline()` (the synchronous runner) — no BullMQ worker needed.
Set `approvalMode: "manual"` to prevent `afterComplete` from calling `enqueuePipeline`.

**Testing `afterComplete` in isolation**: if you only need to verify hook behaviour (e.g. a follow-up enqueue) without running the full pipeline, call the method directly on a pipeline instance:

```typescript
const pipeline = new MyPipeline();
await pipeline.afterComplete(fakeOutput, fakeInput);
// assert DB side-effects here
```

This works whenever the hook's side-effect (DB insert, queue enqueue) precedes any Redis/BullMQ call. If BullMQ is unavailable the DB write still happens and the error is swallowed by `afterComplete`'s internal try-catch. See `ArticleSyncPipeline` / `enqueueClusterLinkRebuild` for the canonical example.

**Three more gotchas to avoid:**

3. **Spreading two detection fixtures silently zeroes out array fields.** If you have `FAQ_DETECTION` (with questions) and `HOWTO_DETECTION` (with `faqQuestions: []`), then `{ ...FAQ_DETECTION, ...HOWTO_DETECTION, hasFaq: true }` produces `faqQuestions: []` — the spread overwrites. Always build merged inputs field-by-field:
   ```typescript
   // ✗ Wrong — faqQuestions becomes []
   { ...FAQ_DETECTION, ...HOWTO_DETECTION, hasFaq: true, hasHowTo: true }
   // ✓ Right
   { hasFaq: true, hasHowTo: true, faqQuestions: FAQ_DETECTION.faqQuestions, howToSteps: HOWTO_DETECTION.howToSteps, ... }
   ```

4. **Pipelines with `afterComplete` auto-triggers break status assertions in integration tests.** If `afterComplete` transitions the article (e.g., `final_review` → `schema_extending`), a test that asserts `status === "final_review"` immediately after `runPipeline` will fail. Assert both statuses: `expect(["final_review", "schema_extending"]).toContain(saved!.status)` with a comment explaining why.

5. **Live tests that call `anthropic.messages()` require a real `projectId` from the DB.** The cost tracker inserts into `cost_logs` which has a FK on `projects.id`. A random `crypto.randomUUID()` projectId causes a FK violation that the step catches as a step failure, firing the fallback. In live-gated test files, resolve the real project ID in `beforeAll` with a DB query and pass it through `mockCtx()`. See `packages/pipelines/test/article/social-image-caption-live.test.ts` for the pattern.

## Plan Execution (Spec 62.8)

`src/execution/` contains the production-run executor that turns approved
`weekly_plans` into per-item dispatches. Module map:

- **`plan-execution-queue.ts`** — `getPlanExecutionQueue()` + `enqueuePlanExecution({ planId })`. One BullMQ queue, one job per `planId` with deterministic `plan-exec-${planId}` jobId for idempotency. `concurrency: 1`.
- **`execute-plan.ts`** — `executePlan(planId)` is the orchestrator: load plan + frozen `inputSnapshot.config.llmMode`, iterate pending items via `loadPendingItemsForPlan`, per item: budget gate → `getPipelineForItem` → pre-INSERT `pipeline_runs` row → dispatch (enqueue or inline cluster run). Flips `weekly_plans.status` approved → running on first pass, then `maybeFinalizePlanStatus` rolls to completed / partially_failed when all items terminate.
- **`weekly-spend.ts`** — `getWeeklySpendEur` + `getWeeklyBudgetEur` + `checkWeeklyBudgetGate({ allowed, reason })`. Hard 90% gate; breaks the dispatch loop on first block (caller awaits the loop).
- **`status-publisher.ts`** — `transitionItemEnqueued/InProgress/Completed/Failed/Blocked` + `emitPlanStatusIfFinalized`. Each wrapper calls the CAS-style DB helper and then fires the matching `plan.item.statusChanged` / `plan.statusChanged` SSE event via `publishPipelineEvent`. **This is the canonical call site for status flips inside plan execution** — never call the raw `markPlannedItem*` helpers from new pipeline code; route through the publisher so the UI gets live updates.

`packages/db` cannot depend on `@marketing-auto/core/events`, so events live one level up in `packages/pipelines/src/execution/`. DB helpers stay pure CAS updates.

**Cluster inline path:** `runClusterFullPlanFromBrief()` in `src/cluster/full-plan/run-from-brief.ts` is the reusable extract of the HTTP route at `apps/api/src/routes/projects/cluster-full-plan.ts`. The executor calls it directly for `kind: "inline"` routes (cluster items) because `cluster:full-plan` is not a registered BullMQ pipeline (Memory D127). The existing HTTP route is unchanged — duplication is a known follow-up.

**Shared queue worker integration:** `startPipelineWorker()` in `engine/queue.ts` reads `plannedItemId` from `job.data.input` (via `extractPlannedItemId`) and uses the `status-publisher` wrappers to flip enqueued → in_progress → completed/failed around `runPipeline`. New trigger wrappers (`enqueueBlogGeneration`, `enqueueSocialImagePipeline`) accept an optional `plannedItemId` parameter that gets folded into `pipelineInput` — no per-pipeline `afterComplete`/`afterError` hook needed for status tracking.

## Planner Topic-Diversity Modifier (Spec 63.5)

`src/planning/lib/` contains a generic soft-diversity layer used by the Floor + Overage + Social-post selectors. Three pure modules:

- **`diversity-score.ts`** — `cosineSimilarity(a, b)` + `adjustScoreWithDiversity(baseScore, briefEmb, picked, config)`. Linear-above-threshold malus formula: `adjusted = baseScore - malusWeight × max(0, (maxSim - threshold) / (1 - threshold))`. Off-switches: `malusWeight === 0` OR `threshold >= 1`.
- **`diversity-embedding.ts`** — generic `EmbeddingProvider<T>` with three source-specific factories (`createPlanRunEmbeddingProvider` for `TopicBrief`, `createSignalEmbeddingProvider` for `SignalTopNEntry`, `createArticleEmbeddingProvider` for `ArticleLike`). All share an internal `embedWithCache` helper: Voyage on-the-fly → `clusters.embedding` fallback via cluster-id → return null. Per-instance Map cache keyed by stable id.
- **`pick-with-diversity.ts`** — generic `pickWithDiversity<T>({ pool, target, embeddingProvider, config, getBaseScore, getItemId, initialPickedEmbeddings? })`. Iterative: re-scores remaining pool each round against the running picked-set. `initialPickedEmbeddings` is the cross-step seam (Floor → Overage inherits Floor brief embeddings). Also exports `normalizeBriefBaseScore(brief, idx, poolLen)` which unifies heterogeneous score sources to [0, 1] — trend `trendScore/100`, comparison `score` (already 0-1), FIFO surrogate `1 - idx/poolLen` for sources without numeric scores.

**Selector wiring:**
- Floor (`select-floor-items.ts`) — diversity on the cluster bucket only (comparison + ki_wissen keep FIFO). `useDiversity` gates on `malusWeight > 0 && pool.length > target`.
- Overage (`select-overage-items.ts`) — seeded with Floor cluster + social_post brief embeddings; reorders eligible signals (target = pool length, never a hard filter).
- Social-post (`select-social-post-items.ts`) — diversity on refresh + pool sub-paths only (`fromTodayPlans` already inherits Floor cluster diversity via parent linkage). Refresh weight `1.0`, pool weight `0.6` keeps refresh items above pool inside the same malus band. `loadArticleMeta` replaces the old title-only loader so the picker has `{title, embeddingText, clusterId}` in one DB roundtrip.

**Snapshot SSoT:** `SnapshotInputsStep` freezes `diversityThreshold` + `diversityMalusWeight` into `inputSnapshot.config` (62.5.1 precedent). All selectors read from the snapshot, never from `validate-goals.config` — replays reproduce the same picks even if Marcel later moves the sliders.

**Test injection:** all three selector classes accept optional `Select*Deps.create*EmbeddingProvider` factories. Real runs use Voyage-backed defaults; tests use `createNullBriefProvider` / `createNullSignalProvider` / `createNullArticleProvider` from `test/planning/lib/null-providers.ts` to stay offline. New planner selectors that take adapter calls should follow the same DI shape.

### Cross-week diversity + precomputed embeddings (Spec 64.15)

Phase B + C extend the 63.5 within-plan picker with two strictly-additive layers:

- **Cross-week seeding** — [`packages/pipelines/src/planning/lib/cross-week-diversity.ts`](src/planning/lib/cross-week-diversity.ts) `loadHistoricalPlanEmbeddings(projectId, lookbackWeeks, embeddingProvider, excludePlanId?)` loads briefs from the last N past plans (`status IN approved/running/completed/partially_failed`) and feeds them into `pickWithDiversity.initialPickedEmbeddings` — the SAME field 63.5 uses for cross-step Floor → Overage seeding. `SelectFloorItemsStep` is the only consumer today; if a future selector wants cross-week awareness, call the loader once and concat into `initialPickedEmbeddings`. Gated by `lookbackWeeks > 0 && malusWeight > 0` so opt-out is free.
- **Precomputed `topic_briefs.embedding`** — migration 0093 added `vector(1024)` + HNSW. `createPlanRunEmbeddingProvider.getForBrief` checks `brief.embedding` first; falls back to Voyage on-the-fly + lazy-backfills the column via `lazyBackfillBriefEmbedding(briefId, embedding)`. Trend-discovery's [emit-brief.ts](src/topic-sources/trend-discovery/emit-brief.ts) pre-computes via `computeBriefEmbedding(brief, opts)` (async helper chained AFTER the pure `buildBriefFromCandidate`). Soft-fail on Voyage error keeps brief insertion non-blocking.

**Snapshot SSoT extension:** `planDiversityLookbackWeeks` joins `diversityThreshold + diversityMalusWeight` in `plannerConfigSnapshot.config` (62.5.1 precedent) — `SnapshotInputsStep` reads `PLAN_DIVERSITY_LOOKBACK_WEEKS` env once + freezes, all selectors read from snapshot. Default 3 keeps pre-64.15 plans replaying cleanly.

**`buildBriefFromCandidate` stays pure-sync.** Voyage I/O lives in a separate async `computeBriefEmbedding(brief, opts)` chained at the call site. Same pattern applies whenever a future builder needs side-effectful enrichment: keep the structural transformation synchronous + testable, split the I/O into a named async helper that callers compose. The pure builder stays unit-testable without DB / Voyage mocks; non-trend-discovery callers (manual brief creation, gap-detection, comparison-discovery) skip the upfront Voyage call and rely on lazy-backfill at first plan-runner read.

## Adding a Planner content_type (Spec 64.1)

`content_type` discriminates planner buckets, cost estimation, dispatch, and UI presentation. Adding a value requires coordinated edits across 6 files in 5 packages — no DB migration is needed because the DB columns (`planned_items.content_type` + `project_goals.content_type`) are plain `text NOT NULL` since 62.2 (Memory D12). The Zod-validated enum in `@marketing-auto/shared/types/project-goals` is the only validation gate.

**Checklist:**

1. **Shared enum + Zod gate** — `packages/shared/src/types/project-goals.ts` `CONTENT_TYPES` array. `contentTypeSchema = z.enum(CONTENT_TYPES)` auto-widens; the `PUT/PATCH /goals` boundary now accepts the new value.
2. **Planner type aliases** — `packages/pipelines/src/planning/types.ts` `PLANNING_CONTENT_TYPES` + `PIPELINE_NAME_BY_CONTENT_TYPE` (defaults the per-item `pipeline_name`).
3. **Cost-estimation map** — `packages/planner/src/goal-validator.ts` `CONTENT_TYPE_TO_PIPELINE`. Without this entry, `expandGoalsToPlannedItems()` silently skips the bucket and `estimatedWeeklyFloorEur` understates cost.
4. **Selector mapping** — `packages/pipelines/src/planning/steps/select-floor-items.ts`:
   - `matchBriefToContentType()` — new branch with the discriminator predicate.
   - `pipelineInputFromBrief()` — stamp the fields the router needs (e.g. `intentType` for `deriveCollectionFromIntent`).
   - `DIVERSITY_FLOOR_CONTENT_TYPES` Set if the new type should go through the 63.5 diversity-aware picker.
   - `buckets` literal record — required because the type is `Record<PlanningContentType, TopicBrief[]>` and TS catches the missing key.
5. **Router dispatch** — `packages/planner/src/execution/pipeline-router.ts` new `case` returning either `{kind: "enqueue", pipelineName, jobData}` or `{kind: "inline", action, briefId}` per Spec 62.8.
6. **Downstream filter sites** — these use string equality (`it.contentType === "cluster"`), NOT exhaustive matching, so TypeScript will NOT catch missing updates:
   - `select-overage-items.ts` — Floor-seeded diversity set (`floorDiversityBriefIds` filter).
   - `select-social-post-items.ts` — auto-paired social-post parent filter (`clusterItems`).
   - `distribute-slot-dates.ts` — **the only exhaustive switch in the chain**; TS error catches this one immediately.
7. **Frontend badge** — `apps/web/src/components/planner/PlannerItemCard.vue` `KNOWN_CONTENT_TYPE_KEYS` Set + `.ct-<name>` CSS rule.
8. **Frontend Settings** — `apps/web/src/pages/settings/SettingsPlannerPage.vue` widen `ContentType` union (3 spots: union type, `ALL_CONTENT_TYPES`, `perTypeInputs`).
9. **i18n DE+EN** — `planner.contentType.<name>` (calendar badge) + `settings.planner.contentTypes.<name>` (goals dropdown).
10. **Seed script** — `apps/api/src/scripts/seed-toolwiki-goals.ts` to keep manual seed in sync with the migration. (Optional but recommended.)
11. **Backfill migration** — `INSERT INTO project_goals … WHERE NOT EXISTS …` for existing projects. The partial unique index `project_goals_one_active_per_type` makes the INSERT idempotent.

The Drizzle column types don't need changes — `planned_items.content_type` and `project_goals.content_type` are both `text NOT NULL`. The TypeScript `.$type<>()` on planned_items uses `text("content_type").notNull()` without a narrow union, so widening the shared enum is invisible to the schema.

## Cost Enforcement Integration (Spec 41)

`getPipelineQueue()` registers the BullMQ pause/resume callbacks with `registerQueuePauser` from `@marketing-auto/core/cost`. This must fire before any cost limit can be hit, so:

- `startPipelineWorker()` calls `getPipelineQueue()` at startup to ensure registration happens even in worker-only processes.
- `enqueuePipeline()` also calls `getPipelineQueue()`, so API+worker combined processes are covered.

If `registerQueuePauser` is never called (e.g., a process that imports `assertCostBudget` but never initializes a queue), the DB pause state is still written — but Redis `queue.pause()` is not called. The trigger-layer check (`isProjectPaused`) will still block new jobs. This is acceptable but means already-queued jobs may start.

## Common Mistakes

- DO NOT include explicit pixel counts (e.g. `"1024px"`, `"4096 pixels"`) in hero-image prompts or in `RESOLUTION_HINTS` — Gemini Image API may parse numeric tokens as crop / layout hints rather than resolution hints, producing the wrong composition. Use qualitative phrases (`"standard editorial quality"`, `"premium print quality, ultra-detailed"`) instead. The regression-guard test in [prompt-resolution-hints.test.ts](test/article/lib/prompt-resolution-hints.test.ts) iterates all 4 resolutions and asserts no `\d+\s*px` / no `\b(512|1024|2048|4096)\b` ever leak into the hint text. Marcel-decision 2026-05-22 — escalate to explicit numerics only if qualitative hints prove insufficient in a future audit.
- DO NOT call the Nano Banana adapter directly with `prompt: outline.heroImagePrompt` (or any raw text) — always pass through `buildPromptWithResolutionHint(prompt, resolution)` from [src/article/lib/prompt-resolution-hints.ts](src/article/lib/prompt-resolution-hints.ts) first. The Gemini API derives aspect-ratio + resolution from prompt text (Discovery 64.8 §4) so any caller that skips augmentation gets Gemini's default 1:1 square crop regardless of the project's configured resolution. Same rule for `replicate.generateImage` in the legacy Flux path. HeroImageStep + the rebake script are the only current callers; future additions must follow.
- DO NOT validate LLM output against a markdown body without accounting for trailing tagged blocks (`<TITLE>…</TITLE>`, `<META_DESCRIPTION>…</META_DESCRIPTION>`, `<TAGS>…</TAGS>`). Validators in `#runWithValidationRetry` (Spec 64.4 + 64.5) run on the **raw** LLM output before the bridge strips the tagged blocks; the tag-inner text (~22 words for the canonical translation step) is counted as part of the body. Production-negligible for typical 500-3000-word bodies, but tests using `~100-word` fixtures will see false "drift exceeded" results — use ≥350-word sources so the +25% cap (~438 words) dwarfs the tagged-block overhead. The validator stays source-shape-agnostic on purpose; do not retroactively strip tags inside the validator.
- DO NOT do business logic outside of `execute()` — it won't be tracked
- DO NOT skip cost-tracker for "small" calls — they accumulate
- DO NOT make a step do two things — split into two steps
- DO NOT mutate `ctx` — it's read-only from your perspective
- DO NOT call other steps directly — use `getStepOutput` or pipeline.bridge
- DO NOT put post-pipeline side-effects (like enqueuing a follow-up job) inside a step — use `afterComplete` instead so failures don't retry the entire pipeline
- DO NOT use `console.log`/`console.error` in `afterComplete` or `afterError` — these hooks have no `StepContext`, so declare a module-level `const log = createLogger("pipelines:my-pipeline")` at the top of `pipeline.ts` and use it there
- DO NOT create an external audit row in a trigger function without also wiring `afterComplete`/`afterError` on the pipeline to settle its `status`, metric columns, and `finishedAt`. Thread the row ID through the pipeline input schema as an optional field so the pipeline can find and update the row. See `ClusterLinkRebuildPipeline` + `enqueueClusterLinkRebuild` in `internal-linking/` for the pattern.
- DO NOT hardcode audience/market/search-engine strings in Cold-Start step instructions — read `projects.targetLocales` from DB inside `execute()` and use `buildLocaleContext()` from `src/cold-start/_lib/locale-context.ts` to derive locale-specific values. The locale DB query adds one fast indexed read per step; it's intentional. See `IdentifyCompetitorsStep` and `GenerateClusterCandidatesStep` for the pattern.
- DO NOT use `article:localize` in translate mode when the source article has no `bodyMd` — the API gate returns 422, but step code also throws. Always generate the draft pipeline first. Use `fresh` mode to create a stub article without a body, then generate outline + draft independently for the target locale.
- DO NOT call `await import("sharp")` and use the result directly as a function — Bun/ESM returns `{ default: fn }`, not `fn`. Calling the namespace throws `TypeError` which the per-variant try-catch swallows, producing `variantCount: 0` silently. Always extract `.default`: `const sharpFn = (mod as unknown as { default: SharpCallable }).default`. See `hero-generation/pipeline.ts` for the canonical pattern.
- DO NOT enqueue article pipelines without a stable `jobId` in `jobOptions` — BullMQ assigns a UUID by default, allowing the same logical job to be queued multiple times if the UI retriggers quickly. Set `jobId: \`pipeline-name-${articleId}\`` in all `enqueuePipeline()` calls. See `packages/pipelines/src/article/trigger.ts` for all 8 article pipelines.
- DO NOT exceed 8192 tokens per LLM call when using claude-sonnet-4-6 — that model's hard `MAX_OUTPUT_TOKENS` cap is 8192. Long article translations (body + outline + extras) must be split into at least two calls; throw explicitly when `stopReason === "max_tokens"` so the failure is visible rather than silently truncated. See `article/localize/pipeline.ts` two-call split pattern.
- DO NOT query by `translationKey` alone in multi-tenant pipelines — translationKeys are project-scoped by convention but not enforced by a DB constraint. Always add `eq(articles.projectId, input.projectId)` alongside `eq(articles.translationKey, ...)` to prevent cross-tenant sibling matches. See `hero-generation/pipeline.ts` `afterComplete`.
- DO NOT re-introduce `packages/pipelines/src/article/social-image/hookPrompt.ts` — file deleted during Spec multi-domain-evolution S4.4 cleanup (commit chain pre-Sprint-5 dead-code sweep). Spec 64.14-era CLAUDE.md note claimed it was an "active separate code path" but a grep showed zero production consumers; the live `buildHookPrompt` + `buildContentPrompt` are exported from `packages/core/src/social-hooks/hookPrompt.ts`. The pipelines social-image step imports them from `@marketing-auto/core`. If a future spec needs a pipeline-local prompt builder, re-create it next to its single consumer rather than restoring this dead file.
- DO NOT extract a `*_DEFAULT_PROMPT` constant to module level when the prompt string uses runtime values (`input.*`, locale labels, author lists, etc.) — template literals with variable interpolation must be scoped inside `execute()` or a private method. Module-level constants only work for fully static prompts (no interpolation). Both placements are valid; the name is what matters for clarity. See `SelfReviewStep` (static = module-level) vs `OutlineStep` (dynamic = inside execute) for examples.
- DO NOT import the named `embed` function from `@marketing-auto/adapter-voyage` — it's an ESM binding and cannot be replaced in tests. Always use `voyage.embed(...)` (the object property). See `src/topic-sources/trend-discovery/coverage.ts` for the canonical pattern.
- DO NOT route a `refresh_detection` brief through the **blog** pipeline — `ToolRelevanceStep` (step 2) calls `buildSourceContextFragment()` which is valid for `refresh_detection` but the blog pipeline expects a brief with `clusterId + locale` for author-picking and tool-relevance. Route refresh briefs to `article:refresh` instead via `enqueueRefreshPipeline()`.
- DO NOT expect `ToolLinkerStep` to link every tool mention — it links only the **first** occurrence per H2 section (SEO best practice). A tool mentioned 4 times in a single section gets linked once. This is intentional; do not change the behaviour without updating the spec.
- DO NOT pass an empty `briefId` in the `article:blog` pipeline input — `AuthorPickStep` and `ToolRelevanceStep` both query the brief by ID in their `execute()` methods. A missing brief causes the pipeline to fail at step 1 or 2. The `enqueueBlogGenerationPipeline` wrapper always receives `briefId` from `triggerWithPreRunId` via `extraInput`; verify it is present before adding new callers.
- DO NOT assume `triggerWithPreRunId`'s `extraInput` flows through to the BullMQ job payload — it goes into `pipeline_runs.input` JSONB but the `enqueue` callback receives the full payload and is free to drop fields. `enqueueBlogGenerationPipeline` (and any similar thin wrapper) explicitly forwards only the fields it declares in its parameter type; new fields require updating the wrapper's signature AND its forwarding code together. Caught in Spec 61.2: adding `collectionType`/`comparisonToolSlugs` to `extraInput` silently no-ops until `enqueueBlogGenerationPipeline` is updated to forward them. See `packages/pipelines/src/article/blog/trigger.ts` for the canonical conditional-spread pattern.
- DO NOT cast a Drizzle `text` column value to a TypeScript enum union (e.g. `goal.contentType as PlanningContentType`) without a runtime guard — the DB column is `string`, so the cast can produce any value at runtime, including a future un-handled enum member silently mis-routed downstream. Pattern: validate once per row against a `readonly string[]` (e.g. `PLANNING_CONTENT_TYPES`), warn-and-skip on mismatch, then narrow the type for the rest of the loop. See `SelectFloorItemsStep` in `packages/pipelines/src/planning/steps/select-floor-items.ts` (Spec 62.4).
- DO NOT resolve self-referential FKs (e.g. `parent_item_id`) via a post-INSERT UPDATE pass when the rows are batch-inserted in the same transaction — the post-pass either runs outside the helper's transaction (atomicity gap on partial failure) or adds N+1 round-trips. Generate the row's UUID upfront in the in-memory draft (call it `draftId` / `id`) and pass it as `id` in the INSERT; Drizzle's `.values()` accepts an explicit override of `defaultRandom()`. Then `parent_item_id` is just `parent.draftId`. Canonical example: `PersistPlanStep` in `packages/pipelines/src/planning/steps/persist-plan.ts` (Spec 62.4) — refactored away an N+1 UPDATE block AND a dynamic `await import("@marketing-auto/db")` in one go.
- DO NOT override `BaseStep.idempotencyKey()` on planner-style pipeline steps that read project-wide state at trigger time (signals, briefs, goals) — re-running a planner pipeline must produce a fresh snapshot of the current world, not replay a cached output from a prior run. The 62.0a idempotency cache is designed for expensive deterministic outputs (LLM calls); planner steps are cheap and intentionally non-idempotent over time. See the `PlanWeekPipeline` steps in `packages/pipelines/src/planning/steps/` — none override `idempotencyKey()` and the spec §8 calls this out explicitly.
- DO NOT have the planner emit a second `planned_items` row to spawn an EN sibling — cluster items emit ONE row with `locale=null`, and the chain `cluster:full-plan` → `enqueueClusterSpokes` → `article:blog` → `article:translation` (via `BlogPipeline.afterComplete`, bidirectional since Spec 59.2) produces both locales internally. Comparison + ki_wissen items still inherit `brief.locale` because their `article:blog` run will independently auto-trigger translation if the project's `targetLocales` includes the opposite locale. `ApplySiblingLocaleStep` was deleted in Spec 62.4-followup Issue 1; the `sibling_locale` enum-like value is retained only for historical audit-trail rows in running/completed plans. If a future content type needs explicit single-locale planning, set `locale: 'de' | 'en'` directly in `SelectFloorItemsStep`.
- DO NOT load `refresh_suggestions` or `template_renders` directly from a planner step — use the helpers exported by `@marketing-auto/planner` (`pickFromRefreshSuggestions`, `pickFromSuggestionPool`, `countSuggestionPool`). They live in `packages/planner/src/social-source-selectors.ts` and respect the planner-package boundary (no `@marketing-auto/pipelines` dep). The step (`SelectSocialPostItemsStep`) takes them via a `SelectSocialPostDeps` shape so tests can stub them offline; production wiring uses the defaults. Canonical example: `packages/pipelines/src/planning/steps/select-social-post-items.ts` (Spec 62.4-followup Issue 2).
- DO NOT have `DistributeSlotDatesStep` overwrite a pre-assigned `slotDate` on a `PlanningItemDraft` — `SelectSocialPostItemsStep` carries the parent cluster's `slotDate` onto the social_post draft so the executor (Spec 62.8) can sequence "post-publish same day" naturally. The step's primary placement heuristic only runs when `item.slotDate == null` (since Spec 62.4-followup Issue 2). Regression test: `distributes social_post items across Mon..Sun rotation` + `preserves pre-assigned slotDate from social-source selectors` in `test/planning/distribute-slot-dates-step.test.ts`.
- DO NOT add a new select-step that builds `PlanningItemDraft` rows without stamping `pipelineInput.title` — `PlannerItemCard.title` (in `apps/web/src/components/planner/PlannerItemCard.vue`) reads `pipelineInput.title` first; missing it makes the card fall through to `selectionReason` ("Floor cluster #1/3") or the raw content-type label. Source per content type (Spec 62-discovery-headlines): floor briefs → `brief.suggestedTitle ?? brief.topicTitle`; overage signals → `signal.title` (mirror under both `title` and `signalTitle`); cluster-derived social posts → inherit `parent.pipelineInput.title` (no DB roundtrip — floor/overage already stamped); article-derived social posts → batch `loadArticleTitles(ids)` once before the per-item loop, never per-item (N+1). `articles.title` is nullable — the batch helper must skip rows with NULL/empty title so the card cascade can fall back to `selectionReason` instead of stamping `""`.
- DO NOT extend the validator with a `MAX_BELOW_FLOOR_WEEKLY` (or similar weekly-equivalent) warning — under the existing `INVALID_MIN_MAX` error contract + single-cadence-per-goal invariant (both `min` and `max` share `cadence_unit`), `weeklyMin > weeklyMax` is structurally impossible. Both sides multiply by the same factor (×7 for `per_day`), so `weeklyMin ≤ weeklyMax` iff `min ≤ max`, which the existing error already gates. Similarly, Spec 64.2's Floor cap in `select-floor-items.ts` is defensive backstop only — `cap === target` always under validator-gated input. The cap binds only for direct DB inserts that bypass the validator. Keep the cap (defense in depth, mirrors pipeline-router's legacy `case "cluster"` pattern) but don't add validator warnings or UX flags around a path that can't trigger in production. Caught when implementing Spec 64.2: I almost shipped the warning before realising the math.
- DO NOT cap `social_post` items via the Spec 64.2 Overage `remainingCapByCT` map alone — `SelectSocialPostItemsStep` runs AFTER `SelectOverageItemsStep` and builds its own `target` from the social goal, mixing 3 sources (refresh / pool / today-plans). The 64.2 Overage cap will cap overage-derived social_posts (ProductHunt / Reddit → `inferContentTypeFromSignal` → `"social_post"`) against the Floor count, but `SelectSocialPostItemsStep`'s own pool isn't constrained by the same map. If Marcel sets `social_post: max=N` and expects a total cap across both selectors, a follow-up spec is needed to thread `weeklyMaxFromGoal(socialGoal)` through `SelectSocialPostItemsStep` too. Documented limitation in Spec 64.2 §12.
- DO NOT hardcode language-specific section names ("Auf einen Blick", "Pricing-Stand:", "Mythos vs. Realität", etc.) inside a collection-specific draft prompt — every prompt that emits a locale-dependent body must accept `locale: "de" | "en"` and look up section labels from a typed `LOCALE_LABELS` map local to that builder file. The instruction text stays in English; only output examples and section headings switch by locale (per root CLAUDE.md's English-prompt rule, "few-shot examples that demonstrate target-language output format may stay in target language"). See `packages/pipelines/src/article/prompts/comparison.ts` and `prompts/ki-wissen.ts` `LOCALE_LABELS` for the canonical pattern.
- DO NOT branch on `collectionType` inside `DraftStep.execute()` to choose a prompt — Pattern 109 lives in `src/article/prompts/index.ts` as `selectDraftPrompt(collectionType)`. Builder files (`comparison.ts`, `ki-wissen.ts`) must NOT import `ArticleCollectionType` or define their own selector — they export `buildXxxDraftPrompt()` only. The selector returns `null` for the blog default, and DraftStep falls back to its module-local literal. New collection = one builder file + one case in the switch.
- DO NOT pull the FAQ-count constraint into a collection-specific `<X>ExtrasSchema` — `faq` is a shared DOMAIN_EXTRAS field (blog/comparison/ki-wissen all emit it). Validate the minimum count inside `DraftStep` immediately after the schema parse, using `Array.isArray(faqRaw) ? faqRaw.length : 0` and throwing `ArticlePipelineError(stage="draft")` on shortfall. ki-wissen requires ≥ 7; blog/comparison ≥ 5. See `DraftStep` ki-wissen branch for the canonical placement.
- DO NOT assume `mockImplementationOnce` exhaustion is safe when a step makes multiple `anthropic.messages()` calls — once `mockImplementationOnce` runs out, subsequent calls fall through to the base `mockReturnValue`. If the base mock returns a different JSON shape than the call site expects, the downstream validator crashes at runtime (`TypeError: undefined is not an object evaluating 'hook.highlightWord.trim'`). Fix: add field-presence guards before passing parsed JSON to any validator. Pattern: `if (typeof candidate.leadPhrase === "string" && typeof candidate.highlightWord === "string") { hookPartial = candidate; }`. Caught in Spec 57.1: `ExtractToolsStep` makes 3 LLM calls (extraction + hook + enrich); tests that only mocked the first two caused the hook parser to receive tools-extraction JSON from the base mock.
- DO NOT assume author expertise embeddings are pre-populated — they are lazily computed on first `AuthorPickStep` run and cached in `articles.domainExtras.expertiseEmbedding`. The first article generated for a new cluster/author combination pays the Voyage embedding cost (~€0.0001); subsequent calls hit the JSONB cache. If you wipe `domainExtras`, re-importing the authors resets the cache.
- DO NOT hardcode a fallback author slug in `author-picker` — any hardcoded slug may not exist in the project's authors collection and will silently produce phantom author references in generated articles. Always query the DB for the actual top author by post count and validate they exist in `articles WHERE collection='authors'`. See `defaultFallbackAuthor()` in `src/article/author-picker/index.ts`. Throw `AuthorPickerError` rather than returning a phantom slug.
- DO NOT call `updateArticleAuthor()` with an author slug that hasn't been validated against the authors collection — `updateArticleAuthor()` in `blog/persist.ts` enforces this at the DB layer (throws `BlogPipelineError` if the slug is absent), but rely on the author-picker returning a valid slug in the first place. Defense-in-depth: two validation points, neither silently corrupts.
- DO NOT call `linkifyMarkdown` on body text that may already contain `[ToolName](url)` links without pre-populating `linkedInSection` — the section processor now handles this automatically (Spec 54.9.1 fix), but any future refactor of `processSection` must preserve the pre-populate loop that marks already-linked tools as done before scanning for new link positions.
- DO NOT seed test articles with a random `clusterId` UUID without first creating the matching `clusters` row — `articles.cluster_id` is a FK to `clusters.id`. Tests must create `contentPillars` + `clusters` rows in `beforeAll` if they need cluster-scoped article seeds. See `test/article/author-picker/historic.test.ts` for the canonical fixture pattern.
- DO NOT rely on Zod array validators alone for cross-item constraints (e.g. "each spoke must have a distinct intentType") — `.min()` and `.max()` only enforce array length. Add a `.refine()` for cross-item rules: `.refine((items) => new Set(items.map(i => i.field)).size === items.length, "message")`. Skipping this means the LLM can return duplicate values that pass schema validation silently. See `ClusterPlanOutputSchema` in `src/cluster/full-plan/types.ts` for the pattern.
- DO NOT let Zod schema bounds drift from prompt instruction bounds — if the prompt says "4-10 items", the schema must also enforce `.min(4).max(10)`, not a looser range. Mismatches let invalid LLM outputs pass silently while the prompt continues producing correct ones, making the schema useless as a safety net. Always verify schema constraints match the task spec before finalising a types.ts file.
- DO NOT add a field to an intermediate step's output schema just to carry a pipeline-input value to a later step — override `Pipeline.bridge()` instead. Pattern: add `myField: z.string().nullable().optional()` to the intermediate schema so Zod won't fail when that step omits it, then inject in the bridge: `if (fromStep.name === "X" && toStep.name === "Y" && pipelineInput.myField != null) return { ...(output as Record<string, unknown>), myField: pipelineInput.myField }`. See `SocialImagePipeline.bridge()` + `templateKeyOverride` on `GenerateCaptionOutputSchema` (Spec 60.6) for the canonical pattern.
- DO NOT do async context loading (DB queries, voice-reference loads) inside `Pipeline.bridge()` — bridge is synchronous. When a pipeline needs async context before the main LLM steps, use a dedicated **intake step** as step 1: load all context in `execute()`, return it in the output schema, and read it in subsequent bridge calls via `getStepOutput("intake-step-name")`. See `RefreshIntakeStep` in `src/article/refresh/intake-step.ts` for the canonical pattern.
- DO NOT write a pipeline step that INSERTs a new DB row without first checking if the row already exists — if the pipeline is re-run after a downstream failure the step will be re-executed and the INSERT will hit a unique constraint. Always do a SELECT-or-INSERT pattern: query for an existing row, return its ID if found, INSERT only if not found. See `TranslationSetupStep` in `src/article/translation/setup-step.ts` for the canonical pattern (idempotent EN article creation via translationKey lookup).
- DO NOT use `MessagesResult.text` — the field is `raw`. `anthropic.messages()` returns `{ raw: string, json: unknown | null, ... }`. Use `result.raw` for free-text responses and `result.json` for JSON-mode responses. `text` does not exist and TypeScript will catch it, but Bun silently returns `undefined` at runtime if strictness is loose.
- DO NOT rely on TypeScript to infer the full return type of `execute()` when new fields are added to a step's `OutputSchema` — TypeScript sometimes fails to unify the inferred type and emits `TS2416 Property 'execute' in type '...' is not assignable to the same property in base type`. Fix: add an explicit return type annotation: `async execute(...): Promise<z.infer<typeof OutputSchema>> { ... }`. This also serves as documentation of the step's contract.
- DO NOT define a `TranslationPipelineOutputSchema` with fields beyond what `PersistArticleStep.outputSchema` emits (`articleId`, `wordCount`, `selfReviewScore`) — the pipeline runner passes the last step's Zod-validated output directly as the pipeline result without calling `bridge()`. Extra fields cause `invalid_type` Zod errors at runtime for every translation job.
- DO NOT omit `checkClusterCompletion` from `TranslationPipeline.afterComplete` — clusters have an expected total of `deArticleCount × 2` when `translationAutoTrigger` is on. `BlogPipeline.afterComplete` fires the check after DE completes (when count < expected), so the cluster never reaches `completed` unless the translation pipeline re-checks after each EN article finishes.
- DO NOT copy `category` or `subcategory` from source articles into target articles in the translation pipeline — these are human-readable strings that may be locale-specific (e.g. "Praxis & Use Cases", "Vergleiche"). Exclude them from `LANG_INDEPENDENT_EXTRAS` and do not pass `sourceCategory`/`sourceSubcategory` to `persist-article`. Only copy truly locale-neutral extras: intentType, pricing fields, rating, features, etc. See `LANG_INDEPENDENT_EXTRAS` in `src/article/translation/pipeline.ts`.
- DO NOT call `findEnSibling()` on an EN article expecting `null` — since Spec 59.2, `findEnSibling` is an alias for the bidirectional `findSibling()`, which returns the DE sibling when called with an EN article. If you specifically need to find only the EN sibling of a DE article, pass a DE article. The alias exists for backward compat; new code should call `findSibling()` directly.
- DO NOT guard refresh sibling propagation with `article.locale === "de"` — since Spec 59.2 the propagation is bidirectional. `RefreshPipeline.afterComplete` calls `findEnSibling(article)` (the bidirectional alias) regardless of locale. Adding a locale guard would silently break EN→DE propagation.
- DO NOT add `preRunId` to an existing enqueue wrapper as a required field — it must remain optional so internal callers (pipelines' `afterComplete` hooks) that don't have a `preRunId` continue working. Use `...(input.preRunId ? { preRunId: input.preRunId } : {})` conditional spread in the `enqueuePipeline()` call. See `enqueueTranslationPipeline` in `src/article/translation/trigger.ts` for the canonical pattern.
- DO NOT copy DE `tags` to EN articles — tags are locale-specific strings. `TranslationBodyStep` outputs `enTags` (LLM-generated in EN) via the `<TAGS>` block; the bridge uses `body.enTags` instead of `s.deTags`. If the LLM emits no tags, EN article gets an empty array rather than German tags.
- DO NOT add a new `@type` to `BuildJsonLdStep` without updating all four places: (1) `OutputSchema.addedTypes` z.enum, (2) the local `addedTypes` array type annotation, (3) the `existingMinusOurs` filter cast, (4) a `buildXxx()` helper function. Missing any one of them causes either a TypeScript error or a stale entry being left in `schemaJsonLd` on re-runs.
- DO NOT write a new optional last-step input/output schema narrower than the preceding step's output when the pipeline output schema reads the last step directly — `BlogPipelineOutputSchema` expects `{ articleId, wordCount, selfReviewScore }` and the runner passes the final step's Zod-validated output as the pipeline result without calling `bridge()`. When the new step becomes the last step, include those fields as pass-through in both its input and output schemas. See `SocialGenerationStep` in `src/article/steps/social-generation.step.ts` for the canonical pattern.
- DO NOT put the "should this step run?" guard inside `execute()` — implement `shouldRun(ctx): Promise<boolean>` on the step class instead. The engine calls `shouldRun()` before `execute()` and invokes `skipOutput(input)` when it returns false, giving the pipeline a valid output shape with zero cost. Never bypass this pattern with an `if` at the top of `execute()`. See `SocialGenerationStep` (Pattern 102, Spec 60.7).
- DO NOT use exceptions to signal batch API suspension from a step — return `{ batchPending: true, batchRequestId }` from `execute()` instead (Pattern 118, Spec 61.4). The runner detects the object shape before `outputSchema.parse()`, checkpoints to `pipeline_runs.suspensionCheckpoint` (renamed from `batchCheckpoint` in Spec 62.0a-followup), and returns `ok:false/suspended:true`. Throwing an exception would mark the BullMQ job as failed and trigger retries.
- DO NOT instantiate a planner selector step (`SelectFloorItemsStep`, `SelectOverageItemsStep`, `SelectSocialPostItemsStep`) in a test without injecting null embedding providers — the diversity-aware code path (Spec 63.5) fires `voyage.embed` against the test's fake-project UUID, which (a) hits Voyage rate limits (429 in CI) and (b) fails the `cost_logs.project_id` FK constraint. Both errors are swallowed by the provider as warnings, so tests still pass — but the log noise drowns out signal. Inject `createNullBriefProvider` / `createNullSignalProvider` / `createNullArticleProvider` from `test/planning/lib/null-providers.ts` via the `Select*Deps.create*EmbeddingProvider` factory fields. See `select-floor-items-step.test.ts` for the canonical setup.
- DO NOT add a new field to `plannerConfigSnapshotSchema` in `packages/shared/src/types/weekly-plan.ts` without giving it a `.default(...)` value — `SnapshotInputsStep` writes the snapshot once per plan, so old running/completed plans replayed through the runner re-parse their frozen snapshot through the new schema. Missing fields without a default cause Zod `invalid_type` errors on every replay. Same rule applies whenever you extend `plannerConfigSnapshotSchema`, `goalSnapshotEntrySchema`, or `weeklyPlanInputSnapshotSchema`. Canonical examples: `llmMode.default("sync")` (Spec 62.5.1), `diversityThreshold.default(0.5)` / `diversityMalusWeight.default(0.5)` (Spec 63.5).
- DO NOT check `ctx.resumeFromStep === step.name` inside a step to detect the batch resume path — check `ctx.batchResult?.stepKey === step.name` instead. `resumeFromStep` drives the runner's skip loop; `ctx.batchResult` carries the cached LLM content for exactly the one step being resumed. A step must check `ctx.batchResult` BEFORE calling `batchLlmCall()` to avoid a second LLM call on resume. See `OutlineStep` in `src/article/steps/outline.ts` for the canonical check.
- DO NOT add a required field to `StepContext` without updating `makeMockCtx()` defaults in `packages/pipelines/test/fixtures/mock-ctx.ts` AND every cross-package wrapper marked with the comment `Spec 62.0a-followup Issue 6` (currently `packages/adapters/astro-sync/test/gap-detection-includes-generated.test.ts`). The factory was introduced in Spec 62.0a-followup specifically to eliminate per-test churn — historically `runMode: "production" | "debug"` (added Spec 62.0a) broke 11 mockCtx literals before the factory existed. Today: one factory edit + one or two wrapper edits + workspace typecheck. Production code building real `StepContext` (`packages/pipelines/src/engine/runner.ts`, `apps/api/src/routes/projects.ts`) is intentionally NOT routed through the factory — patch those sites directly.
- DO NOT declare a new `PipelineRunOptions` field with shape derived from a Zod schema's `z.unknown()` / `z.string().optional()` and expect the interface side to use `field?: T` under `exactOptionalPropertyTypes` — Zod infers optionals as `T | undefined` which is incompatible. Either declare the interface to match Zod's inferred shape (`storedOutput?: unknown`, `editedPrompt?: string`) AND mark a single justified `as Parameters<typeof runPipeline>[2]` cast at the worker dispatch site, OR define the schema once in a shared file and use `z.infer<typeof X>` as the canonical type. Canonical example: `StepPauseResume` in [runner.ts](src/engine/runner.ts) + `stepPauseResumeSchema` in [queue.ts](src/engine/queue.ts) (Spec 62.0a Session 2).
- DO NOT add a new pipeline that enqueues `article:translation` in `afterComplete` without consulting `shouldSkipAutoTranslation(article.skipAutoTranslationUntil)` from `src/article/translation/skip-gate.ts` first (Spec 62.0a-followup Issue 1). Per-article skip-until takes precedence over project-level `translationAutoTrigger`. Currently wired in `BlogPipeline.afterComplete` (fresh translation) and `RefreshPipeline.afterComplete` (sibling propagation). If you add a third translation-enqueue site, copy the same DB select for `skipAutoTranslationUntil` and gate on the helper.

## llmBound Flag (Spec 62.5.1)

`BaseStep.llmBound: boolean = false` is a class field declaring whether the step's cost is dominated by an Anthropic LLM call. The Planner's cost estimator multiplies these steps' contributions by `BATCH_DISCOUNT_FACTOR` (0.5) when the project's `llmMode === 'batch'`.

```typescript
export class DraftStep extends BaseStep<Input, Output> {
  readonly name = "draft";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  override readonly llmBound = true;   // ← add for any step that calls anthropic.messages
  ...
}
```

**Pattern**: place `override readonly llmBound = true` immediately after the schema declarations, before `estimatedCostEur()`. The `override` keyword is required because `BaseStep` declares a non-abstract default; omitting it triggers TS4114 under `noImplicitOverride`.

**When to flag (`true`)**: every step whose `estimatedCostEur` is dominated by Anthropic tokens. Currently 11 steps: `DraftStep`, `OutlineStep`, `SelfReviewStep`, `TranslationBodyStep`, `TranslationDecisionStep`, `LocalizeArticleStep`, `ExtractToolsStep`, `GenerateComparisonGrid4Step`, `GenerateCaptionStep`, `AnalyzeLinksStep`, `DetectRichTypesStep`.

**When NOT to flag (`false` — the default)**:
- Mixed-cost steps. `ResearchStep` calls DataForSEO (SERP) AND an LLM — the SERP cost can't benefit from the batch discount, so flagging would over-discount.
- DB-only / asset-only steps (`LoadArticleStep`, `ResolveAssetsStep`, `RenderSlidesStep`, etc.) — no LLM cost.
- Cold-start steps — they don't run via the Planner.
- Free-function LLM calls (`cluster/full-plan/llm-call.ts`, `cluster-creator/propose.ts`, `topic-sources/trend-discovery/*`, `article/discovery/llmEnrichment.ts`) — no `BaseStep`, no flag surface. Future refactor to `BaseStep` would pick up the discount.

**Reading `llmMode` in planner steps**: never query `projects.llmMode` directly in steps after `SnapshotInputsStep`. The snapshot step persists `llmMode` into `inputSnapshot.config.llmMode` for reproducibility. Downstream steps (`EstimateCostStep`) read it back via `ctx.getStepOutput<{ snapshot: WeeklyPlanInputSnapshot }>("snapshot-inputs")?.snapshot.config.llmMode ?? "sync"`. The `?? "sync"` fallback lets pre-62.5.1 plans replay safely.

## EstimatorContext for project-aware step costs (Spec 64.6b)

`EstimatorStep.estimatedCostEur(input, context?: EstimatorContext)` accepts an optional second arg threaded through by the tier-1 step-sum loop in `estimateWeeklyPlanCost`. Used by `HeroImageStep` to switch the per-image rate based on the project's `image_generation_provider` + `image_generation_resolution` toggles.

```typescript
override estimatedCostEur(_input: unknown, context?: EstimatorContext): number {
  // Planner path: project-aware rate from frozen snapshot.
  if (context?.imageProvider && context.imageResolution) {
    return estimateHeroImageCost(context.imageProvider, context.imageResolution);
  }
  // Ad-hoc path (no snapshot context): legacy upper bound.
  return 0.07;
}
```

**Same SSoT discipline as `llmMode`**: `SnapshotInputsStep` freezes both columns into `inputSnapshot.config.image{GenerationProvider,GenerationResolution}` at plan-generation time; `EstimateCostStep` reads them from the snapshot and passes them via `EstimateWeeklyPlanCostInput.{imageProvider, imageResolution}`. The estimator wraps them into an `EstimatorContext` and threads to every step. Never inline-query `projects` from a per-step `estimatedCostEur()` — replays must reproduce the same cost even after Marcel flips the resolution.

**The live `execute()` path is separate**: actual hero-image generation reads from `projects` (via `resolveImageConfig`) because the running pipeline should respect the *current* toggle, not the plan-time frozen value. The two paths differ intentionally — cost reproducibility ≠ generation reproducibility.

**Adding a new project-level cost toggle:**
1. Extend `EstimatorContext` in `packages/cost-tracker/src/weekly-budget.ts` with the new optional field
2. Extend `EstimateWeeklyPlanCostInput` in the same file with the matching optional input field; thread into the `estimatorCtx` build at the top of the tier-1 loop
3. Extend `plannerConfigSnapshotSchema` in `packages/shared/src/types/weekly-plan.ts` with `.default(...)` so pre-spec plans replay
4. Extend `SnapshotInputsStep` to read the column from `projects` + freeze into `configSnap`
5. Extend `EstimateCostStep` to read from snapshot and pass to `estimateWeeklyPlanCost`
6. Add the `context?.<field>` check inside the relevant step's `estimatedCostEur` override

## Image-Batch Suspension Contract (Spec 64.7)

Parallel to the Anthropic LLM batch (61.4) — same Pattern 118 mechanism, different
provider + cost units + processor worker. `HeroImageStep` is the only consumer today.

**Suspension signal:** `{ imageBatchPending: true, imageBatchRequestId }` (note the
field NAME discriminates from `batchPending` — the runner detects each shape
separately and writes a different `SuspensionCheckpoint.kind`).

**Checkpoint:** `kind: "image_batch"` (sibling of `"batch"` and `"step_pause"` in
the [SuspensionCheckpoint union](packages/db/src/schema/batch.ts)). `pipeline_runs.status` reuses `batch_pending` —
no enum widening. Two worker files own different source tables:
`batch-processor.worker.ts` handles `batch_requests`, `image-batch-processor.worker.ts`
handles `image_batch_requests`. Each has a defensive kind-guard before re-enqueue.

**Resume channel:** reuses `ctx.batchResult` (NOT a new `ctx.imageBatchResult` field).
Discriminator is `ctx.batchResult?.stepKey === "hero-image"`. The `content` field
carries a JSON-encoded `ImageBatchResponseBody` (`{r2Key, publicUrl, costEur, seed, error?}`)
instead of LLM text — the step JSON-parses at the top of `execute()`.

**Cost logging is the worker's job, NOT the step's.** When the Gemini batch result
arrives, `image-batch-processor.worker.ts` writes the authoritative
`image_batch:result` cost_log row (stage='actual') BEFORE re-enqueueing the pipeline.
`HeroImageStep`'s resume branch only consumes the result — adding a step-level
cost log would double-write. (Different from Anthropic batch where each LLM step
is its own cost-bearing call; here the batch is a single billable unit at
result-arrival time.)

**Submit timing is cron-driven, NOT plan-approve-delayed.** Plan-Approve does NOT
schedule a delayed coordinator job — `*/2 * * * *` cron in
[image-batch-processor.worker.ts](apps/api/src/workers/image-batch-processor.worker.ts) discovers approved plans with
≥1 pending row AND no `image_batch_id` yet, then calls `submitPlanImageBatch(planId)`.
A 90-second `SUBMIT_AGE_BUFFER_MS` absorbs the transactional race where
HeroImageStep writes a fresh pending row while older siblings are mid-batch.
The 30s-delayed-job sketch in the original spec assumed HeroImageStep would be
reached within 30 seconds — in reality it's step 11/13, ~5-10 min in.

**Idempotency:** layered — (1) `weekly_plans.image_batch_id IS NULL` short-circuit
in `submitPlanImageBatch` makes re-runs no-ops; (2) deterministic BullMQ jobId
(`SUBMIT_JOB`) prevents concurrent cron ticks. Same anti-double-submit pattern
as Spec 62.8 `plan-exec-${planId}`.

**Standalone runs are immediate.** [articles-standalone.ts](apps/api/src/routes/projects/articles-standalone.ts) pins
`overrideLlmMode: "sync"` on `triggerWithPreRunId` — even if the project's
`llmMode` is `"batch"`, the standalone wizard stays on the sync hero-image path
for fast feedback. The plan-execute worker reads `llmMode` from the plan's
frozen `inputSnapshot.config.llmMode` (62.5.1 SSoT) and passes it through the
same field. Adding a third trigger surface for hero-image-bearing pipelines
requires the same `overrideLlmMode` decision at the trigger boundary.

**Per-batch single-model constraint.** Gemini's `batchGenerateContent` encodes
the model in the endpoint path, so all requests in one batch share one model.
The Plan-Coordinator groups by model before calling `createImageBatch`; mixed-
model plans throw explicit error rather than silently splitting.

## Batch Mode Step Contract (Spec 61.4)

Steps that support Anthropic Batch API follow this pattern:

```typescript
async execute(input: Input, ctx: StepContext): Promise<Output> {
  // 1. Resume path: batch result already arrived — use cached content
  if (ctx.batchResult?.stepKey === "my-step") {
    return parseOutput(ctx.batchResult.content);
  }

  // 2. Call LLM in whichever mode the project selected
  const result = await batchLlmCall({
    mode: ctx.llmMode,          // "sync" | "batch"
    stepKey: "my-step",
    pipelineRunId: ctx.pipelineRunId,
    projectId: ctx.projectId,
    // ... other params
  });

  if (result.mode === "batch") {
    // 3. Suspend — runner detects batchPending before outputSchema.parse()
    return { batchPending: true, batchRequestId: result.batchRequestId } as unknown as Output;
  }

  // 4. Sync mode — parse immediately
  return parseOutput(result.raw);
}
```

**Cost tracking:** batch costs are logged in `cost_logs` under `service="anthropic"`,
`operation="batch:<model>"` by the batch processor worker (not by `batchLlmCall` itself).
`batchRequests.costEur` stores the raw value for the `batch_requests` row lifecycle;
`cost_logs` drives budget limits and the dashboard.

**`costServiceEnum`:** there is no `"batch_api"` value in the DB enum — costs always go
under `"anthropic"`. The spec said `batch_api` but adding a new enum value requires a DDL
migration; the CLAUDE.md rule "LLM calls always under anthropic" applies here too.

**`anthropicCustomId` separator is `_`, not `:`** (Spec 62 pre-flight fix). Anthropic's batch API
requires `custom_id` to match `^[a-zA-Z0-9_-]{1,64}$`; a colon causes HTTP 400. `batch-llm-client.ts`
builds it as `` `${pipelineRunId}_${stepKey}` ``. The field is only matched by exact equality
on the way back (`eq(batchRequests.anthropicCustomId, ...)`), never parsed/split — so the
separator can change freely if needed.

**Batch-resume parsing must be fence-tolerant.** `claude-sonnet-4-6` rejects assistant-prefill,
so the sync adapter's `jsonMode` trick (which forces output to start with `{`) does NOT apply in
batch mode. The model wraps output in ` ```json … ``` ` fences. Any step that does
`JSON.parse(ctx.batchResult.content)` will throw `Unrecognized token '\``. Pattern: slice
`raw.indexOf("{")` to `raw.lastIndexOf("}") + 1` before parsing. See `OutlineStep` `ctx.batchResult`
branch for the canonical fix.

## Step-Pause + Run-Mode Contract (Spec 62.0a)

The runner has two execution modes selectable per pipeline run:

- `runMode: "production"` (default): every step executes end-to-end. No pauses.
- `runMode: "debug"`: after every pausable step's successful execute, the runner persists a `step_pauses` row, suspends `pipeline_runs.status = "paused"`, and returns `{ suspended: true, error: "step_paused", stepKey, stepPauseId }`. BullMQ treats this as a clean job completion (no retry). The user resolves via `POST /api/pipeline-runs/:id/step-pauses/:stepPauseId/resolve` which re-enqueues with `stepPauseResume` populated.

**Opt out per step**: override `pausableInDebug(): boolean { return false; }` on the step class. Use for trivial steps where pausing has no inspection value (DB-only persist, status flip). Production mode ignores this entirely.

**Idempotency cache** (also 62.0a): if `step.idempotencyKey(input)` returns a string, the runner checks `idempotency_outputs` BEFORE execute. A HIT skips the step and uses the cached output. After successful execute, the output is written to the cache (`onConflictDoNothing`). Use when re-execution is expensive (LLM calls, image generation).

**Prompt override consumption** — `resolvePrompt(ctx, stepName, buildDefault)` is the canonical entry point for LLM steps to honour an `edit-prompt` resume action. **It is async since Spec 62.0b** and resolves through a 4-tier hybrid chain:

1. `ctx.promptOverride?.[stepName]` — Debug-Run override (highest, in-memory only)
2. Project-specific golden in `prompt_versions` (cached, 5-min TTL)
3. Global golden in `prompt_versions` where `project_id IS NULL` (cached, 5-min TTL)
4. `buildDefault()` — file-level default the step ships with

The default builder runs lazily — only invoked when Tiers 1–3 all miss. Empty-string override is a valid value (treated as "use no instructions"); only `undefined` falls through. Cache invalidation happens automatically on every `promote-golden` resume action via `invalidateGoldenPromptCache()`; the 5-min TTL is the backstop for races. Single-process caveat: multi-worker deploys would need Redis pub-sub (not yet needed for Toolwiki).

**Scope of the override** — the wrap replaces the **`systemSuffix`** (variable step instructions), NOT the full system prompt. `systemPrefix`/`cacheablePrefix` (skill foundation + project marketing context) stays intact so Anthropic prompt-cache hits keep working during debug runs and the user can't accidentally drop the project context by editing only the step instructions. `prompt_versions.body` stores the systemSuffix replacement, never the full prompt.

**Four wrap variants** (all 14 step-bound files in `packages/pipelines/src/` use one of these — note `await`):

```typescript
import { resolvePrompt } from "../../engine/prompt-resolver.ts";

// Variant A — split prompt via buildSystemPrompt
const prompt = await buildSystemPrompt({ skills, projectIdOrSlug, stepInstructions });
const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);
await anthropic.messages({ systemPrefix: prompt.cacheablePrefix, systemSuffix, ... });

// Variant B — direct string (no cacheable foundation). Extract to a const first;
// inline `resolvePrompt(...)` inside an anthropic.messages object literal is a type error
// since 62.0b (Promise<string> vs string).
const systemSuffix = await resolvePrompt(ctx, this.name, () => "You are an expert...");
await anthropic.messages({ systemPrefix: "", systemSuffix, ... });

// Variant C — shared callArgs across sync + batch + retry call sites (e.g. OutlineStep)
const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);
const callArgs = { systemPrefix: prompt.cacheablePrefix, systemSuffix, ... };
await anthropic.messages(callArgs);                      // sync
await anthropic.messages({ ...callArgs, forceRefresh: true });  // sync retry
await batchLlmCall({ ...callArgs, stepKey: "outline", mode: "batch" }); // batch

// Variant D — helper function called from a step; thread stepName as a parameter
export async function enrichToolUseCaseTokens(
  tools: ToolTokenInput[],
  ctx: StepContext,
  stepName: string,  // caller passes `this.name`
) {
  const systemSuffix = await resolvePrompt(ctx, stepName, () => "Default suffix...");
  await anthropic.messages({ ..., systemSuffix });
}
```

**Promote-golden flow (Spec 62.0b)** — when the user resolves a pause with `action: "promote-golden"` and an `editedPrompt`, the runner persists a new `prompt_versions` row (`is_golden=true`, project-scoped to `options.projectId`) via `promoteToGolden()`, supersedes any prior golden for the same (step, project), and calls `invalidateGoldenPromptCache()`. The next pipeline run of any kind picks up the new prompt automatically. `prompt_versions.created_by` is populated from `StepPauseResume.resolvedBy` (threaded by the step-pause-service from the auth context), defaulting to `"system"` if absent. The partial unique index `prompt_versions_one_golden_per_step` (`WHERE is_golden=true`, key `(step_name, COALESCE(project_id::text, 'GLOBAL'))`) is the race-condition safety net for concurrent promotes.

**Extract-for-optimization flow (Spec 62.0b)** — the **service layer** (`apps/api/src/lib/step-pause-service.ts`), not the runner, owns the write to `step_optimization_requests`. The pause itself stays unresolved (`resolved_at` NULL) so the UI keeps showing it. The frozen snapshot (stepInput/stepOutput/promptUsed) is copied from the `step_pauses` row at request time so it survives later mutation or auto-dismissal of the pause.

**One override per step** — Steps with multiple LLM calls (e.g. `TranslationBodyStep` has 3, `LocalizeArticleStep` has 3, `ExtractToolsStep` has 3) use ONE override key (`this.name`) shared across all calls. When `ctx.promptOverride[this.name]` is set, every LLM call in that step receives the same override (per spec 62.0a edge-case decision; granular per-call overrides are deferred).

**Out of scope: free-function LLM calls** — Some LLM-calling functions in `packages/pipelines/src/` are NOT `BaseStep` classes — they're called from HTTP routes, BullMQ workers, or TopicSources directly. They have no `StepContext` and therefore no override path. Currently exempt:
- `cluster/full-plan/llm-call.ts`, `cluster-creator/propose.ts` — called from HTTP routes
- `topic-sources/trend-discovery/{synthesize,coverage}.ts` — called from `TrendDiscoveryTopicSource`
- `article/discovery/llmEnrichment.ts` — called from `discoveryWorker`
- `engine/batch-llm-client.ts` — lower-level wrapper; receives `systemSuffix` from callers

A future refactor to make these `BaseStep` classes would let them pick up the override mechanism too. Out of 62.0a's scope.

**Checkpoint storage**: `pipeline_runs.suspensionCheckpoint` (jsonb, renamed from `batchCheckpoint` in Spec 62.0a-followup migration 0069) stores BOTH batch and step-pause suspension checkpoints. The TypeScript type is the discriminated union `SuspensionCheckpoint` from `packages/db/src/schema/batch.ts` — `kind: "batch"` carries `batchRequestId`; `kind: "step_pause"` carries `stepPauseId`. Both shapes share `stepKey` + `accumulatedOutput`. The resolve service reads `suspensionCheckpoint.accumulatedOutput` to rebuild `PipelineRunOptions.priorOutput` at re-enqueue. Rows written before Spec 62.0a-followup do not have the `kind` field — read paths fall back to `batchRequestId`/`stepPauseId` presence to discriminate.

## Rerun-from-Step (Spec 62.6)

The 8th step-pause action — `"rerun"` — re-executes a paused step with the original input (no edits) and invalidates all later step outputs. Mechanics live in `src/engine/rerun.ts`:

- **`computeRerunImpact({pipelineName, pipelineRunId, projectId, fromStepName})`** — pure read; returns `{safe, stepsToInvalidate, dbWritesToRevert, itemsToCancel, requiresConfirm, ...}`. Drives the `/rerun-preflight` endpoint AND the in-service confirm-destructive gate.
- **`executeRerunCleanup(...)`** — durable cleanup BEFORE re-enqueue: supersedes later child step-runs, auto-dismisses later step_pauses, deletes idempotency cache for step N..end, trims `accumulatedOutput`, runs the pipeline-specific hook. Returns the trimmed `priorOutput` map for the re-enqueue call.
- **`registerRerunCleanupHook(pipelineName, hook)`** — opt-in registration for pipelines that need destructive rollback (e.g. revert `weekly_plans` / `planned_items` writes). PlanWeekPipeline does NOT register a hook because `PersistPlanStep.pausableInDebug() === false` AND it's the last step, so all paused states are pre-write.
- **Runner switch case `"rerun"`** — in `src/engine/runner.ts`: clears later step outputs from in-memory `stepOutputs`, sets `resumeFromStep = stepName`, calls `supersedeOldSubstep(runId, stepName)`. This is belt-and-suspenders with the service-layer cleanup (both safe).

The action enum lives in **two** places that must stay in sync: `STEP_ACTIONS` in `packages/shared/src/types/step-pause.ts` AND `stepActionSchemaJob` in `packages/pipelines/src/engine/queue.ts` (separated by an unavoidable TypeScript variance constraint under `exactOptionalPropertyTypes`). Adding a new action requires updating both.

**Test pattern** (`test/engine/rerun.test.ts`): register the pipeline in `pipelineRegistry` once in `beforeAll` (try/catch the duplicate-register error since other test files may have done it); use `clearRerunCleanupHooksForTesting()` in `afterEach` to prevent hook leakage between tests.

## Trend Discovery Topic Source (Spec 54.5+)

`TrendDiscoveryTopicSource` lives in `src/topic-sources/trend-discovery/`. It implements `TopicSource<Input>` and produces TopicBriefs from `external_signals`.

**Module map:**
- `types.ts` — `SynthesisTopic`, `SynthesisOutput`, `ScoreBreakdown`, `CoverageResult`, `ClusterMatchResult`, `MAJOR_VENDOR_DOMAINS`
- `score.ts` — `computeTrendScore()`: 6-component weighted score (buzz + growth + official + SERP volatility + source diversity - coverage penalty)
- `coverage.ts` — `checkExistingCoverage()`: pgvector cosine similarity check + lazy article embedding backfill + Haiku LLM tiebreaker for the 0.60-0.85 band
- `cluster-match.ts` — `findMatchingCluster()`: pgvector similarity search against `clusters.embedding` (threshold 0.65) + lazy cluster embedding backfill

**Score weights (rebalanced in 54.5b — positive weights sum to 100):**
```
buzz=15, growth=15, official=25, serp=20, diversity=25, coverage_penalty=40
```
`source_diversity` = 0 (single/no source), 50 (two distinct sources), 100 (3+ distinct sources). Rebalance rationale: RSS-only signals (no engagement metrics) were scoring zero on buzz and growth, causing valid topics to be rejected. Diversity rewards cross-source confirmation; official raised because vendor announcements are strong trend signals regardless of community engagement.

`min_trend_score` default is **25** (lowered from 40 in 54.5b).

**Coverage thresholds:** sim > 0.85 → covered (reject), sim < 0.60 → new (accept), 0.60–0.85 → Haiku tiebreaker.

**Cluster-match threshold:** 0.65 → `cluster_action = 'append_to_existing'`; below → `cluster_action = 'create_new'` (non-knowledge intents) or `'standalone'` (knowledge intent, Spec 63.4 Hub-Spoke). The knowledge branch in `emit-brief.ts` is the only place where `'standalone'` gets emitted from trend-discovery — non-knowledge intents keep the legacy `matched ? append : create_new` mapping.

**Spec 63.4 knowledge routing:** `intent_type='knowledge'` always routes to the `ki_wissen` bucket in `matchBriefToContentType` regardless of `cluster_action`. With a Hub-Spoke match the brief carries `cluster_id=<matched-cluster-id>` AND `collection='ki-wissen'` downstream — `tool-linker/pre-generation.ts` will inject the matched cluster's tools into the draft prompt, and `author-picker/index.ts` will score authors against that cluster's historic posts. This is intentional (editorial review via Spec 63.6 plan_pending workflow is the mitigation). See root CLAUDE.md memory rule for the don't-"fix" pin.

**Embedding backfill pattern (articles + clusters):** Queries `WHERE embedding IS NULL`, embeds `title + meta_description` (articles) or `name + primary_keyword` (clusters), writes back via raw SQL `UPDATE ... SET embedding = '...'::vector`. Failures are logged as `warn` and skipped — backfill is opportunistic.

**Partial index on `rejected_topic_candidates`:** PostgreSQL does not allow non-immutable functions (`NOW()`, `CURRENT_TIMESTAMP`) in partial index `WHERE` clauses. The index on `(project_id, expires_at)` has no WHERE predicate — the query filter `expires_at > NOW()` is applied at query time only.

**`scoreBreakdown` in `trendMetadata` uses camelCase, not snake_case:** `emit-brief.ts` remaps `ScoreBreakdown` (snake_case: `community_buzz`, `serp_volatility`, etc.) to camelCase (`communityBuzz`, `serpVolatility`, `sourceDiversity`) when building the `trendMetadata` JSON. It omits `total` from the stored object. Any Zod schema or TypeScript type that models `trendMetadata.scoreBreakdown` must match `emit-brief.ts` output (camelCase, 6 fields: `communityBuzz`, `searchVolumeGrowth`, `officialAnnouncement`, `serpVolatility`, `sourceDiversity`, `existingCoveragePenalty`), NOT the `ScoreBreakdown` type from `types.ts`.

## Blog Generator Pipeline (Spec 54.9)

`article:blog` is the 13-step pipeline that converts an approved `TopicBrief` into a drafted, author-assigned, tool-linked blog article. It is registered in `apps/api/src/workers/index.ts` and triggered via `enqueueBlogGenerationPipeline` (thin preRunId wrapper) or `enqueueBlogGeneration` (full trigger with brief validation).

### Step order

```
1.  AuthorPickStep       — score-based SQL + Voyage embedding fallback + default
2.  ToolRelevanceStep    — resolve sourceContext + toolsContext strings for prompts
3.  TopicIntakeStep      — load article/cluster/project from DB
4.  ResearchStep         — SERP research via DataForSEO
5.  OutlineStep          — LLM outline (Sonnet 4.6, sourceContext + toolsContext injected)
6.  PersistOutlineStep   — checkpoint: save outline, gate on approvalMode
7.  DraftStep            — LLM draft (Sonnet 4.6, sourceContext + toolsContext injected)
8.  PersistBodyStep      — checkpoint: save body immediately
9.  ToolLinkerStep       — linkify first-occurrence tool mentions per H2 section
10. SelfReviewStep       — quality classification (Haiku 4.5)
11. HeroImageStep        — image generation (Replicate SDXL)
12. AssemblyStep         — JSON-LD schema generation
13. PersistArticleStep   — final persist with all fields
```

**`afterComplete`** triggers `enqueueSchemaExtension` (Spec 50). Errors are logged as warn and do not fail the pipeline.

### Author-Picker module (`src/article/author-picker/`)

Three-strategy cascade, no LLM call:

1. **`historic_score`** — SQL `GROUP BY author` on imported blog articles, weighted score `(cluster_hits × 3) + (intent_hits × 2) + (total × 0.1)`. Wins if top result has `cluster_hits + intent_hits ≥ 1`.
2. **`embedding_fallback`** — Voyage embedding of brief topic+keywords vs. author expertise strings. Wins if cosine similarity > 0.55. Expertise embeddings cached in `articles.domainExtras.expertiseEmbedding` after first compute.
3. **`default_fallback`** — returns `anna-weidner`. Logs a `warn` so Marcel can see when the author-picker had no signal.

`matchStrategy`, `matchScore`, `briefSource`, and `briefIntentType` are all logged at INFO level by `AuthorPickStep`, enabling easy observability of which strategy fired and why.

### Tool-Linker module (`src/article/tool-linker/`)

Two-phase architecture:

**Phase 1 — Pre-generation (`pre-generation.ts`)**
`resolveRelevantTools(projectId, brief, locale)` returns:
- `primary`: up to 6 tools where `articles.cluster_id = brief.clusterId`
- `secondary`: top 3 tools by `tool_rating` in the inferred category, excluding primary

These are formatted by `buildToolsContextFragment()` and injected into the Outline and Draft step user messages (NOT the system prompt — keeps the cache boundary clean).

**Phase 2 — Post-draft linkification (`post-generation.ts`)**
`linkifyMarkdown(bodyMd, projectId, locale)` queries ALL tools for the project+locale and replaces the **first occurrence of each tool name per H2 section** with a markdown link (`/de/tools/slug` or `/en/tools/slug`). Rules:
- Case-sensitive match (no "claude" → link, only "Claude")
- Word-boundary check (avoids partial-word matches like "OpenAI's Claude" matching "Claude" but not "OpenAI")
- Longer names matched before shorter (GitHub Copilot wins over GitHub)
- Skip inside code fences, inline code, and existing markdown links
- Persisted back to `articles.bodyMd` by `ToolLinkerStep`

### Source-context module (`src/article/source-context/index.ts`)

`buildSourceContextFragment(brief)` returns a human-readable framing paragraph injected into the Outline and Draft user messages:
- `gap_analysis` → cluster name, gap type, existing sibling articles
- `trend_discovery` → freshness window, trend score, signal count, related event
- `manual` → `""` (no framing)
- `refresh_detection` → refresh framing paragraph with staleness + reason (Spec 54.10; used by `article:refresh` pipeline)
- unknown sources → `""` (graceful fallback)

### Blog brief detection (API layer)

`isBlogBrief(brief)` = `brief.locale !== null && brief.clusterId !== null`. Both conditions must be true for the brief to route to `article:blog`; otherwise falls back to `article:outline`. Trend briefs always satisfy this (guarded at the approval endpoint).

## Family-B photographic integration (Spec 65.8)

The `article:social-image` pipeline contains a `StageFamilyBImagesStep` between `GenerateCaptionStep` and `RenderSlidesStep`. The step is a no-op pass-through for non-Family-B templates (zero cost, zero I/O) and only activates when `templateKeyOverride` is one of `story-arc-clickbait` / `lifestyle-listicle` / `opinion-recommendation`.

**Internal template gate (not Pattern 102)** — unlike Pattern 102's `shouldRun()` + `skipOutput()` split, this step is always wired into the pipeline schema chain and always parses input. The gate lives inside `execute()` (`isFamilyBTemplate(templateKey)`) so the step's `outputSchema` (which adds `familyBImages: FamilyBImageEntry[]` + `familyBImagesStats`) stays uniform across both branches. Non-Family-B paths return the same shape with `familyBImages: []` + zero-count stats via the `passThroughEmpty(input, templateKey)` helper.

**Per-template image-slide map** — `FAMILY_B_IMAGE_SLIDES` declares which slides need photographic backgrounds per template (Cover always; per-template narrative beats). Slides NOT listed render gradient-only at Remotion-render time (Family-B `SlideComposition` `image={null}` branch is the fallback). Adding a new Family-B template = one new entry in this map + the template's `TemplateKey` + render-server function.

**DI seam for offline tests** — `StageFamilyBImagesDeps` exposes `loadCredentials(projectId)` (default: `readAdapterCredsForProject` reads from `globalCredentials` vault) + optional `runOrchestrator` (default: `getImagesForSlides` from `./photographic/orchestrator.ts`). Tests inject stubs to stay offline. Production wiring calls `new StageFamilyBImagesStep()` without args.

**JSONB persistence via `jsonb_set`** — staged image entries land at `articles.domain_extras.familyBImages[]` via `sql\`jsonb_set(COALESCE(${articles.domainExtras}, '{}'::jsonb), '{familyBImages}', ${JSON.stringify(entries)}::jsonb)\``. Surgical update preserves sibling keys (`recurring`, `tools`, `pros`, etc.) — never overwrite the whole column. Re-render `refreshImages: true` clears the array via `${articles.domainExtras} - 'familyBImages'` jsonb-minus operator in `POST /api/articles/:id/re-render` (apps/api/src/routes/articles.ts) so the next render re-stages from scratch.

**Cache-key strategy** (mirrors `packages/social/CLAUDE.md` Photographic-subsystem doc): rather than asking `convertImageToWebp` for a deterministic R2 key, let the adapter pick the UUID and remember the resulting R2-key + license metadata in `domain_extras.familyBImages[]` indexed by `slideIndex`. The orchestrator's `existingCache` input + `findCachedEntryForSlide` lookup short-circuit re-stage work per slide; only cache-miss slides pay the LLM + provider + R2 cost on re-render.

**Soft-fail per slide** — the orchestrator returns `failedSlideIndices` for slides that couldn't be staged (rate-limit, vision-pick parse error, R2 conversion failure). Those slides render gradient-only; a complete photographic-pipeline failure (no provider keys in vault, all 3 providers rate-limited) leaves `familyBImages = []` and the carousel still renders gradient-only across the board. Step throws ONLY on programming errors (Zod input-parse failure, DB connection lost). Step does NOT fail the pipeline if Marcel hasn't entered vault credentials yet — `passThroughEmpty` + `ctx.log.warn` is the canonical signal.

**Caption attribution append-site** (Spec 65.8 Day 5) — `RenderSlidesStep` calls `resolveCaptionAttribution(domainExtras)` once before the per-locale render loop. The helper lazy-imports `buildCaptionAttribution` from `@marketing-auto/social/photographic` (Pattern 119 — keeps the social subsystem off the cold-path) and produces a "📸 Photos: …" suffix when any staged image is from Unsplash (always required) or Pexels (optional brand-positivity); Pixabay never requires attribution. The per-locale loop replaces `loc.caption` with `effectiveCaption = suffix ? \`${loc.caption}\n\n${suffix}\` : loc.caption` at 4 sites. Tested via `packages/pipelines/test/article/social-image/caption-attribution-integration.test.ts` (8 cases — null cases / Unsplash credit / Pexels credit / dedup / Pexels+Unsplash mix / null photographer skip / 2200-char Instagram limit).

**Budget gate** — `estimatedCostEur = 0.25` is the per-call upper bound (covers ~4 image slides × €0.06 worst case at Sonnet vision rates). Real cost lands in `cost_logs` per LLM call (`IMAGE_QUERY_KEYWORDS` Haiku + `IMAGE_VISION_PICK` Sonnet) via the orchestrator's `anthropic.messages()` calls. The provider HTTP calls (Pexels/Unsplash/Pixabay) are free-tier and deliberately don't go through cost-tracker (matches Reddit/HN/PH adapter convention).

**Dep direction**: this step depends on `@marketing-auto/social/photographic` (the leaf subsystem under `packages/social/src/photographic/`). The acyclic exception (`pipelines → social`) is the same one documented in `social/CLAUDE.md` Photographic-subsystem section — `social/photographic` only imports adapters + shared, never reaches back into pipelines. The existing `social/templates → pipelines/icon-resolver` lazy dynamic-import stays intact via the package-leaf shape (icon-resolver has no Anthropic dep).

## Icon-source resolver chain (Spec 65.2 follow-up)

`packages/pipelines/src/_lib/resolve-tool-icon.ts` walks three adapters before falling back to a deterministic HSL avatar:

```
lobe-icons (AI-focused) → simple-icons (universal monochrome) → iconify (logos + skill-icons + devicon) → deterministic-avatar
```

**Chain order is lobe-FIRST since Spec 65.2** because lobe-icons publishes structurally richer assets for AI brands:

1. **3 variants per brand** — `<slug>.svg` (mono, `currentColor`), `<slug>-color.svg` (colored — 223/850 brands), `<slug>-text.svg` (wordmark with brand text). Adapter prefers `-color` for the icon URL and uploads `-text` separately to `tool_brand_assets.logo_wordmark_url`.
2. **Multi-color SVGs inline** — Gemini's 4 brand colors (blue/green/red/yellow), DALL-E's 3 colors, etc. all live as distinct `fill="#..."` attributes on separate paths. `extractBrandColors()` returns the first 3 distinct hex values (skipping near-white/near-black structural fills) so the service can seed `primary_color` + `secondary_color` + `tertiary_color` in one resolve.
3. **Gradient fallback** — when no solid-hex fill exists (Kling, Luma, Hailuo), the extractor locates `fill="url(#gradient-id)"` → walks to `<linearGradient id="...">` or `<radialGradient>` block → returns the first `<stop stop-color="#...">` value.

**simple-icons SVGs need server-side colorize** — they ship with `currentColor` fills and a separate `icon.hex` field. The adapter injects `fill="${hex}"` on the root `<svg>` BEFORE returning. Without this, monochrome SVGs render invisibly on dark UI backgrounds.

**Slug mapping conventions** (per-adapter `TOOL_SLUG_TO_*` maps):

- **Product-family slugs map to parent brand** when the product has no dedicated lobe icon: `chatgpt → openai`, `chatgpt-atlas → openai`, `openai-operator → openai`, `gpt-4 → openai`. ChatGPT variants are consumer-facing products of the OpenAI brand; lobe has no separate icon.
- **Dedicated lobe brands stay separate** even when conceptually adjacent: `dalle` (NOT openai), `sora` (NOT openai), `claudecode` (NOT claude), `claude-computer-use → claude` (no separate icon).
- **Locale/CLI variants share the parent**: `gemini-live`, `gemini-pro`, `gemini-flash`, `gemini-advanced`, `gemini-deep-research` → `gemini`.

**`@lobehub/icons-static-svg` is the source-of-truth package** (NOT `static-png`). Static-png is kept as a defensive fallback for the handful of brands lobe ships only as PNG. The SVG variant is vector + extractable via regex; PNG was the original V1 choice but became second-class once Spec 65.2's `extractBrandColors` + wordmark pickup landed.

**The `project_brand_assets` (Spec 52b) cache is a side-effect** of `resolveToolIcon` — every successful chain-hit writes the resolved SVG + metadata to that table. The chain READS from this cache first on the next call to the same project+slug. After ANY adapter logic change (mapping update, new extractor branch, wordmark fetch), the cache MUST be invalidated before the next backfill or the new logic stays dormant. Production-grade solution (Redis pub-sub) is deferred to "Engine reads-from-DB" backlog item.
